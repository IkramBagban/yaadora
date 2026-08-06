import type { EvalState } from "./types";
import type { EvalConfig } from "./config";

export async function saveState(
  cfg: EvalConfig,
  partial: Omit<EvalState, "version" | "savedAt" | "serverUrl">,
): Promise<void> {
  await Bun.$`mkdir -p ${cfg.resultsDir}`.quiet();
  const state: EvalState = {
    version: 1,
    savedAt: new Date().toISOString(),
    serverUrl: cfg.serverUrl,
    ...partial,
  };
  await Bun.write(cfg.statePath, JSON.stringify(state, null, 2));
  console.log(`  state → ${cfg.statePath}`);
}

export async function loadState(cfg: EvalConfig): Promise<EvalState | null> {
  try {
    const file = Bun.file(cfg.statePath);
    if (!(await file.exists())) return null;
    const state = (await file.json()) as EvalState;
    if (state.version !== 1 || !state.clientToId) return null;
    return state;
  } catch {
    return null;
  }
}

export function clientToIdMap(state: EvalState): Map<string, string> {
  return new Map(Object.entries(state.clientToId));
}

export function idToClientMap(state: EvalState): Map<string, string> {
  return new Map(
    Object.entries(state.clientToId).map(([c, id]) => [id, c]),
  );
}
