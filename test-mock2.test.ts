import { mock, test } from "bun:test";
mock.module("@repo/db", () => ({ 
  sql: () => ({}),
  db: {}, memories: {}, reminders: {}, rules: {}, openLoops: {}, users: {}, eq: {}, and: {}, inArray: {}, toVectorLiteral: {} 
}));
test("foo", () => {
  require("./packages/core/ingestion/pipeline.ts");
});
