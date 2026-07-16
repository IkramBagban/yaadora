import { generateText } from "ai";
import { createLogger } from "@repo/logger";
import { fastModel } from "../ai/models";

const log = createLogger("proactive:push");

/**
 * Push copywriting + Expo delivery (spec 02 §6).
 *
 * Copy: ONE line from the fast tier — plain, concrete, no cliffhangers.
 * Example: "Your interview is Wednesday — want a prep plan?"
 */

/** Generate a single-line push body from a nudge + optional evidence titles. */
export async function generatePushCopy(params: {
  oneLineNudge: string;
  evidenceSnippets?: string[];
}): Promise<string> {
  const fallback = clipOneLine(params.oneLineNudge);
  try {
    const evidence =
      params.evidenceSnippets && params.evidenceSnippets.length
        ? `\nEvidence snippets:\n${params.evidenceSnippets
            .slice(0, 3)
            .map((s) => `- ${s.slice(0, 160)}`)
            .join("\n")}`
        : "";

    const { text } = await generateText({
      model: fastModel,
      system:
        "You write ONE-line push notification copy for a personal second brain. Plain and concrete. No cliffhangers, no clickbait, no emoji spam. Max 120 characters. Output only the line.",
      prompt: `Nudge intent: ${params.oneLineNudge}${evidence}\n\nWrite the push line:`,
    });
    const line = clipOneLine(text);
    return line || fallback;
  } catch (err) {
    log.warn("push copy generation failed; using nudge text", err as Error);
    return fallback;
  }
}

function clipOneLine(raw: string): string {
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > 140 ? `${line.slice(0, 137).trimEnd()}…` : line;
}

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
}

export interface ExpoPushResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Send one or more messages via the Expo push HTTP API.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */
export async function sendExpoPush(
  messages: ExpoPushMessage[],
): Promise<ExpoPushResult> {
  if (messages.length === 0) {
    return { ok: true, status: 200, body: { data: [] } };
  }

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      log.warn("expo push HTTP error", { status: res.status, body });
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    log.error("expo push request failed", err as Error);
    return { ok: false, status: 0, body: { error: String(err) } };
  }
}
