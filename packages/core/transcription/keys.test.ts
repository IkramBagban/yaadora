import { describe, expect, it } from "bun:test";
import {
  AllKeysExhaustedError,
  createKeyPool,
  isKeyExhaustedError,
  parseKeys,
} from "./keys";
import { buildBiasPrompt } from "./groq";

/** Helper: an error shaped like a failed HTTP call. */
function httpError(status: number, message = "failed"): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("parseKeys", () => {
  it("splits, trims, and drops empties", () => {
    expect(parseKeys(" a , b ,, c ")).toEqual(["a", "b", "c"]);
  });

  it("returns [] for undefined or blank", () => {
    expect(parseKeys(undefined)).toEqual([]);
    expect(parseKeys("   ")).toEqual([]);
    expect(parseKeys(",,,")).toEqual([]);
  });

  it("handles a single key with no commas", () => {
    expect(parseKeys("gsk_only")).toEqual(["gsk_only"]);
  });
});

describe("isKeyExhaustedError", () => {
  it("treats rate limits and dead credentials as rotatable", () => {
    expect(isKeyExhaustedError(httpError(429))).toBe(true);
    expect(isKeyExhaustedError(httpError(401))).toBe(true);
    expect(isKeyExhaustedError(httpError(403))).toBe(true);
    expect(isKeyExhaustedError(new Error("Rate limit reached"))).toBe(true);
    expect(isKeyExhaustedError(new Error("quota exceeded"))).toBe(true);
    expect(isKeyExhaustedError(new Error("Invalid API Key"))).toBe(true);
  });

  it("does not rotate on request-shape errors", () => {
    expect(isKeyExhaustedError(httpError(400, "bad audio"))).toBe(false);
    expect(isKeyExhaustedError(httpError(500, "server blew up"))).toBe(false);
    expect(isKeyExhaustedError(new Error("ECONNRESET"))).toBe(false);
  });
});

describe("createKeyPool", () => {
  it("throws a helpful error when no keys are configured", async () => {
    const pool = createKeyPool([]);
    expect(pool.size).toBe(0);
    await expect(pool.run(async () => "never")).rejects.toThrow(
      /No API key configured/,
    );
  });

  it("uses the first key when it works", async () => {
    const pool = createKeyPool(["a", "b"]);
    const used: string[] = [];
    const out = await pool.run(async (key) => {
      used.push(key);
      return "ok";
    });
    expect(out).toBe("ok");
    expect(used).toEqual(["a"]);
  });

  it("rotates to the next key on a rate limit", async () => {
    const pool = createKeyPool(["a", "b", "c"]);
    const used: string[] = [];
    const out = await pool.run(async (key) => {
      used.push(key);
      if (key !== "c") throw httpError(429);
      return "ok";
    });
    expect(out).toBe("ok");
    expect(used).toEqual(["a", "b", "c"]);
  });

  it("propagates non-rotatable errors immediately without burning keys", async () => {
    const pool = createKeyPool(["a", "b", "c"]);
    const used: string[] = [];
    await expect(
      pool.run(async (key) => {
        used.push(key);
        throw httpError(400, "unsupported audio type");
      }),
    ).rejects.toThrow(/unsupported audio type/);
    // Only the first key should have been tried — a 400 fails identically on all.
    expect(used).toEqual(["a"]);
  });

  it("throws AllKeysExhaustedError once every key is spent", async () => {
    const pool = createKeyPool(["a", "b"]);
    await expect(
      pool.run(async () => {
        throw httpError(429);
      }),
    ).rejects.toBeInstanceOf(AllKeysExhaustedError);
  });

  it("sticks to the working key on the next call", async () => {
    const pool = createKeyPool(["dead", "live"]);

    // First call: "dead" 429s, "live" succeeds.
    const first: string[] = [];
    await pool.run(async (key) => {
      first.push(key);
      if (key === "dead") throw httpError(429);
      return "ok";
    });
    expect(first).toEqual(["dead", "live"]);

    // Second call should start at "live" rather than retrying "dead".
    const second: string[] = [];
    await pool.run(async (key) => {
      second.push(key);
      return "ok";
    });
    expect(second).toEqual(["live"]);
  });

  it("advances past a bad key even when a later key succeeds", async () => {
    const pool = createKeyPool(["a", "b", "c"]);
    await pool.run(async (key) => {
      if (key === "a" || key === "b") throw httpError(429);
      return "ok";
    });

    const next: string[] = [];
    await pool.run(async (key) => {
      next.push(key);
      return "ok";
    });
    expect(next).toEqual(["c"]);
  });

  it("reports rotations through the hook", async () => {
    const rotated: number[] = [];
    const pool = createKeyPool(["a", "b"], (index) => rotated.push(index));
    await pool.run(async (key) => {
      if (key === "a") throw httpError(429);
      return "ok";
    });
    expect(rotated).toEqual([0]);
  });
});

describe("buildBiasPrompt", () => {
  it("returns null when there is nothing to bias toward", () => {
    expect(buildBiasPrompt(undefined)).toBeNull();
    expect(buildBiasPrompt([])).toBeNull();
    expect(buildBiasPrompt(["a", " "])).toBeNull(); // too short to be a name
  });

  it("joins names into a comma-separated prompt", () => {
    expect(buildBiasPrompt(["Adeeba", "Yaadora", "Ikram"])).toBe(
      "Adeeba, Yaadora, Ikram",
    );
  });

  it("de-duplicates case-insensitively, keeping first spelling", () => {
    expect(buildBiasPrompt(["Adeeba", "adeeba", "ADEEBA"])).toBe("Adeeba");
  });

  it("drops junk that would waste prompt budget", () => {
    const out = buildBiasPrompt(["Zara", "x", "y".repeat(80), "Mom"]);
    expect(out).toBe("Zara, Mom");
  });

  it("caps the term count", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Name${i}`);
    const out = buildBiasPrompt(many)!;
    expect(out.split(", ").length).toBeLessThanOrEqual(60);
  });

  it("never leaves a truncated name at the end", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Verylongname${i}`);
    const out = buildBiasPrompt(long)!;
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out.endsWith(",")).toBe(false);
    // Every term that survived should be intact, not sliced mid-word.
    for (const term of out.split(", ")) {
      expect(long).toContain(term);
    }
  });
});
