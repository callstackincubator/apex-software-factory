import { describe, expect, it } from "vitest";
import { formatAge, formatDuration, formatTime } from "./format.ts";

describe("formatDuration", () => {
  it("reads 42 s, 7 m 05 s and 1 h 12 m", () => {
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(7 * 60_000 + 5_000)).toBe("7 m 05 s");
    expect(formatDuration(72 * 60_000)).toBe("1 h 12 m");
  });
});

describe("formatTime", () => {
  const now = new Date(2026, 9, 7, 15, 0).getTime();

  it("is HH:MM today and carries the date on another day", () => {
    expect(formatTime(new Date(2026, 9, 7, 9, 5).getTime(), now)).toBe("09:05");
    expect(formatTime(new Date(2026, 9, 5, 9, 5).getTime(), now)).toBe("Oct 5 09:05");
  });
});

describe("formatAge", () => {
  it("counts seconds, minutes, hours and days", () => {
    expect([4_000, 180_000, 7_200_000, 200_000_000].map(formatAge)).toEqual([
      "4 s ago",
      "3 m ago",
      "2 h ago",
      "2 d ago",
    ]);
  });
});
