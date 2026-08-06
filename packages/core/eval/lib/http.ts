/**
 * HTTP client for the eval harness — talks to a running server over the same
 * contracts as the mobile app (POST /memories, GET /memories/:id, POST /ask,
 * GET /entities, GET /reminders, GET /rules).
 */

import type { SeedMemory } from "../dataset";
import type { EvalConfig } from "./config";

export function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function healthCheck(cfg: EvalConfig): Promise<void> {
  try {
    await fetch(`${cfg.serverUrl}/health`);
  } catch {
    throw new Error(
      `Cannot reach server at ${cfg.serverUrl}. Start apps/server + apps/worker first.`,
    );
  }
}

export async function seedMemory(
  cfg: EvalConfig,
  m: SeedMemory,
): Promise<string> {
  const res = await fetch(`${cfg.serverUrl}/memories`, {
    method: "POST",
    headers: authHeaders(cfg.token),
    body: JSON.stringify({
      rawText: m.rawText,
      clientId: m.clientId,
      ...(m.occurredHint ? { occurredHint: m.occurredHint } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `seed ${m.clientId} failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function seedAll(
  cfg: EvalConfig,
  dataset: SeedMemory[],
): Promise<Map<string, string>> {
  console.log(`\nSeeding ${dataset.length} golden memories → ${cfg.serverUrl} ...`);
  const clientToId = new Map<string, string>();
  for (const m of dataset) {
    const id = await seedMemory(cfg, m);
    clientToId.set(m.clientId, id);
  }
  console.log(`  seeded ${clientToId.size} memories.`);
  return clientToId;
}

export async function getMemoryStatus(
  cfg: EvalConfig,
  memoryId: string,
): Promise<string> {
  const res = await fetch(`${cfg.serverUrl}/memories/${memoryId}`, {
    headers: authHeaders(cfg.token),
  });
  if (!res.ok) throw new Error(`status ${memoryId}: ${res.status}`);
  const data = (await res.json()) as { memory?: { status: string }; status?: string };
  // New shape: { memory: { status } }; tolerate legacy flat status if any.
  return data.memory?.status ?? data.status ?? "unknown";
}

export interface MemoryDetail {
  memory: {
    id: string;
    rawText: string;
    occurredAt: string | null;
    createdAt: string;
    status: string;
  };
  facts: Array<{
    id: string;
    factText: string;
    predicate: string | null;
    objectText: string | null;
    factType: string | null;
    validFrom: string | null;
    validTo: string | null;
    confidence: number | null;
    sourceMemory: string;
  }>;
  entities: Array<{
    id: string;
    type: string;
    canonicalName: string;
    aliases: string[] | null;
    mentionCount: number;
  }>;
  openLoops: Array<{
    id: string;
    kind: string;
    title: string;
    entityId: string | null;
    dueAt: string | null;
    status: string;
    sourceMemory: string;
  }>;
  reminders: Array<{
    id: string;
    text: string;
    dueAt: string;
    status: string;
    origin: string;
    sourceMemory: string | null;
  }>;
  rules: Array<{
    id: string;
    ruleText: string;
    triggerText: string;
    active: boolean;
    sourceMemory: string;
  }>;
}

export async function getMemoryDetail(
  cfg: EvalConfig,
  memoryId: string,
): Promise<MemoryDetail> {
  const res = await fetch(`${cfg.serverUrl}/memories/${memoryId}`, {
    headers: authHeaders(cfg.token),
  });
  if (!res.ok) {
    throw new Error(`getMemoryDetail ${memoryId}: ${res.status}`);
  }
  const data = (await res.json()) as MemoryDetail;
  // Back-compat if older server lacks new fields.
  return {
    ...data,
    openLoops: data.openLoops ?? [],
    reminders: data.reminders ?? [],
    rules: data.rules ?? [],
    facts: data.facts ?? [],
    entities: data.entities ?? [],
  };
}

export async function waitForProcessing(
  cfg: EvalConfig,
  ids: string[],
): Promise<{ processed: string[]; failed: string[] }> {
  console.log(`Waiting for ingestion (timeout ${cfg.ingestTimeoutS}s) ...`);
  const deadline = Date.now() + cfg.ingestTimeoutS * 1000;
  const pending = new Set(ids);
  const failed: string[] = [];
  const processed: string[] = [];

  while (pending.size > 0 && Date.now() < deadline) {
    for (const id of [...pending]) {
      const status = await getMemoryStatus(cfg, id);
      if (status === "processed") {
        pending.delete(id);
        processed.push(id);
      } else if (status === "failed") {
        console.warn(
          `  WARN memory ${id} ingestion FAILED — derived state will be empty.`,
        );
        pending.delete(id);
        failed.push(id);
      }
    }
    if (pending.size > 0) {
      process.stdout.write(
        `  ${ids.length - pending.size}/${ids.length} processed\r`,
      );
      await Bun.sleep(2000);
    }
  }
  if (pending.size > 0) {
    throw new Error(
      `timed out: ${pending.size} memories still not processed after ${cfg.ingestTimeoutS}s`,
    );
  }
  console.log(
    `  all ${ids.length} settled (${processed.length} processed, ${failed.length} failed).        `,
  );
  return { processed, failed };
}

export interface AskDone {
  type: "done";
  citations: Array<{ memoryId: string; snippet?: string }>;
  confidence: number;
  mode: string;
  clarifyOptions?: string[];
}

export interface AskResult {
  answerText: string;
  done: AskDone | null;
  errored: string | null;
}

export async function ask(cfg: EvalConfig, question: string): Promise<AskResult> {
  const res = await fetch(`${cfg.serverUrl}/ask`, {
    method: "POST",
    headers: { ...authHeaders(cfg.token), Accept: "text/event-stream" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok || !res.body) {
    return { answerText: "", done: null, errored: `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answerText = "";
  let done: AskDone | null = null;
  let errored: string | null = null;

  const handleFrame = (json: string) => {
    let evt: any;
    try {
      evt = JSON.parse(json);
    } catch {
      return;
    }
    if (evt.type === "token") answerText += evt.text ?? "";
    else if (evt.type === "done") done = evt as AskDone;
    else if (evt.type === "error") errored = evt.message ?? "stream error";
  };

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (line) handleFrame(line.slice(5).trim());
    }
  }
  if (buffer.startsWith("data:")) handleFrame(buffer.slice(5).trim());

  return { answerText, done, errored };
}

export async function listEntities(
  cfg: EvalConfig,
  type?: string,
): Promise<
  Array<{ id: string; type: string; canonicalName: string; mentionCount: number }>
> {
  const q = type ? `?type=${encodeURIComponent(type)}` : "";
  const res = await fetch(`${cfg.serverUrl}/entities${q}`, {
    headers: authHeaders(cfg.token),
  });
  if (!res.ok) throw new Error(`listEntities: ${res.status}`);
  const data = (await res.json()) as {
    entities: Array<{
      id: string;
      type: string;
      canonicalName: string;
      mentionCount: number;
    }>;
  };
  return data.entities ?? [];
}

export async function listReminders(
  cfg: EvalConfig,
  scope: "suggested" | "upcoming" | "pending" | "all" = "all",
): Promise<
  Array<{
    id: string;
    text: string;
    dueAt: string;
    status: string;
    origin: string;
    sourceMemory: string | null;
  }>
> {
  const fetchScope = async (s: string) => {
    const res = await fetch(
      `${cfg.serverUrl}/reminders?scope=${s}&limit=100`,
      { headers: authHeaders(cfg.token) },
    );
    if (!res.ok) throw new Error(`listReminders(${s}): ${res.status}`);
    const data = (await res.json()) as { items?: any[] };
    return (data.items ?? []) as any[];
  };

  if (scope === "all") {
    try {
      const items = await fetchScope("all");
      // If server returns only pending for "all", also pull suggested.
      const suggested = await fetchScope("suggested").catch(() => []);
      const byId = new Map<string, any>();
      for (const r of [...items, ...suggested]) byId.set(r.id, r);
      return [...byId.values()];
    } catch {
      const [upcoming, suggested] = await Promise.all([
        fetchScope("upcoming").catch(() => []),
        fetchScope("suggested").catch(() => []),
      ]);
      const byId = new Map<string, any>();
      for (const r of [...upcoming, ...suggested]) byId.set(r.id, r);
      return [...byId.values()];
    }
  }

  return fetchScope(scope === "pending" ? "upcoming" : scope);
}

export async function listRules(cfg: EvalConfig): Promise<
  Array<{
    id: string;
    ruleText: string;
    triggerText: string;
    active: boolean;
    sourceMemory: string;
  }>
> {
  const res = await fetch(`${cfg.serverUrl}/rules`, {
    headers: authHeaders(cfg.token),
  });
  if (!res.ok) throw new Error(`listRules: ${res.status}`);
  const data = (await res.json()) as { rules: any[] };
  return data.rules ?? [];
}
