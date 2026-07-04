// @repo/logger — shared, dependency-free logger for the server, worker + core.
// Console output always; appends to logs/<service>.log only in development.
export { createLogger, initLogging } from "./logger";
export type { Logger, LogLevel, LogContext } from "./logger";
