import {
  transcribeAudio,
  isTranscriptionConfigured,
  getBiasTermsForUser,
  AllKeysExhaustedError,
  MAX_AUDIO_BYTES,
} from "@repo/core";
import { createLogger } from "@repo/logger";
import { authenticate } from "../auth";
import { apiError, json, badRequest, unauthorized } from "../http";

const log = createLogger("server:transcribe");

/**
 * POST /transcribe — stateless speech-to-text.
 *
 * Takes multipart audio, returns `{ text }`. Writes NOTHING: no database row,
 * no file on disk, no log of the transcript body. The client puts the text in
 * the capture input, the user edits it, and saving goes through POST /memories
 * like any typed memory. The sacred fast path is untouched.
 *
 * Failure contract — the client falls back to on-device recognition on:
 *   503 transcription_unavailable  (no keys configured / every key exhausted)
 * ...and only surfaces a hard error otherwise.
 */

/** Accepted upload types. Whisper decodes all of these server-side. */
const ALLOWED_AUDIO_PREFIXES = ["audio/", "video/mp4", "video/webm"];

/** Guard against pointless round-trips for an empty tap of the mic button. */
const MIN_AUDIO_BYTES = 512;

function isAllowedType(type: string): boolean {
  if (!type) return true; // some RN clients omit the part's content-type
  return ALLOWED_AUDIO_PREFIXES.some((p) => type.startsWith(p));
}

export async function transcribe(req: Request): Promise<Response> {
  const userId = await authenticate(req);
  if (!userId) return unauthorized();

  if (!isTranscriptionConfigured()) {
    log.warn("transcription requested but GROQ_API_KEY is not set");
    return apiError(
      "transcription_unavailable",
      "Speech-to-text is not configured on this server.",
      503,
    );
  }

  // Inferred, not annotated: Bun's and undici's FormData types differ slightly
  // and an explicit `FormData` annotation fails to typecheck across them.
  let form: Awaited<ReturnType<Request["formData"]>>;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Body must be multipart/form-data with an 'audio' file.");
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return badRequest("Missing 'audio' file part.");
  }

  if (audio.size < MIN_AUDIO_BYTES) {
    // Not an error the user should see as a failure — just nothing was said.
    return json({ text: "", model: null, language: null, empty: true });
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return badRequest(
      `Audio too large (${Math.round(audio.size / 1024 / 1024)}MB). Limit is 25MB.`,
    );
  }

  const type = audio.type ?? "";
  if (!isAllowedType(type)) {
    return badRequest(`Unsupported audio type: ${type}`);
  }

  const languageRaw = form.get("language");
  const language =
    typeof languageRaw === "string" && languageRaw.trim().length > 0
      ? languageRaw.trim().slice(0, 10)
      : undefined;

  const filenameRaw = form.get("filename");
  const filename =
    typeof filenameRaw === "string" && filenameRaw.trim().length > 0
      ? filenameRaw.trim()
      : (audio as File).name || "audio.m4a";

  // Bias Whisper toward names this user actually talks about. Best-effort.
  const biasTerms = await getBiasTermsForUser(userId);

  try {
    const result = await transcribeAudio({
      audio,
      filename,
      language,
      biasTerms,
    });

    // Deliberately logging only the shape, never the transcript itself.
    log.info("transcribed", {
      userId,
      bytes: audio.size,
      chars: result.text.length,
      durationMs: result.durationMs,
      biasTerms: biasTerms.length,
    });

    return json({
      text: result.text,
      model: result.model,
      language: result.language,
      empty: result.text.length === 0,
    });
  } catch (err) {
    if (err instanceof AllKeysExhaustedError) {
      log.warn("all transcription keys exhausted", {
        userId,
        message: err.message,
      });
      // 503 tells the client to retry on-device rather than showing an error.
      return apiError(
        "transcription_unavailable",
        "Transcription is rate-limited right now.",
        503,
      );
    }

    log.error("transcription failed", err as any);
    return apiError(
      "transcription_failed",
      "Could not transcribe that audio.",
      502,
    );
  }
}
