import { describe, expect, mock, test, beforeAll, afterAll } from "bun:test";

let ExtractionSchema: any;
let resolveOpenLoop: any, upsertOpenLoops: any, upsertStandingRule: any;

const state: {
  selectRows: Array<Array<Record<string, unknown>>>;
  inserts: Array<{ table: unknown; values: unknown }>;
  updates: Array<{ table: unknown; values: unknown }>;
} = { selectRows: [], inserts: [], updates: [] };

beforeAll(() => {
  function selectChain() {
    const terminal = async () => state.selectRows.shift() ?? [];
    return {
      from: () => ({
        where: () => ({
          limit: terminal,
          orderBy: () => ({ limit: terminal }),
        }),
      }),
    };
  }

  mock.module("@repo/db", () => ({
    db: {
      select: selectChain,
      insert: (table: unknown) => ({
        values: async (values: unknown) => {
          state.inserts.push({ table, values });
        },
      }),
      update: (table: unknown) => ({
        set: (values: unknown) => {
          state.updates.push({ table, values });
          return { where: async () => undefined };
        },
      }),
    },
    memories: {},
    reminders: {},
    rules: { id: "id", userId: "user_id", sourceMemory: "source_memory" },
    openLoops: {
      id: "id",
      userId: "user_id",
      sourceMemory: "source_memory",
      kind: "kind",
      title: "title",
      entityId: "entity_id",
      status: "status",
      embedding: "embedding",
    },
    users: {},
    entities: {},
    memoryEntities: {},
    facts: {},
    eq: () => ({}),
    and: () => ({}),
    inArray: () => ({}),
    sql: () => ({}),
    toVectorLiteral: (embedding: number[]) => `[${embedding.join(",")}]`,
    findEntityCandidates: async () => [],
    findSupersessionCandidates: async () => [],
  }));

  const extractionMod = require("./extraction");
  ExtractionSchema = extractionMod.ExtractionSchema;
  
  const pipelineMod = require("./pipeline");
  resolveOpenLoop = pipelineMod.resolveOpenLoop;
  upsertOpenLoops = pipelineMod.upsertOpenLoops;
  upsertStandingRule = pipelineMod.upsertStandingRule;
});

afterAll(() => {
  mock.restore();
});

const baseExtraction = {
  occurredAt: null,
  types: ["semantic"] as const,
  entities: [],
  facts: [],
  intent: null,
};

describe("procedural extraction fields", () => {
  test("requires an explicit shape for a standing rule and open loop", () => {
    expect(
      ExtractionSchema.safeParse({
        ...baseExtraction,
        standingRule: { ruleText: "Review the post", triggerText: "before posting" },
        openLoops: [
          {
            kind: "unresolved_conflict",
            title: "Equity split with Rahul is unresolved",
            entityRef: "Rahul",
            dueAt: null,
          },
        ],
        resolvesLoop: null,
      }).success,
    ).toBe(true);
    expect(
      ExtractionSchema.safeParse({
        ...baseExtraction,
        standingRule: { ruleText: "", triggerText: "before posting" },
        openLoops: [],
        resolvesLoop: null,
      }).success,
    ).toBe(false);
  });
});

describe("derived pipeline stages", () => {
  test("does not mutate an existing rule on re-ingest (insert-if-absent)", async () => {
    // A rule already owns this sourceMemory (e.g. edit-as-correction pre-insert
    // or a prior successful ingestion). Never UPDATE its text — immutability.
    state.selectRows = [[{ id: "rule-1" }]];
    state.inserts = [];
    state.updates = [];
    await upsertStandingRule({
      userId: "user",
      memoryId: "memory",
      standingRule: { ruleText: "Check it", triggerText: "before publishing" },
      triggerEmbedding: [0.1],
    });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  test("inserts a standing rule when none exists for the source memory", async () => {
    state.selectRows = [[]];
    state.inserts = [];
    state.updates = [];
    await upsertStandingRule({
      userId: "user",
      memoryId: "memory",
      standingRule: { ruleText: "Check it", triggerText: "before publishing" },
      triggerEmbedding: [0.1],
    });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]!.values).toMatchObject({
      userId: "user",
      sourceMemory: "memory",
      ruleText: "Check it",
      triggerText: "before publishing",
      triggerEmbedding: [0.1],
    });
  });

  test("resolves only an entity-matched, high-confidence existing loop", async () => {
    state.selectRows = [[{ id: "loop-1", distance: 0.11 }]];
    state.updates = [];
    await expect(
      resolveOpenLoop({
        userId: "user",
        memoryId: "memory",
        resolvesLoop: "We settled the equity split",
        resolution: new Map([["rahul", "entity-1"]]),
        extractedEntities: [
          { surface: "Rahul", type: "person", canonicalGuess: "Rahul" },
        ],
        embedding: [0.1, 0.2],
      }),
    ).resolves.toBe("loop-1");
    expect(state.updates).toHaveLength(1);
  });

  test("are safe no-ops when extraction has no high-precision signal", async () => {
    await expect(
      upsertStandingRule({
        userId: "user",
        memoryId: "memory",
        standingRule: null,
        triggerEmbedding: [],
      }),
    ).resolves.toBeUndefined();
    await expect(
      upsertOpenLoops({
        userId: "user",
        memoryId: "memory",
        loops: [],
        resolution: new Map(),
        embeddings: [],
      }),
    ).resolves.toBeUndefined();
    await expect(
      resolveOpenLoop({
        userId: "user",
        memoryId: "memory",
        resolvesLoop: "We settled it",
        resolution: new Map(),
        extractedEntities: [],
        embedding: [0.1, 0.2],
      }),
    ).resolves.toBeNull();
  });
});
