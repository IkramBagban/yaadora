import { test, mock } from "bun:test";
mock.module("@repo/db", () => {
  return {
    sql: () => ({}),
    db: {}, memories: {}, reminders: {}, rules: {}, openLoops: {}, users: {}, entities: {}, memoryEntities: {}, facts: {}, eq: {}, and: {}, inArray: {}, toVectorLiteral: {}, findEntityCandidates: {}, findSupersessionCandidates: {}
  }
});
test("foo", () => {
  require("./packages/core/ingestion/pipeline.ts");
});
