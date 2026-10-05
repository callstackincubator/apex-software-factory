import { pino, type Logger, type LevelWithSilent } from "pino";

export function createLogger(level: LevelWithSilent): Logger {
  return pino({ level, base: { service: "api" } });
}
