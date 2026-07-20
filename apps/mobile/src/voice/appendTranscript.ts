/**
 * Merge a transcript into whatever is already in the input.
 *
 * Dictation is additive, not destructive: people often type a few words, then
 * switch to voice, then keep typing. Replacing the field would silently eat
 * their text — and with no audio kept, there's nothing to recover from.
 */
export function appendTranscript(existing: string, transcript: string): string {
  const addition = transcript.trim();
  if (!addition) return existing;

  const base = existing.trimEnd();
  if (!base) return addition;

  // Continue the sentence if the user left it open; otherwise start a new one.
  const endsSentence = /[.!?…]$/.test(base);
  const separator = endsSentence ? ' ' : base.endsWith(',') ? ' ' : '. ';

  return `${base}${separator}${addition}`;
}
