import { describe, expect, it } from "bun:test";
import { rerankCandidates, isRerankEnabled, type Candidate } from "./rerank";

function candidate(
  id: string,
  retrievalScore: number,
  salience = 0,
): Candidate {
  return {
    kind: "memory",
    id,
    text: `memory ${id}`,
    timestamp: null,
    memoryId: id,
    retrievalScore,
    salience,
  };
}

describe("isRerankEnabled", () => {
  const original = process.env.RERANK_ENABLED;
  const set = (v: string | undefined) => {
    if (v === undefined) delete process.env.RERANK_ENABLED;
    else process.env.RERANK_ENABLED = v;
  };

  it("is off when unset — the whole point of the change", () => {
    set(undefined);
    expect(isRerankEnabled()).toBe(false);
    set(original);
  });

  it("accepts the usual truthy spellings", () => {
    for (const v of ["true", "TRUE", "1", "yes", " true "]) {
      set(v);
      expect(isRerankEnabled()).toBe(true);
    }
    set(original);
  });

  it("treats anything else as off", () => {
    for (const v of ["false", "0", "no", "", "maybe"]) {
      set(v);
      expect(isRerankEnabled()).toBe(false);
    }
    set(original);
  });
});

describe("rerankCandidates (disabled)", () => {
  it("returns [] for an empty pool", async () => {
    const out = await rerankCandidates({
      question: "q",
      candidates: [],
      enabled: false,
    });
    expect(out).toEqual([]);
  });

  it("orders by retrieval score without any model call", async () => {
    const out = await rerankCandidates({
      question: "q",
      candidates: [candidate("low", 0.2), candidate("high", 0.9), candidate("mid", 0.5)],
      enabled: false,
    });
    expect(out.map((c) => c.id)).toEqual(["high", "mid", "low"]);
  });

  it("breaks retrieval-score ties with salience", async () => {
    const out = await rerankCandidates({
      question: "q",
      candidates: [candidate("dull", 0.5, 0.1), candidate("salient", 0.5, 0.9)],
      enabled: false,
    });
    expect(out.map((c) => c.id)).toEqual(["salient", "dull"]);
  });

  it("respects topK", async () => {
    const out = await rerankCandidates({
      question: "q",
      candidates: Array.from({ length: 30 }, (_, i) => candidate(`c${i}`, i / 30)),
      topK: 5,
      enabled: false,
    });
    expect(out.length).toBe(5);
  });

  it("populates relevance from the retrieval score so confidence stays non-null", async () => {
    const out = await rerankCandidates({
      question: "q",
      candidates: [candidate("a", 0.77)],
      enabled: false,
    });
    expect(out[0]!.relevance).toBe(0.77);
  });

  it("does not mutate the input array", async () => {
    const input = [candidate("low", 0.2), candidate("high", 0.9)];
    await rerankCandidates({ question: "q", candidates: input, enabled: false });
    expect(input.map((c) => c.id)).toEqual(["low", "high"]);
  });
});

describe("rerankCandidates (enabled, small pool)", () => {
  it("skips the model call when the pool already fits in topK", async () => {
    // enabled:true but 3 candidates and topK 12 — an LLM call cannot change
    // which items are kept, so it must short-circuit. If it tried to call the
    // model this would throw (no API key / network in tests).
    const out = await rerankCandidates({
      question: "q",
      candidates: [candidate("a", 0.3), candidate("b", 0.8), candidate("c", 0.5)],
      topK: 12,
      enabled: true,
    });
    expect(out.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
});
