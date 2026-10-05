import { z } from "zod";

/** The factory's memory branch as the console shows it (CONSOLE.md, Memory; ADR 0016). */

export const MEMORY_TOPICS = ["implement", "device", "ota", "triage", "deliver"] as const;

export const MemoryLesson = z.object({
  path: z.string(),
  topic: z.string(),
  id: z.string(),
  text: z.string(),
  by: z.string().nullable(),
  date: z.number().nullable(),
  issue: z.number().nullable(),
});
export type MemoryLesson = z.infer<typeof MemoryLesson>;

export const MemoryCurated = z.object({
  topic: z.string(),
  path: z.string(),
  markdown: z.string(),
});
export type MemoryCurated = z.infer<typeof MemoryCurated>;

export const MemoryRun = z.object({
  path: z.string(),
  startedAt: z.number().nullable(),
  mode: z.string(),
  issue: z.number().nullable(),
  attempt: z.number().nullable(),
  /** `stopped` carries the watchdog's reason; `finished` ended on its own; `unknown` was unreadable. */
  outcome: z.enum(["finished", "stopped", "unknown"]),
  reason: z.string().nullable(),
  /** The top session's time, when the digest has a stage table. */
  durationMs: z.number().nullable(),
});
export type MemoryRun = z.infer<typeof MemoryRun>;

export const MemoryRetro = z.object({
  path: z.string(),
  /** `YYYY-MM-DD` from the file name. */
  date: z.string(),
  title: z.string(),
});
export type MemoryRetro = z.infer<typeof MemoryRetro>;

export const MemoryResponse = z.object({
  generatedAt: z.number(),
  /** `empty`: the branch is not created yet, a normal state. `unavailable`: git failed. */
  status: z.enum(["ok", "empty", "unavailable"]),
  reason: z.string().optional(),
  notes: z.array(z.string()),
  lastWrittenAt: z.number().nullable(),
  counts: z.object({
    lessons: z.number(),
    curated: z.number(),
    runs: z.number(),
    retros: z.number(),
  }),
  /** The newest raw lessons per topic (capped), newest first. */
  lessons: z.array(MemoryLesson),
  curated: z.array(MemoryCurated),
  /** The newest run records (capped), newest first. */
  runs: z.array(MemoryRun),
  /** Newest first. */
  retros: z.array(MemoryRetro),
});
export type MemoryResponse = z.infer<typeof MemoryResponse>;

export const MemoryFile = z.object({ path: z.string(), markdown: z.string() });
export type MemoryFile = z.infer<typeof MemoryFile>;
