import { describe, expect, it } from "vitest";
import { describeCron, nextRun, parseCron, previousRun } from "./cron.ts";

const utc = (iso: string) => Date.parse(`${iso}Z`);
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString().slice(0, 16));

describe("nextRun", () => {
  it("steps every 15 minutes to the next quarter hour", () => {
    expect(iso(nextRun("*/15 * * * *", utc("2026-10-07T12:07:30")))).toBe("2026-10-07T12:15");
    expect(iso(nextRun("*/15 * * * *", utc("2026-10-07T12:45:00")))).toBe("2026-10-07T13:00");
  });

  it("never answers the moment it was asked at, only a later one", () => {
    expect(iso(nextRun("0 6 * * *", utc("2026-10-07T06:00:00")))).toBe("2026-10-08T06:00");
  });

  it("skips a weekend for 0 6 * * 1-5", () => {
    // 2026-10-09 is a Friday.
    expect(iso(nextRun("0 6 * * 1-5", utc("2026-10-09T07:00:00")))).toBe("2026-10-12T06:00");
  });

  it("finds the first of the month for 30 2 1 * *", () => {
    expect(iso(nextRun("30 2 1 * *", utc("2026-10-07T12:00:00")))).toBe("2026-11-01T02:30");
  });

  it("reads names for weekdays and months, in either case", () => {
    expect(iso(nextRun("0 9 * * MON", utc("2026-10-07T12:00:00")))).toBe("2026-10-12T09:00");
    expect(iso(nextRun("0 0 1 jan *", utc("2026-10-07T12:00:00")))).toBe("2027-01-01T00:00");
    expect(iso(nextRun("0 9 * * mon-fri", utc("2026-10-10T12:00:00")))).toBe("2026-10-12T09:00");
  });

  it("reads lists, ranges with steps, and hour ranges", () => {
    expect(iso(nextRun("5,35 8-18 * * *", utc("2026-10-07T08:36:00")))).toBe("2026-10-07T09:05");
    expect(iso(nextRun("*/30 8-18 * * *", utc("2026-10-07T18:30:00")))).toBe("2026-10-08T08:00");
    expect(iso(nextRun("0 0-6/2 * * *", utc("2026-10-07T03:00:00")))).toBe("2026-10-07T04:00");
  });

  it("takes day of month or day of week when both are restricted, as cron does", () => {
    // Oct 7 2026 is a Wednesday: the 15th or any Friday comes first, on Friday the 9th.
    expect(iso(nextRun("0 0 15 * FRI", utc("2026-10-07T12:00:00")))).toBe("2026-10-09T00:00");
  });

  it("treats 7 as Sunday", () => {
    expect(iso(nextRun("0 0 * * 7", utc("2026-10-07T12:00:00")))).toBe("2026-10-11T00:00");
  });

  it("answers null for an expression it cannot read or that never fires", () => {
    expect(nextRun("every day", 0)).toBeNull();
    expect(nextRun("61 * * * *", 0)).toBeNull();
    expect(nextRun("0 0 31 2 *", utc("2026-01-01T00:00:00"))).toBeNull();
  });
});

describe("previousRun", () => {
  it("finds the latest firing at or before the time", () => {
    expect(iso(previousRun("17 * * * *", utc("2026-10-07T12:30:00")))).toBe("2026-10-07T12:17");
    expect(iso(previousRun("0 2 * * *", utc("2026-10-07T01:00:00")))).toBe("2026-10-06T02:00");
  });
});

describe("parseCron", () => {
  it("refuses a field out of range, a bad step and the wrong number of fields", () => {
    expect(parseCron("0 24 * * *")).toBeNull();
    expect(parseCron("*/0 * * * *")).toBeNull();
    expect(parseCron("* * * *")).toBeNull();
  });
});

describe("describeCron", () => {
  it("says a plain daily, weekly or hourly cron in words and leaves the rest to the cron itself", () => {
    expect(describeCron("0 6 * * *")).toBe("every day at 06:00 UTC");
    expect(describeCron("30 14 * * 1")).toBe("every Monday at 14:30 UTC");
    expect(describeCron("17 * * * *")).toBe("every hour at :17");
    expect(describeCron("*/30 8-18 * * *")).toBeNull();
    expect(describeCron("0 6 * * 1-5")).toBeNull();
  });
});
