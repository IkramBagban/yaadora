import { createLogger } from "@repo/logger";
import { createKeyPool, parseKeys, type KeyPool } from "./keys";

const log = createLogger("transcription");

/**
 * Speech-to-text via Groq's OpenAI-compatible audio endpoint.
 *
 * We call the REST API directly rather than going through the Vercel AI SDK:
 * the SDK's language-model abstraction doesn't cover audio, and we need the
 * `prompt` parameter for vocabulary biasing (see `buildBiasPrompt`).
 *
 * Audio is NEVER persisted — not to disk, not to the database. The request body
 * is streamed straight through to Groq and the buffer is dropped when this
 * function returns. The transcript is the only artifact that survives.
 *
 * GROQ_API_KEY may be a single key or a comma-separated list; keys rotate on
 * 429 / quota / invalid-key errors (see ./keys.ts).
 */

const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * whisper-large-v3-turbo: ~228x realtime, the cheapest credible option, and
 * free-tier eligible (2,000 req/day). Override with GROQ_TRANSCRIPTION_MODEL —
 * `whisper-large-v3` is slower but slightly more accurate on hard audio.
 */
const DEFAULT_MODEL = "whisper-large-v3-turbo";

/** Groq rejects uploads over 25MB. A minute of 16kHz mono AAC is ~120KB. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Whisper's `prompt` is capped at 224 tokens; keep the bias list well under. */
const MAX_BIAS_TERMS = 60;
const MAX_BIAS_CHARS = 700;

export interface TranscribeInput {
  audio: Blob | File;
  /** Filename hint — Groq uses the extension to pick a decoder. */
  filename?: string;
  /** ISO-639-1 code (e.g. "en", "hi"). Omit to let Whisper auto-detect. */
  language?: string;
  /**
   * Vocabulary bias — typically the user's most-mentioned entity names. This is
   * the single highest-leverage accuracy lever: it's what stops "Adeeba" coming
   * back as "Adiba" and silently breaking recall for that person.
   */
  biasTerms?: string[];
}

export interface TranscribeResult {
  text: string;
  /** Which model produced it — worth storing if we ever re-transcribe. */
  model: string;
  /** Detected or supplied language, when Groq reports one. */
  language: string | null;
  durationMs: number;
}

let pool: KeyPool | null = null;

function getPool(): KeyPool {
  if (!pool) {
    pool = createKeyPool(parseKeys(process.env.GROQ_API_KEY), (index, err) => {
      log.warn("transcription key exhausted, rotating", {
        keyIndex: index,
        message: (err as Error)?.message,
      });
    });
  }
  return pool;
}

/** True when at least one key is configured — the server uses this to 503 early. */
export function isTranscriptionConfigured(): boolean {
  return getPool().size > 0;
}

/**
 * Turn a list of names into a Whisper `prompt`. Whisper treats the prompt as
 * "text that preceded this audio", so a comma-separated name list biases the
 * decoder toward those spellings without injecting them into the output.
 */
export function buildBiasPrompt(terms: string[] | undefined): string | null {
  if (!terms || terms.length === 0) return null;

  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const term of terms) {
    const value = term.trim();
    // Single characters and very long strings are noise, not vocabulary.
    if (value.length < 2 || value.length > 40) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
    if (cleaned.length >= MAX_BIAS_TERMS) break;
  }

  if (cleaned.length === 0) return null;

  let prompt = cleaned.join(", ");
  if (prompt.length > MAX_BIAS_CHARS) {
    prompt = prompt.slice(0, MAX_BIAS_CHARS);
    // Don't leave a half-written name at the boundary.
    const lastComma = prompt.lastIndexOf(",");
    if (lastComma > 0) prompt = prompt.slice(0, lastComma);
  }
  return prompt;
}

/** A fetch error carrying the HTTP status, so the key pool can classify it. */
class GroqHttpError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Groq transcription failed (${status}): ${body.slice(0, 300)}`);
    this.name = "GroqHttpError";
    this.status = status;
  }
}

/**
 * Transcribe an audio blob. Rotates through the configured key pool on rate
 * limits; throws `AllKeysExhaustedError` when every key is spent so the caller
 * can tell the client to fall back to on-device recognition.
 */
export async function transcribeAudio(
  input: TranscribeInput,
): Promise<TranscribeResult> {
  const model = process.env.GROQ_TRANSCRIPTION_MODEL?.trim() || DEFAULT_MODEL;
  const filename = input.filename ?? "audio.m4a";
  const biasPrompt = buildBiasPrompt(input.biasTerms);
  const started = Date.now();

  log.debug("transcription request", {
    model,
    bytes: input.audio.size,
    language: input.language ?? null,
    biasTerms: input.biasTerms?.length ?? 0,
  });

  const result = await getPool().run(async (apiKey) => {
    // Rebuilt per attempt: a FormData body can only be consumed once.
    const form = new FormData();
    form.append("file", input.audio, filename);
    form.append("model", model);
    form.append("response_format", "verbose_json");
    // Whisper hallucinates confident nonsense on silence at higher temps.
    form.append("temperature", "0");
    if (input.language) form.append("language", input.language);
    if (biasPrompt) form.append("prompt", biasPrompt);

    const res = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      throw new GroqHttpError(res.status, await res.text().catch(() => ""));
    }

    return (await res.json()) as { text?: string; language?: string };
  });

  const durationMs = Date.now() - started;
  const text = (result.text ?? "").trim();

  log.info("transcription ok", {
    model,
    durationMs,
    chars: text.length,
    language: result.language ?? null,
  });

  return {
    text,
    model,
    language: result.language ?? input.language ?? null,
    durationMs,
  };
}
