import { pino } from "pino";

export type Logger = ReturnType<typeof pino>;

export function createLogger(env: NodeJS.ProcessEnv): Logger {
  return pino({
    level: env.LOG_LEVEL ?? "info",
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
