/**
 * Proactive brain (spec 02 §5.4, §3.3, §6) — awareness pass + deterministic
 * gates + prospection helpers. P2 enables date/loop kinds only.
 */

export {
  runGates,
  gateLedger,
  gateAlreadyKnown,
  gateSeam,
  gateEvidence,
  gateBudget,
  isInQuietHours,
  localMinutesOfDay,
  localDateString,
  parseTimeToMinutes,
  isPrepTypeTitle,
  localDaysUntil,
  hardBlockMidTask,
  // re-exported for workers / evals
  P2_ENABLED_KINDS,
  LOOKUP_KINDS,
  IGNORED_COOLDOWN_DAYS,
} from "./gates";
export type {
  NudgeCandidate,
  LedgerEntry,
  GateInput,
  GateOutcome,
  SuppressedReason,
  Seam,
  Channel,
} from "./gates";

export {
  runAwarenessPass,
  runAwarenessModel,
  AWARENESS_DEADLINE_MS,
} from "./awareness";
export type {
  AwarenessAttachment,
  AwarenessHistoryTurn,
  AwarenessPassInput,
  AwarenessPassResult,
} from "./awareness";

export {
  loadAwarenessCandidates,
  loadPriorSurfacingIds,
  loadSubjectLedger,
  userMentionedSubjectRecently,
  countConversationNudges,
  countDailySurfacings,
  loadUserBudgetSettings,
  markSurfacingEngaged,
  evaluateAndRecord,
  userHadConversationToday,
  scanProspectionCandidates,
} from "./candidates";

export { generatePushCopy, sendExpoPush } from "./push";
