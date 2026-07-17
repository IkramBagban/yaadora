export { db, queryClient } from "./client";
export { conversationTurns, conversations, digests, entities, entityEdges, evalCases, facts, memories, memoryEntities, openLoops, pushTokens, reminders, rules, surfacings, tsvector, users } from "./schema";
export { entityEmbeddingDistances, findCommitmentLoopCandidates, findDuplicateFactPairs, findEntitiesTouchedSince, findEntityCandidates, findSupersessionCandidates, flagEntityEdge, getCurrentFactTextsForEntity, getDigest, getDueOpenLoops, getEntityContextCore, getEntityProfiles, getMemoriesByIds, getNotableEdgesForEntity, getOneHopEdges, getOpenLoopsForEntities, getOpenLoopsForEntity, getRecentConversationSummaries, getRecentEpisodicMemories, getTopCurrentFactsForEntity, getUserProfileFactTexts, graphSearchFacts, graphSearchMemories, hybridSearch, lexicalSearchMemories, listLinkableEntities, listUserIdsWithMemories, materializeEntityEdges, mergeDuplicateFact, rescoreSalience, temporalSearchFacts, temporalSearchMemories, toVectorLiteral, updateEntityProfile, upsertDigest, vectorSearchFacts, vectorSearchMemories } from "./queries";
// Type-only re-exports: the named value re-exports above do not carry the
// interface/type declarations that cross-package consumers import (NewFact,
// RetrievedMemory, LinkableEntity, CommitmentLoopCandidate, …). These bring the
// full type surface across the `@repo/db` boundary. Type-only, zero runtime.
export type * from "./schema";
export type * from "./queries";
export { sql, eq, and, or, desc, asc, isNull, inArray, gt, gte, lt, lte } from "drizzle-orm";
