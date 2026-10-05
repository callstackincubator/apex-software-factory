import type { PhaseTotal } from "../shared/schema.ts";
import { formatDuration } from "./format.ts";

const SHARE: Readonly<Record<string, number>> = {
  Implement: 100,
  Triage: 85,
  Review: 70,
  "Spec check": 58,
  Verify: 48,
  Simulator: 38,
  "OTA check": 28,
};

/**
 * The fill of a phase: the brand green at a stepped strength, Factory in `--border-strong`. The
 * same fill paints the strip, the timeline and the legend.
 */
export function phaseFill(phase: string): string {
  if (phase === "Factory") return "var(--border-strong)";
  return `color-mix(in srgb, var(--accent) ${SHARE[phase] ?? 45}%, transparent)`;
}

/**
 * A 100%-wide row of segments, one per phase in order of first start, width by share of the
 * total. Each has its phase in its `title` and in a visually hidden list; the current phase is
 * outlined in `--text`.
 */
export function PhaseStrip(props: {
  readonly phases: readonly PhaseTotal[];
  readonly current?: string | null;
}) {
  const { current = null, phases } = props;
  const shown = phases.filter((p) => p.ms > 0);
  if (shown.length === 0) return <span className="muted">—</span>;
  return (
    <div className="phase-strip-wrap">
      <div className="phase-strip" aria-hidden="true">
        {shown.map((p) => (
          <span
            key={p.phase}
            className={p.phase === current ? "phase-segment phase-current" : "phase-segment"}
            style={{ flexGrow: p.ms, background: phaseFill(p.phase) }}
            title={`${p.phase}: ${formatDuration(p.ms)}`}
          />
        ))}
      </div>
      <ul className="visually-hidden" aria-label="Time per phase">
        {shown.map((p) => (
          <li key={p.phase}>
            {p.phase}: {formatDuration(p.ms)}
            {p.phase === current ? " (current)" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
