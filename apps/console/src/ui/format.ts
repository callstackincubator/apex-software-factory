/** Durations read `42 s`, `7 m 05 s`, `1 h 12 m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} m ${String(total % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
}

const two = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `HH:MM` in the browser's local time, with the date when it is not today. */
export function formatTime(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const today =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  return today ? clock : `${MONTHS[d.getMonth()] ?? ""} ${d.getDate()} ${clock}`;
}

/** "4 s ago", "3 m ago", "2 h ago", "5 d ago". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function formatCost(usd: number | null): string {
  return usd === null ? "—" : `$${usd.toFixed(2)}`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return String(n);
}
