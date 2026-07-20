import { describe, expect, it } from "bun:test";
import { appendTranscript } from "./appendTranscript";

describe("appendTranscript", () => {
  it("returns the transcript when the input is empty", () => {
    expect(appendTranscript("", "called mom today")).toBe("called mom today");
    expect(appendTranscript("   ", "called mom")).toBe("called mom");
  });

  it("leaves existing text untouched when nothing was heard", () => {
    expect(appendTranscript("half a thought", "")).toBe("half a thought");
    expect(appendTranscript("half a thought", "   ")).toBe("half a thought");
  });

  it("continues after a finished sentence with a single space", () => {
    expect(appendTranscript("Went for a run.", "Felt good")).toBe(
      "Went for a run. Felt good",
    );
  });

  it("closes an unfinished sentence before appending", () => {
    expect(appendTranscript("Went for a run", "Felt good")).toBe(
      "Went for a run. Felt good",
    );
  });

  it("respects other terminal punctuation", () => {
    expect(appendTranscript("Did I?", "Apparently")).toBe("Did I? Apparently");
    expect(appendTranscript("Wow!", "Great day")).toBe("Wow! Great day");
    expect(appendTranscript("Hmm…", "Anyway")).toBe("Hmm… Anyway");
  });

  it("keeps a trailing comma as a continuation", () => {
    expect(appendTranscript("Met Zara,", "then went home")).toBe(
      "Met Zara, then went home",
    );
  });

  it("normalises trailing whitespace before joining", () => {
    expect(appendTranscript("A thought.   ", "  another  ")).toBe(
      "A thought. another",
    );
  });

  it("is additive across repeated dictations", () => {
    let text = "";
    text = appendTranscript(text, "First thing");
    text = appendTranscript(text, "Second thing");
    text = appendTranscript(text, "Third thing");
    expect(text).toBe("First thing. Second thing. Third thing");
  });

  it("never discards typed text", () => {
    const typed = "I typed this myself";
    const out = appendTranscript(typed, "and dictated this");
    expect(out.startsWith(typed)).toBe(true);
    expect(out).toContain("and dictated this");
  });
});
