import { mock } from "bun:test";
mock.module("@repo/db", () => ({ sql: () => ({}) }));
require("./packages/core/ingestion/pipeline.ts");
