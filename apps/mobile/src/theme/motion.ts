/**
 * One motion language for the whole app: physical springs for anything the
 * user "touches", short fades for anything ambient. Nothing ever blocks input.
 */

export const springs = {
  /** Default for layout / content movement. */
  standard: { damping: 18, stiffness: 220, mass: 1 },
  /** Buttons, tab indicator — crisp response to a finger. */
  snappy: { damping: 20, stiffness: 300, mass: 0.8 },
  /** Ambient drift (status pills, toasts settling). */
  gentle: { damping: 22, stiffness: 160, mass: 1 },
} as const;

export const durations = {
  quick: 120,
  fade: 180,
  enter: 240,
} as const;

/** Per-item delay for staggered list/chip entrances. */
export const staggerMs = 40;
