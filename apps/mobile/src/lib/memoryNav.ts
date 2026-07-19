/**
 * A tiny module-level registry of "the memory sequence the user is browsing".
 * The timeline (and other list surfaces) publish their loaded order here so
 * the memory detail screen can offer swipe prev/next without re-deriving
 * pagination. Best-effort: if an id isn't in the sequence (e.g. opened from a
 * citation), the detail screen simply hides the swipe affordance.
 */

let sequence: string[] = [];

export function setMemorySequence(ids: string[]): void {
  sequence = ids;
}

export interface MemoryNeighbors {
  prevId: string | null;
  nextId: string | null;
  index: number;
  total: number;
}

export function getMemoryNeighbors(id: string): MemoryNeighbors | null {
  const index = sequence.indexOf(id);
  if (index === -1) return null;
  return {
    // "prev" = the newer memory (up the list), "next" = older.
    prevId: index > 0 ? sequence[index - 1]! : null,
    nextId: index < sequence.length - 1 ? sequence[index + 1]! : null,
    index,
    total: sequence.length,
  };
}
