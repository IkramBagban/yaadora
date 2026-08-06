/** Shared result shapes written to eval/results/*.json */

export interface CheckResult {
  id: string;
  /** stage: which pipeline this check belongs to */
  stage: "ingest" | "retrieve";
  category: string;
  /** human-readable subject (clientId or question) */
  subject: string;
  passed: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface StageSummary {
  stage: "ingest" | "retrieve";
  passed: number;
  total: number;
  passRate: number;
  gatesPassed: boolean;
  metrics: Record<string, number | string | boolean | null>;
}

export interface TokenTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenUsageBlock {
  sessionId: string;
  total: TokenTotals;
  byPhase: Record<string, TokenTotals>;
  byTier: Record<string, TokenTotals>;
  byModel: Record<string, TokenTotals>;
  byLabel: Record<string, TokenTotals>;
  /** full per-call log when EVAL_TOKEN_DETAIL=1 (default on) */
  events?: Array<Record<string, unknown>>;
}

export interface EvalReport {
  ranAt: string;
  command: "ingest" | "retrieve" | "all";
  stages: StageSummary[];
  checks: CheckResult[];
  gatesPassed: boolean;
  /** clientId → memoryId map from the last seed (if any) */
  clientToId?: Record<string, string>;
  /** LLM token consumption (worker + server, via Redis) */
  tokens?: TokenUsageBlock;
  /** Which local user eval auth bound to (bootstrap user email) */
  bootstrapUserEmail?: string;
}

export interface EvalState {
  version: 1;
  savedAt: string;
  serverUrl: string;
  clientToId: Record<string, string>;
  /** memory ids that finished as processed */
  processedIds: string[];
  /** memory ids that failed ingestion */
  failedIds: string[];
}
