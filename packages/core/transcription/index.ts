/**
 * Speech-to-text (spec: voice capture).
 *
 * Voice is an *input method* for the text box, not a new memory type. Audio is
 * transcribed and immediately discarded; the transcript flows through the exact
 * same capture path as typed text, and the user proofreads it before saving.
 * Nothing here touches the memories table.
 */

export {
  transcribeAudio,
  isTranscriptionConfigured,
  buildBiasPrompt,
  MAX_AUDIO_BYTES,
} from "./groq";
export type { TranscribeInput, TranscribeResult } from "./groq";

export { getBiasTermsForUser, invalidateBiasTerms } from "./bias";

export {
  parseKeys,
  createKeyPool,
  isKeyExhaustedError,
  AllKeysExhaustedError,
} from "./keys";
export type { KeyPool } from "./keys";
