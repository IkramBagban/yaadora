/**
 * Lightweight mobile logger — shows in Metro / Expo console.
 * Never logs secrets (tokens, passwords). Safe for auth debugging.
 *
 * Enable verbose auth/API traces with EXPO_PUBLIC_DEBUG_AUTH=1 (default on
 * in __DEV__).
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function debugAuthEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  return process.env.EXPO_PUBLIC_DEBUG_AUTH === '1';
}

function threshold(): number {
  // In production builds only show warn+ unless explicitly enabled.
  if (typeof __DEV__ !== 'undefined' && !__DEV__ && process.env.EXPO_PUBLIC_DEBUG_AUTH !== '1') {
    return LEVEL_ORDER.warn;
  }
  return LEVEL_ORDER.debug;
}

function redactToken(token: string | null | undefined): string {
  if (!token) return '<none>';
  if (token.length < 16) return `<token len=${token.length}>`;
  return `<jwt len=${token.length} head=${token.slice(0, 12)}…>`;
}

function fmt(ns: string, level: Level, msg: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const extra = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
  return `[${ts}] ${level.toUpperCase().padEnd(5)} [mobile:${ns}] ${msg}${extra}`;
}

export function createMobileLogger(ns: string) {
  const emit = (level: Level, msg: string, data?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < threshold()) return;
    if (level === 'debug' && !debugAuthEnabled() && ns.startsWith('auth')) return;

    const line = fmt(ns, level, msg, data);
    switch (level) {
      case 'error':
        console.error(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'info':
        console.log(line);
        break;
      default:
        console.log(line);
    }
  };

  return {
    debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
    /** Safe token summary for logs — never the full JWT. */
    tokenSummary: redactToken,
  };
}
