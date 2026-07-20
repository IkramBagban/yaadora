import { describe, expect, it } from "bun:test";
import {
  findDuplicateReminder,
  reminderTextSimilarity,
  tokenizeReminderText,
  type DuplicateCandidate,
} from "./reminder-dedupe";

const BASE = new Date("2026-07-26T15:00:00.000Z");

function at(hoursOffset: number): Date {
  return new Date(BASE.getTime() + hoursOffset * 60 * 60 * 1000);
}

function candidate(
  id: string,
  text: string,
  hoursOffset = 0,
): DuplicateCandidate {
  return { id, text, dueAt: at(hoursOffset) };
}

describe("tokenizeReminderText", () => {
  it("lowercases and drops punctuation", () => {
    expect(tokenizeReminderText("Call Mom!")).toEqual(["call", "mom"]);
  });

  it("drops stopwords that carry no signal", () => {
    expect(tokenizeReminderText("remind me to call the bank")).toEqual([
      "call",
      "bank",
    ]);
  });

  it("returns empty for an all-stopword string", () => {
    expect(tokenizeReminderText("remind me about the")).toEqual([]);
  });
});

describe("reminderTextSimilarity", () => {
  it("scores identical text as 1", () => {
    expect(reminderTextSimilarity("Call mom", "call mom")).toBe(1);
  });

  it("ignores reminder boilerplate", () => {
    expect(reminderTextSimilarity("Remind me to call mom", "Call mom")).toBe(1);
  });

  it("scores unrelated text at 0", () => {
    expect(reminderTextSimilarity("Call mom", "Buy milk")).toBe(0);
  });

  it("does not over-score on a shared common verb", () => {
    // "call the bank" vs "call the doctor" share only "call" after stopwords.
    const score = reminderTextSimilarity("call the bank", "call the doctor");
    expect(score).toBeLessThan(0.7);
  });

  it("is symmetric", () => {
    const a = reminderTextSimilarity("call mom", "call mom tomorrow");
    const b = reminderTextSimilarity("call mom tomorrow", "call mom");
    expect(a).toBe(b);
  });

  it("returns 0 when either side reduces to nothing", () => {
    expect(reminderTextSimilarity("remind me to", "call mom")).toBe(0);
    expect(reminderTextSimilarity("", "call mom")).toBe(0);
  });
});

describe("findDuplicateReminder", () => {
  it("returns null when there are no candidates", () => {
    expect(findDuplicateReminder("Call mom", BASE, [])).toBeNull();
  });

  it("catches the same reminder asked for twice", () => {
    const match = findDuplicateReminder("Call mom", BASE, [
      candidate("r1", "Call mom"),
    ]);
    expect(match?.id).toBe("r1");
  });

  it("catches a reworded restatement", () => {
    const match = findDuplicateReminder("remind me to call mom", BASE, [
      candidate("r1", "Call mom"),
    ]);
    expect(match?.id).toBe("r1");
  });

  it("does not flag a different task at the same time", () => {
    const match = findDuplicateReminder("Buy milk", BASE, [
      candidate("r1", "Call mom"),
    ]);
    expect(match).toBeNull();
  });

  it("does not flag similar-but-distinct errands", () => {
    const match = findDuplicateReminder("call the doctor", BASE, [
      candidate("r1", "call the bank"),
    ]);
    expect(match).toBeNull();
  });

  it("does not flag the same task on a different day", () => {
    // Same text, 48h apart — a deliberate second occurrence, not a duplicate.
    const match = findDuplicateReminder("Call mom", BASE, [
      candidate("r1", "Call mom", 48),
    ]);
    expect(match).toBeNull();
  });

  it("still flags within the time window", () => {
    const match = findDuplicateReminder("Call mom", BASE, [
      candidate("r1", "Call mom", 6),
    ]);
    expect(match?.id).toBe("r1");
    expect(match?.hoursApart).toBe(6);
  });

  it("picks the strongest match when several are close", () => {
    const match = findDuplicateReminder("call mom about the tickets", BASE, [
      candidate("weak", "call mom", 1),
      candidate("strong", "call mom about tickets", 1),
    ]);
    expect(match?.id).toBe("strong");
  });

  it("respects a custom threshold", () => {
    const strict = findDuplicateReminder(
      "call mom",
      BASE,
      [candidate("r1", "call mom tomorrow")],
      { threshold: 0.9 },
    );
    expect(strict).toBeNull();

    const loose = findDuplicateReminder(
      "call mom",
      BASE,
      [candidate("r1", "call mom tomorrow")],
      { threshold: 0.4 },
    );
    expect(loose?.id).toBe("r1");
  });

  it("respects a custom time window", () => {
    const wide = findDuplicateReminder(
      "Call mom",
      BASE,
      [candidate("r1", "Call mom", 48)],
      { windowHours: 72 },
    );
    expect(wide?.id).toBe("r1");
  });

  it("reports the similarity it matched on", () => {
    const match = findDuplicateReminder("Call mom", BASE, [
      candidate("r1", "Call mom"),
    ]);
    expect(match?.similarity).toBe(1);
  });
});
