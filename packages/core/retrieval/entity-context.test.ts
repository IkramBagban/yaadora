import { describe, expect, test, mock, beforeAll, afterAll } from "bun:test";

/**
 * Entity context assembler unit tests (spec 02 §5.2, spec 03 P3): caps (≤8
 * facts, ≤6 edges), receipt de-duplication, ownership (null when the entity is
 * missing), and the rendered block. Hermetic — `@repo/db` is mocked so the
 * per-piece queries return fixtures.
 */

const many = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i));

let coreReturn: unknown = {
  id: "e1",
  type: "person",
  canonicalName: "Rahul",
  profile: "Co-founder; based in Pune.",
};

let assembleEntityContext: any;
let renderEntityContext: any;
let ENTITY_FACT_CAP: any;
let ENTITY_EDGE_CAP: any;

beforeAll(() => {
  mock.module("@repo/db", () => ({
    getEntityContextCore: async () => coreReturn,
    getOpenLoopsForEntity: async () => [
      {
        id: "loop-1",
        kind: "unresolved_conflict",
        title: "Equity split with Rahul never resolved",
        dueAt: null,
        sourceMemory: "mem-loop",
      },
    ],
  // Return MORE than the caps to prove the assembler clamps them.
  getTopCurrentFactsForEntity: async () =>
    many(12, (i) => ({
      id: `f${i}`,
      predicate: "is",
      factText: `fact ${i}`,
      sourceMemory: `mem-f${i}`,
      salience: 1 - i * 0.01,
    })),
  getOneHopEdges: async () =>
    many(10, (i) => ({
      id: `edge-${i}`,
      relType: "co-founded with",
      status: i === 0 ? "ended" : "active",
      strength: 1 - i * 0.01,
      lastMentioned: null,
      evidence: [`mem-e${i}`],
      otherId: `other-${i}`,
      otherName: `Other ${i}`,
      otherType: "person",
      otherIsKnownEntity: true,
    })),
  }));

  const mod = require("./entity-context");
  assembleEntityContext = mod.assembleEntityContext;
  renderEntityContext = mod.renderEntityContext;
  ENTITY_FACT_CAP = mod.ENTITY_FACT_CAP;
  ENTITY_EDGE_CAP = mod.ENTITY_EDGE_CAP;
});

afterAll(() => {
  mock.restore();
});

describe("assembleEntityContext", () => {
  test("caps facts at ≤8 and edges at ≤6", async () => {
    const ctx = await assembleEntityContext("u", "e1");
    expect(ctx).not.toBeNull();
    expect(ENTITY_FACT_CAP).toBe(8);
    expect(ENTITY_EDGE_CAP).toBe(6);
    expect(ctx.facts.length).toBeLessThanOrEqual(ENTITY_FACT_CAP);
    expect(ctx.edges.length).toBeLessThanOrEqual(ENTITY_EDGE_CAP);
  });

  test("every item carries provenance, and receipts are the de-duped union", async () => {
    const ctx = await assembleEntityContext("u", "e1");
    for (const f of ctx.facts) expect(f.sourceMemory).toBeTruthy();
    for (const l of ctx.openLoops) expect(l.sourceMemory).toBeTruthy();
    for (const e of ctx.edges) expect(e.evidence.length).toBeGreaterThan(0);

    const expected = new Set<string>([
      "mem-loop",
      ...ctx.facts.map((f: { sourceMemory: string }) => f.sourceMemory),
      ...ctx.edges.flatMap((e: { evidence: string[] }) => e.evidence),
    ]);
    expect(new Set(ctx.receipts)).toEqual(expected);
    // No duplicates in receipts.
    expect(ctx.receipts.length).toBe(new Set(ctx.receipts).size);
  });

  test("renders a delimited block that surfaces status + receipts", async () => {
    const ctx = await assembleEntityContext("u", "e1");
    const text = renderEntityContext(ctx);
    expect(text).toContain("Rahul (person)");
    expect(text).toContain("Open threads:");
    expect(text).toContain("Connections:");
    // The ended edge status is visible (scenario 3 shape).
    expect(text).toContain("ended");
  });

  test("returns null when the entity is missing / not owned", async () => {
    coreReturn = null;
    const ctx = await assembleEntityContext("u", "missing");
    expect(ctx).toBeNull();
    coreReturn = {
      id: "e1",
      type: "person",
      canonicalName: "Rahul",
      profile: "Co-founder; based in Pune.",
    };
  });
});
