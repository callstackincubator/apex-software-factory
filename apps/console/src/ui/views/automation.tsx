import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AutomationRun } from "../../shared/schema.ts";
import { dispatchAutomation, fetchAutomation } from "../api.ts";
import { FindingPatterns } from "../charts.tsx";
import { usePolled, useNow } from "../data.tsx";
import { formatDuration, formatTime } from "../format.ts";
import { PageHeader, Panel } from "../layout.tsx";
import { Link } from "../router.tsx";
import {
  AutomationStatus,
  ConfirmRun,
  NextRun,
  rate,
  RunStatus,
  Schedule,
} from "./automations.tsx";
import { DataTable } from "../table.tsx";

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

export function AutomationView({ file }: { file: string }) {
  const { data, error, loading } = usePolled(() => fetchAutomation(file), `automation-${file}`);
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);
  if (data === null) {
    return (
      <div className="view">
        <PageHeader
          title={file}
          subtitle={<Link to="/automations">Back to the automations</Link>}
        />
        <p
          className={error === null ? "muted" : "refusal"}
          role={error === null ? undefined : "alert"}
        >
          {loading ? "Loading the automation…" : (error ?? "No such workflow.")}
        </p>
      </div>
    );
  }
  const a = data.automation;
  const finished = data.runs.filter((r) => r.durationMs !== null).reverse();
  const chart = finished.map((r) => ({
    ...r,
    minutes: Math.round(((r.durationMs ?? 0) / 60_000) * 10) / 10,
    label: formatTime(r.startedAt, now),
  }));
  return (
    <div className="view">
      <PageHeader
        title={a.name}
        subtitle={
          <span className="header-links">
            <span className="mono">{a.file}</span>
            <AutomationStatus status={a.status} />
            <Link to="/automations">All automations</Link>
            {a.url === null ? null : (
              <a href={a.url} target="_blank" rel="noreferrer noopener">
                Workflow on GitHub
              </a>
            )}
          </span>
        }
        actions={
          a.dispatchable ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setAsking(true)}
            >
              Run now
            </button>
          ) : undefined
        }
      />
      {answer === null ? null : (
        <p className={answer.ok ? "hint" : "refusal"} role="status">
          {answer.text}
        </p>
      )}
      {a.dispatchRefusal !== null && !a.dispatchable ? (
        <p className="hint">Run now is off: {a.dispatchRefusal}.</p>
      ) : null}
      {a.description === "" ? null : (
        <Panel title="Description" description="The file's leading comment.">
          <p className="description">{a.description}</p>
        </Panel>
      )}
      <Panel title="Facts">
        <dl className="facts">
          <div>
            <dt>Triggers</dt>
            <dd className="mono">{a.events.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt>Schedule</dt>
            <dd>
              <Schedule automation={a} />
            </dd>
          </div>
          <div>
            <dt>Next run</dt>
            <dd className="mono">
              <NextRun automation={a} now={now} />
            </dd>
          </div>
          <div>
            <dt>Inputs</dt>
            <dd>
              {a.inputs.length === 0 ? (
                <span className="muted">none</span>
              ) : (
                <ul className="plain-list">
                  {a.inputs.map((i) => (
                    <li key={i.name}>
                      <span className="mono">{i.name}</span>
                      {i.required ? " (required)" : ""}{" "}
                      <span className="muted">{i.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div>
            <dt>Runs on</dt>
            <dd className="mono">
              {a.runsOn.join(", ") || "—"}
              {a.selfHosted ? " (self-hosted)" : ""}
            </dd>
          </div>
          <div>
            <dt>State</dt>
            <dd className="mono">{a.state}</dd>
          </div>
          <div>
            <dt>Success rate</dt>
            <dd className="mono">{rate(a)} of the last runs</dd>
          </div>
          <div>
            <dt>Median time</dt>
            <dd className="mono">{a.medianMs === null ? "—" : formatDuration(a.medianMs)}</dd>
          </div>
        </dl>
      </Panel>
      <Panel
        title="Runs"
        description="Duration of each finished run among the last 20, oldest left. Failed runs are hatched."
      >
        {chart.length === 0 ? (
          <p className="muted">No finished run yet.</p>
        ) : (
          <figure className="chart-figure">
            <FindingPatterns />
            <figcaption className="chart-summary">
              Duration per run in minutes:{" "}
              {chart
                .map(
                  (r) =>
                    `${r.label} ${formatDuration(r.durationMs ?? 0)}${FAILED.has(r.word) ? " (failed)" : ""}`,
                )
                .join("; ")}
              .
            </figcaption>
            <div className="chart chart-stacked">
              <ResponsiveContainer
                width="100%"
                height={220}
                initialDimension={{ width: 640, height: 220 }}
              >
                <BarChart
                  data={chart}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  title="Duration per run"
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis tickLine={false} axisLine={false} width={32} unit=" m" />
                  <Tooltip
                    cursor={{ className: "chart-cursor" }}
                    isAnimationActive={false}
                    content={({ active, payload }) => {
                      const row = payload?.[0]?.payload as
                        | (AutomationRun & { label: string })
                        | undefined;
                      if (active !== true || row === undefined) return null;
                      return (
                        <div className="chart-tip">
                          <span className="chart-tip-label">{row.label}</span>{" "}
                          {row.word.replaceAll("_", " ")}, {formatDuration(row.durationMs ?? 0)}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="minutes" isAnimationActive={false} stroke="var(--border-strong)">
                    {chart.map((r) => (
                      <Cell
                        key={r.id}
                        fill={FAILED.has(r.word) ? "url(#pat-rejected)" : "url(#pat-confirmed)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </figure>
        )}
      </Panel>
      <Panel title="Recent runs" description="The last 20 runs, newest first.">
        <DataTable
          rows={data.runs}
          rowId={(r) => String(r.id)}
          empty="GitHub has no run of this workflow."
          caption="Recent runs"
          columns={[
            { header: "Status", cell: (r) => <RunStatus word={r.word} /> },
            { header: "Event", mono: true, cell: (r) => r.event },
            { header: "Started", mono: true, cell: (r) => formatTime(r.startedAt, now) },
            {
              header: "Duration",
              numeric: true,
              cell: (r) => (r.durationMs === null ? "—" : formatDuration(r.durationMs)),
            },
            {
              header: "Run",
              mono: true,
              cell: (r) => (
                <a href={r.url} target="_blank" rel="noreferrer noopener">
                  #{r.id}
                  <span className="visually-hidden"> (opens GitHub in a new tab)</span>
                </a>
              ),
            },
          ]}
        />
      </Panel>
      {asking ? (
        <ConfirmRun
          automation={a}
          onCancel={() => setAsking(false)}
          onRun={async () => {
            setAsking(false);
            try {
              await dispatchAutomation(a.file);
              setAnswer({ ok: true, text: "Dispatched" });
            } catch (failure) {
              setAnswer({
                ok: false,
                text: failure instanceof Error ? failure.message : String(failure),
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}
