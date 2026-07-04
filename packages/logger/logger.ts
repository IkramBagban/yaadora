import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  type WriteStream,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * @repo/logger — one tiny, dependency-free logger shared by the server, the
 * worker and @repo/core.
 *
 * Design goals:
 *  - Reusable: `createLogger("namespace")` anywhere; the namespace is just a
 *    label on each line, NOT the destination file.
 *  - Process-scoped files: every log line from a single process (including lines
 *    emitted deep inside @repo/core) is written to ONE file named after the
 *    process — `logs/server.log` or `logs/worker.log`. The process declares its
 *    name once via `initLogging("server" | "worker")`.
 *  - Dev-only files: file output happens ONLY when NODE_ENV === "development".
 *    Console output always happens (stdout/stderr), respecting LOG_LEVEL.
 *
 * No external deps — this must be importable from every runtime the monorepo
 * uses (Bun for the apps, Node for tooling/tests).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** ANSI colours for console readability (files stay plain text). */
const COLOR: Record<LogLevel, string> = {
  debug: "\x1b[2;37m", // dim grey
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};
const COLOR_RESET = "\x1b[0m";
const COLOR_DIM = "\x1b[2m";

function isDevelopment(): boolean {
  return (process.env.NODE_ENV ?? "").toLowerCase() === "development";
}

/** The active minimum level. LOG_LEVEL overrides; default debug in dev, else info. */
function activeThreshold(): number {
  const fromEnv = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (fromEnv && fromEnv in LEVEL_WEIGHT) return LEVEL_WEIGHT[fromEnv];
  return isDevelopment() ? LEVEL_WEIGHT.debug : LEVEL_WEIGHT.info;
}

// --- process-level service name (drives the file name) ---------------------

let serviceName: string | null = process.env.LOG_SERVICE ?? null;

/**
 * Declare the current process's service name. Call ONCE at the top of an app
 * entrypoint (server / worker) before anything logs. Determines the log file
 * (`logs/<service>.log`). Safe to call again (last one wins).
 */
export function initLogging(service: string): void {
  serviceName = service;
  process.env.LOG_SERVICE = service;
  if (isDevelopment()) {
    // Touch the file eagerly so `logs/<service>.log` exists as soon as the
    // process boots, even before the first log line.
    getStream();
  }
}

// --- repo-root + log-dir resolution ----------------------------------------

let cachedLogDir: string | null = null;

/** Walk up from `process.cwd()` to the monorepo root (marked by turbo.json). */
function findRepoRoot(): string {
  let dir = process.cwd();
  // Guard against infinite loops at the filesystem root.
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "turbo.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function logDir(): string {
  if (cachedLogDir) return cachedLogDir;
  const override = process.env.LOG_DIR;
  cachedLogDir = override ? resolve(override) : join(findRepoRoot(), "logs");
  return cachedLogDir;
}

// --- file stream (lazy, cached per resolved file) --------------------------

const streams = new Map<string, WriteStream>();

function getStream(): WriteStream | null {
  if (!isDevelopment()) return null;
  const file = join(logDir(), `${serviceName ?? "app"}.log`);
  const existing = streams.get(file);
  if (existing) return existing;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const stream = createWriteStream(file, { flags: "a" });
    stream.on("error", (err) => {
      // Never let logging crash the process; fall back to stderr once.
      console.error(`[logger] file stream error for ${file}:`, err);
    });
    streams.set(file, stream);
    return stream;
  } catch (err) {
    // As a last resort try a synchronous append; if that also fails, give up
    // silently on file logging (console still works).
    try {
      mkdirSync(logDir(), { recursive: true });
      appendFileSync(file, "");
    } catch {
      /* ignore */
    }
    console.error(`[logger] could not open log file ${file}:`, err);
    return null;
  }
}

// --- serialization ---------------------------------------------------------

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

function serializeError(err: Error): SerializedError {
  return { name: err.name, message: err.message, stack: err.stack };
}

/** Normalise a context value into something JSON-safe, unwrapping Errors. */
function normaliseContext(
  context: LogContext | Error | undefined,
): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;
  if (context instanceof Error) return { err: serializeError(context) };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function safeStringify(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{"_logError":"unserializable context"}';
  }
}

// --- the logger ------------------------------------------------------------

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext | Error): void;
  info(message: string, context?: LogContext | Error): void;
  warn(message: string, context?: LogContext | Error): void;
  error(message: string, context?: LogContext | Error): void;
  /** Derive a logger with a nested namespace, e.g. `log.child("retrieval")`. */
  child(namespace: string): Logger;
}

function write(
  namespace: string,
  level: LogLevel,
  message: string,
  context?: LogContext | Error,
): void {
  if (LEVEL_WEIGHT[level] < activeThreshold()) return;

  const ts = new Date().toISOString();
  const ctx = normaliseContext(context);
  const ctxStr = ctx && Object.keys(ctx).length ? ` ${safeStringify(ctx)}` : "";
  const levelTag = level.toUpperCase().padEnd(5);
  const plain = `${ts} ${levelTag} [${namespace}] ${message}${ctxStr}`;

  // Console (always). Colourised; warn/error go to stderr.
  const colored = `${COLOR_DIM}${ts}${COLOR_RESET} ${COLOR[level]}${levelTag}${COLOR_RESET} ${COLOR_DIM}[${namespace}]${COLOR_RESET} ${message}${ctxStr}`;
  if (level === "error" || level === "warn") console.error(colored);
  else console.log(colored);

  // File (development only).
  const stream = getStream();
  if (stream) {
    try {
      stream.write(`${plain}\n`);
    } catch {
      /* never throw from logging */
    }
  }
}

/** Create a logger bound to a `namespace` (a label shown on every line). */
export function createLogger(namespace: string): Logger {
  return {
    debug: (message, context) => write(namespace, "debug", message, context),
    info: (message, context) => write(namespace, "info", message, context),
    warn: (message, context) => write(namespace, "warn", message, context),
    error: (message, context) => write(namespace, "error", message, context),
    child: (child) => createLogger(`${namespace}:${child}`),
  };
}
