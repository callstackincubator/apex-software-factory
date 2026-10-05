/**
 * The console's charts, drawn with Recharts: bars in the brand green, light grid lines, mono axis
 * labels. Colours come from the stylesheet or from CSS variables, so both themes apply. Nothing
 * moves: animation is off. A chart is never the only place its numbers are: each has a caption
 * and a table of its numbers as text.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IssueFindings, PhaseStat } from "../shared/schema.ts";
import { formatDuration } from "./format.ts";

const minutes = (ms: number) => Math.round((ms / 60_000) * 10) / 10;

/** Median time per phase as horizontal bars; the longest is written beside each phase. */
export function PhaseChart({ phases }: { phases: readonly PhaseStat[] }) {
  const data = phases.map((p) => ({ ...p, median: minutes(p.medianMs) }));
  const height = 48 + data.length * 40;
  return (
    <div className="chart chart-columns" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height }}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
          title="Median time per phase"
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} unit=" m" />
          <YAxis
            type="category"
            dataKey="phase"
            tickLine={false}
            axisLine={false}
            width={132}
            interval={0}
            tick={<PhaseTick stats={phases} />}
          />
          <Tooltip
            cursor={{ className: "chart-cursor" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as PhaseStat | undefined;
              if (active !== true || row === undefined) return null;
              return (
                <div className="chart-tip">
                  <span className="chart-tip-label">{row.phase}</span> median{" "}
                  {formatDuration(row.medianMs)}, longest {formatDuration(row.maxMs)}
                </div>
              );
            }}
          />
          <Bar dataKey="median" isAnimationActive={false} className="chart-series" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PhaseTick(props: {
  x?: number;
  y?: number;
  payload?: { value: string };
  stats: readonly PhaseStat[];
}) {
  const { payload, stats, x = 0, y = 0 } = props;
  const stat = stats.find((s) => s.phase === payload?.value);
  return (
    <text x={x - 4} y={y} textAnchor="end" className="recharts-cartesian-axis-tick-value">
      <tspan x={x - 4} dy="-0.2em" className="tick-name">
        {payload?.value}
      </tspan>
      <tspan x={x - 4} dy="1.3em" className="tick-sub">
        {stat === undefined ? "" : `longest ${formatDuration(stat.maxMs)}`}
      </tspan>
    </text>
  );
}

export const FINDING_KINDS = [
  { key: "confirmed", label: "Confirmed", pattern: "pat-confirmed" },
  { key: "rejected", label: "Rejected (not valid)", pattern: "pat-rejected" },
  { key: "nits", label: "Nits (not worth a round)", pattern: "pat-nits" },
  { key: "unsorted", label: "Unsorted", pattern: "pat-unsorted" },
] as const;

/** The patterns the findings' stacks and legend are painted with; one copy per page. */
export function FindingPatterns() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="pattern-defs">
      <defs>
        <pattern id="pat-confirmed" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" style={{ fill: "var(--accent)" }} />
        </pattern>
        <pattern
          id="pat-rejected"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" style={{ fill: "var(--accent)", fillOpacity: 0.3 }} />
          <rect width="2" height="6" style={{ fill: "var(--accent)" }} />
        </pattern>
        <pattern id="pat-nits" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" style={{ fill: "var(--surface)" }} />
          <circle cx="3" cy="3" r="1.4" style={{ fill: "var(--accent)" }} />
        </pattern>
        <pattern id="pat-unsorted" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" style={{ fill: "var(--surface)" }} />
          <path
            d="M0 0H6M0 0V6"
            style={{ stroke: "var(--text)", strokeWidth: 1.2, fill: "none" }}
          />
        </pattern>
      </defs>
    </svg>
  );
}

export function FindingsLegend() {
  return (
    <ul className="legend" aria-label="Findings">
      {FINDING_KINDS.map((kind) => (
        <li key={kind.key}>
          <svg width="16" height="16" aria-hidden="true" className="swatch-svg">
            <rect
              width="16"
              height="16"
              fill={`url(#${kind.pattern})`}
              stroke="var(--border-strong)"
            />
          </svg>
          {kind.label}
        </li>
      ))}
    </ul>
  );
}

/** One stacked column per issue: confirmed, rejected, nits, unsorted. */
export function FindingsChart({ issues }: { issues: readonly IssueFindings[] }) {
  const data = issues.map((i) => ({ ...i, name: `#${i.issue}` }));
  return (
    <div className="chart chart-stacked">
      <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 640, height: 260 }}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          title="Findings per issue"
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            cursor={{ className: "chart-cursor" }}
            isAnimationActive={false}
            content={({ active, payload, label }) => {
              if (active !== true || !payload || payload.length === 0) return null;
              return (
                <div className="chart-tip">
                  <span className="chart-tip-label">{label}</span>{" "}
                  {FINDING_KINDS.map(
                    (k) => `${payload.find((p) => p.dataKey === k.key)?.value ?? 0} ${k.key}`,
                  ).join(", ")}
                </div>
              );
            }}
          />
          {FINDING_KINDS.map((kind) => (
            <Bar
              key={kind.key}
              dataKey={kind.key}
              stackId="findings"
              isAnimationActive={false}
              fill={`url(#${kind.pattern})`}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
