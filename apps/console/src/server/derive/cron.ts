/**
 * A small cron reader for GitHub's `on: schedule` (UTC): `*`, lists, ranges, steps, and names for
 * months and weekdays. Five fields: minute hour day-of-month month day-of-week. As in cron, a day
 * is matched by day-of-month OR day-of-week when both are restricted.
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_WORDS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  daysAny: boolean;
  weekdaysAny: boolean;
}

function value(token: string, names: readonly string[], offset: number): number | null {
  const named = names.indexOf(token.toUpperCase());
  if (named >= 0) return named + offset;
  return /^\d+$/.test(token) ? Number(token) : null;
}

function field(
  text: string,
  min: number,
  max: number,
  names: readonly string[] = [],
  offset = 0,
): Set<number> | null {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const [range = "", stepText, extra] = part.split("/");
    if (extra !== undefined || range === "") return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let from: number | null;
    let to: number | null;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [a = "", b = "", more] = range.split("-");
      if (more !== undefined) return null;
      from = value(a, names, offset);
      to = value(b, names, offset);
    } else {
      from = value(range, names, offset);
      to = stepText === undefined ? from : max;
    }
    if (from === null || to === null || from < min || to > max || from > to) return null;
    for (let n = from; n <= to; n += step) out.add(n);
  }
  return out.size === 0 ? null : out;
}

export function parseCron(expression: string): Cron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, d, mo, w] = parts as [string, string, string, string, string];
  const minutes = field(m, 0, 59);
  const hours = field(h, 0, 23);
  const days = field(d, 1, 31);
  const months = field(mo, 1, 12, MONTHS, 1);
  const rawWeekdays = field(w, 0, 7, DAYS, 0);
  if (!minutes || !hours || !days || !months || !rawWeekdays) return null;
  const weekdays = new Set([...rawWeekdays].map((n) => n % 7));
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    daysAny: d === "*" || d.startsWith("*/"),
    weekdaysAny: w === "*" || w.startsWith("*/"),
  };
}

function dayMatches(cron: Cron, date: Date): boolean {
  if (!cron.months.has(date.getUTCMonth() + 1)) return false;
  const dom = cron.days.has(date.getUTCDate());
  const dow = cron.weekdays.has(date.getUTCDay());
  if (cron.daysAny && cron.weekdaysAny) return true;
  if (cron.daysAny) return dow;
  if (cron.weekdaysAny) return dom;
  return dom || dow;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The earliest time after `from` (epoch ms) the cron fires, in UTC; null if it never does. */
export function nextRun(expression: string, from: number): number | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  const first = Math.floor(from / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const startDay = Math.floor(first / DAY_MS) * DAY_MS;
  const hours = [...cron.hours].sort((a, b) => a - b);
  const minutes = [...cron.minutes].sort((a, b) => a - b);
  for (let i = 0; i < 366 * 8; i++) {
    const day = startDay + i * DAY_MS;
    if (!dayMatches(cron, new Date(day))) continue;
    for (const h of hours) {
      for (const m of minutes) {
        const t = day + h * 3_600_000 + m * MINUTE_MS;
        if (t >= first) return t;
      }
    }
  }
  return null;
}

/** The latest time at or before `from` the cron fired, in UTC; null if it never did in 8 years. */
export function previousRun(expression: string, from: number): number | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  const last = Math.floor(from / MINUTE_MS) * MINUTE_MS;
  const startDay = Math.floor(last / DAY_MS) * DAY_MS;
  const hours = [...cron.hours].sort((a, b) => b - a);
  const minutes = [...cron.minutes].sort((a, b) => b - a);
  for (let i = 0; i < 366 * 8; i++) {
    const day = startDay - i * DAY_MS;
    if (!dayMatches(cron, new Date(day))) continue;
    for (const h of hours) {
      for (const m of minutes) {
        const t = day + h * 3_600_000 + m * MINUTE_MS;
        if (t <= last) return t;
      }
    }
  }
  return null;
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * A plain daily, weekly or hourly cron in words (`every day at 06:00 UTC`); null for any other,
 * which the page shows as the cron itself.
 */
export function describeCron(expression: string): string | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  const one = (set: Set<number>) => (set.size === 1 ? ([...set][0] ?? null) : null);
  const minute = one(cron.minutes);
  if (minute === null || cron.months.size !== 12 || !cron.daysAny) return null;
  const parts = expression.trim().split(/\s+/);
  const hourText = parts[1] ?? "";
  if (hourText === "*" && cron.weekdaysAny) return `every hour at :${two(minute)}`;
  const hour = one(cron.hours);
  if (hour === null) return null;
  const at = `${two(hour)}:${two(minute)} UTC`;
  if (cron.weekdaysAny) return `every day at ${at}`;
  const weekday = one(cron.weekdays);
  return weekday === null ? null : `every ${DAY_WORDS[weekday]} at ${at}`;
}
