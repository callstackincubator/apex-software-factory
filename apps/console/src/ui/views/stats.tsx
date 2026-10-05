import { WINDOWS, type Snapshot, type Window } from "../../shared/schema.ts";
import { FindingPatterns, FindingsChart, FindingsLegend, PhaseChart } from "../charts.tsx";
import { useSnapshot } from "../data.tsx";
import { formatCost, formatDuration, formatTime, formatTokens } from "../format.ts";
import { PageHeader, Panel, StatCards } from "../layout.tsx";
import { Link } from "../router.tsx";
import { DataTable } from "../table.tsx";

const WINDOW_LABELS: Readonly<Record<Window, string>> = {
  today: "Today",
  "7d": "7 days",
  all: "All",
};

export function StatsView() {
  const { snapshot, window, setWindow } = useSnapshot();
  if (snapshot === null) return null;
  return <Stats snapshot={snapshot} window={window} onWindow={setWindow} />;
}

export function Stats(props: {
  snapshot: Snapshot;
  window: Window;
  onWindow: (window: Window) => void;
}) {
  const { onWindow, snapshot, window } = props;
  const s = snapshot.stats;
  const f = s.findings;
  return (
    <div className="view">
      <PageHeader
        title="Stats"
        actions={
          <label className="select-field">
            Window
            <select value={window} onChange={(e) => onWindow(e.target.value as Window)}>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {WINDOW_LABELS[w]}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <StatCards
        stats={[
          { label: "Runs started", value: String(s.runs) },
          { label: "Merged", value: String(s.merged) },
          {
            label: "Parked or blocked",
            value: String(s.parked + s.blocked),
            caption: `${s.parked} parked, ${s.blocked} blocked`,
          },
          { label: "Failed", value: String(s.failed) },
          {
            label: "Watchdog stops",
            value: String(s.watchdogStops),
            caption: s.watchdogReasons.map((r) => `${r.count} ${r.reason}`).join(", "),
          },
          {
            label: "Median run",
            value: s.medianRunMs === null ? "—" : formatDuration(s.medianRunMs),
          },
        ]}
      />
      <Panel title="Median time per phase">
        {s.phases.length === 0 ? (
          <p className="muted">No finished run in this window, or no OpenCode data.</p>
        ) : (
          <figure className="chart-figure">
            <figcaption className="visually-hidden">
              Median time per phase, in minutes.{" "}
              {s.phases.map((p) => `${p.phase} ${formatDuration(p.medianMs)}`).join(", ")}.
            </figcaption>
            <PhaseChart phases={s.phases} />
            <details className="chart-data">
              <summary>Phase by phase</summary>
              <DataTable
                rows={s.phases}
                rowId={(p) => p.phase}
                empty=""
                caption="Time per phase"
                columns={[
                  { header: "Phase", cell: (p) => p.phase },
                  { header: "Runs", numeric: true, cell: (p) => String(p.runs) },
                  { header: "Median", numeric: true, cell: (p) => formatDuration(p.medianMs) },
                  { header: "Longest", numeric: true, cell: (p) => formatDuration(p.maxMs) },
                ]}
              />
            </details>
          </figure>
        )}
      </Panel>
      <Panel title="Findings">
        <StatCards
          label="Findings totals"
          stats={[
            { label: "Raised", value: String(f.raised) },
            { label: "Blocking", value: String(f.blocking) },
            { label: "Confirmed", value: String(f.confirmed) },
            { label: "Rejected", value: String(f.rejected) },
            { label: "Nits", value: String(f.nits) },
            { label: "Spec needs", value: String(f.specNeeds), caption: "rounds with a spec gap" },
          ]}
        />
        {s.perIssue.length === 0 ? (
          <p className="muted">No verifier report in this window.</p>
        ) : (
          <figure className="chart-figure">
            <FindingPatterns />
            <figcaption className="visually-hidden">
              Findings per issue, one stacked column each: confirmed, rejected, nits, unsorted.
            </figcaption>
            <FindingsLegend />
            <FindingsChart issues={s.perIssue} />
            <details className="chart-data">
              <summary>Issue by issue</summary>
              <DataTable
                rows={s.perIssue}
                rowId={(i) => String(i.issue)}
                empty=""
                caption="Findings per issue"
                columns={[
                  {
                    header: "Issue",
                    mono: true,
                    cell: (i) => <Link to={`/pipeline/${i.issue}`}>#{i.issue}</Link>,
                  },
                  { header: "Confirmed", numeric: true, cell: (i) => String(i.confirmed) },
                  { header: "Rejected", numeric: true, cell: (i) => String(i.rejected) },
                  { header: "Nits", numeric: true, cell: (i) => String(i.nits) },
                  { header: "Unsorted", numeric: true, cell: (i) => String(i.unsorted) },
                ]}
              />
            </details>
          </figure>
        )}
      </Panel>
      <Panel title="Watchdog stops">
        <DataTable
          rows={s.watchdog}
          rowId={(w) => `${w.issue}-${w.attempt}-${w.at}`}
          empty="The watchdog stopped nothing in this window."
          caption="Watchdog stops"
          columns={[
            { header: "When", mono: true, cell: (w) => formatTime(w.at, snapshot.generatedAt) },
            {
              header: "Issue",
              mono: true,
              cell: (w) => <Link to={`/pipeline/${w.issue}`}>#{w.issue}</Link>,
            },
            { header: "Attempt", numeric: true, cell: (w) => String(w.attempt) },
            { header: "Reason", cell: (w) => w.reason },
          ]}
        />
      </Panel>
      {s.costUsd === null && s.tokens === null ? null : (
        <Panel title="Cost and tokens">
          <StatCards
            label="Cost and tokens"
            stats={[
              { label: "Cost", value: formatCost(s.costUsd) },
              { label: "Input tokens", value: s.tokens ? formatTokens(s.tokens.input) : "—" },
              { label: "Output tokens", value: s.tokens ? formatTokens(s.tokens.output) : "—" },
              {
                label: "Reasoning tokens",
                value: s.tokens ? formatTokens(s.tokens.reasoning) : "—",
              },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
