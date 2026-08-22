export { db, queryClient } from "./client";
export { conversationTurns, conversations, digests, entities, entityEdges, evalCases, facts, memories, memoryEntities, openLoops, pushTokens, reminders, rules, surfacings, tsvector, users } from "./schema";
export { ABSENCE_MIN_DROP_RATIO, ABSENCE_MIN_LIFETIME_MENTIONS, ABSENCE_MIN_MONTHS_SILENT, entityEmbeddingDistances, expireStaleOpenLoops, findCommitmentLoopCandidates, findDuplicateFactPairs, findEntitiesTouchedSince, findEntityCandidates, findNearbyPendingReminders, findSupersessionCandidates, flagEntityEdge, getAbsenceCandidates, getCurrentFactTextsForEntity, getDigest, getDueOpenLoops, getDueReminders, searchReminders, getEntityContextCore, getEntityProfiles, getFollowUpLoopCandidates, getMemoriesByIds, getNotableEdgesForEntity, getOneHopEdges, getOpenLoopsForEntities, getOpenLoopsForEntity, getGraphSnapshot, getRaisingHistoryForSubjects, getRecentConversationSummaries, getRecentEpisodicMemories, getSinceThenForEntity, getSurfaceablePatternInsights, getTopCurrentFactsForEntity, meetsAbsenceFloors, getUserProfileFactTexts, graphSearchFacts, graphSearchMemories, hybridSearch, lexicalSearchMemories, listLinkableEntities, listUserIdsWithMemories, materializeEntityEdges, mergeDuplicateFact, rescoreSalience, temporalSearchFacts, temporalSearchMemories, toVectorLiteral, updateEntityProfile, upsertDigest, vectorSearchFacts, vectorSearchMemories } from "./queries";
// Web backend-gaps wave — dedicated modules (never append to queries.ts).
export { createManualLoop, listOpenLoops, patchOpenLoop } from "./queries/open-loops";
export { listFactsAdmin, patchFactAdmin } from "./queries/facts-admin";
export { getStatsOverview, getMemoriesTimeseries, getSurfacingsSummary } from "./queries/stats";
export type { StatsBucket } from "./queries/stats";
export { mergeEntities } from "./queries/entities-merge";
// Type-only re-exports: the named value re-exports above do not carry the
// interface/type declarations that cross-package consumers import (NewFact,
// RetrievedMemory, LinkableEntity, CommitmentLoopCandidate, …). These bring the
// full type surface across the `@repo/db` boundary. Type-only, zero runtime.
export type * from "./schema";
export type * from "./queries";
export { sql, eq, and, or, desc, asc, isNull, inArray, gt, gte, lt, lte } from "drizzle-orm";
