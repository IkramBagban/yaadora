import { describe, expect, test, mock, beforeAll, afterAll } from "bun:test";

/**
 * Turn-time entity linker precision (spec 03 P3). Hermetic: `@repo/db` is
 * mocked, and the linker takes injected `entities` + `embedTurn`, so nothing
 * touches Postgres or an embedding API. The shared `decideEntityLink` thresholds
 * are exercised directly too.
 */

let distanceReturn: Map<string, number> = new Map();
let linkTurnEntities: any;
let decideEntityLink: any;

beforeAll(() => {
  mock.module("@repo/db", () => ({
    listLinkableEntities: async () => [],
    entityEmbeddingDistances: async () => distanceReturn,
    db: {},
    entities: {},
    memoryEntities: {},
    findEntityCandidates: async () => [],
    sql: () => ({}),
    eq: () => ({}),
  }));

  linkTurnEntities = require("./entity-linker").linkTurnEntities;
  decideEntityLink = require("../ingestion/linking").decideEntityLink;
});

afterAll(() => {
  mock.restore();
});

interface Ent {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
}
function ent(id: string, name: string, type = "person", aliases: string[] = []): Ent {
  return { id, type, canonicalName: name, aliases };
}

describe("decideEntityLink (shared thresholds)", () => {
  test("single exact name match → matched via exact", () => {
    expect(decideEntityLink([{ id: "a", distance: null, nameMatch: true }])).toEqual({
      kind: "matched",
      entityId: "a",
      via: "exact",
    });
  });

  test("multiple exact matches → ambiguous (never guess)", () => {
    expect(
      decideEntityLink([
        { id: "a", distance: null, nameMatch: true },
        { id: "b", distance: null, nameMatch: true },
      ]),
    ).toEqual({ kind: "ambiguous", candidateIds: ["a", "b"] });
  });

  test("one confident embedding candidate → matched via embedding", () => {
    expect(
      decideEntityLink([
        { id: "a", distance: 0.05, nameMatch: false },
        { id: "b", distance: 0.4, nameMatch: false },
      ]),
    ).toEqual({ kind: "matched", entityId: "a", via: "embedding" });
  });

  test("two near embedding candidates → ambiguous", () => {
    expect(
      decideEntityLink([
        { id: "a", distance: 0.12, nameMatch: false },
        { id: "b", distance: 0.14, nameMatch: false },
      ]).kind,
    ).toBe("ambiguous");
  });

  test("nothing near → none", () => {
    expect(
      decideEntityLink([{ id: "a", distance: 0.9, nameMatch: false }]),
    ).toEqual({ kind: "none" });
  });
});

describe("linkTurnEntities", () => {
  test("links a distinct known name and tolerates a possessive", async () => {
    const links = await linkTurnEntities({
      userId: "u",
      userTurn: "Rahul's coming to Pune next week, thinking of meeting him",
      entities: [ent("rahul", "Rahul"), ent("pune", "Pune", "place")],
    });
    const ids = links.map((l: { entityId: string }) => l.entityId).sort();
    expect(ids).toContain("rahul");
    expect(ids).toContain("pune");
  });

  test("an unknown name links to nothing", async () => {
    const links = await linkTurnEntities({
      userId: "u",
      userTurn: "I should call Zephyrina about the thing",
      entities: [ent("rahul", "Rahul")],
    });
    expect(links).toEqual([]);
  });

  test("caps at 2 entities per turn, ordered by appearance", async () => {
    const links = await linkTurnEntities({
      userId: "u",
      userTurn: "Aditya then Rahul then Priya were all there",
      entities: [
        ent("priya", "Priya"),
        ent("rahul", "Rahul"),
        ent("aditya", "Aditya"),
      ],
    });
    expect(links).toHaveLength(2);
    expect(links.map((l: { entityId: string }) => l.entityId)).toEqual([
      "aditya",
      "rahul",
    ]);
  });

  test("two entities named Urhan stay distinct: no embedding signal → no link", async () => {
    distanceReturn = new Map(); // neither profile embeds close
    const links = await linkTurnEntities({
      userId: "u",
      userTurn: "Had lunch with Urhan today",
      entities: [
        ent("urhan-dev", "Urhan", "person"),
        ent("urhan-proj", "Urhan", "project"),
      ],
      embedTurn: async () => [0.1, 0.2, 0.3],
    });
    // Prefer no link over a wrong link (read path).
    expect(links).toEqual([]);
  });

  test("two entities named Urhan: a confident embedding match resolves to one", async () => {
    distanceReturn = new Map([
      ["urhan-dev", 0.05],
      ["urhan-proj", 0.42],
    ]);
    const links = await linkTurnEntities({
      userId: "u",
      userTurn: "Urhan shipped the auth refactor",
      entities: [
        ent("urhan-dev", "Urhan", "person"),
        ent("urhan-proj", "Urhan", "project"),
      ],
      embedTurn: async () => [0.1, 0.2, 0.3],
    });
    expect(links.map((l: { entityId: string }) => l.entityId)).toEqual([
      "urhan-dev",
    ]);
  });

  test("no entities → no links, no embedding call", async () => {
    let embedCalled = false;
    const links = await linkTurnEntities({
      userId: "u",
      userTurn: "anything at all",
      entities: [],
      embedTurn: async () => {
        embedCalled = true;
        return [];
      },
    });
    expect(links).toEqual([]);
    expect(embedCalled).toBe(false);
  });
});
