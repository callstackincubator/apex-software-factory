import { pino, type Logger, type LevelWithSilent } from "pino";

/** Structured JSON logs on stdout. Pipe through `pino-pretty` locally if you want colours. */
export function createLogger(level: LevelWithSilent): Logger {
  return pino({ level, base: { service: "api" } });
}
