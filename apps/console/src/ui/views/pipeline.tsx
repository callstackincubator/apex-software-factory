import { useEffect, useRef, useState } from "react";
import { STATES, type Delivery, type DeliveryState } from "../../shared/schema.ts";
import { startRun } from "../api.ts";
import { useSnapshot } from "../data.tsx";
import { formatDuration } from "../format.ts";
import { PageHeader, Panel } from "../layout.tsx";
import { PhaseStrip } from "../phase-strip.tsx";
import { Link } from "../router.tsx";
import { StateStatus } from "../status.tsx";
import { DataTable, type Column } from "../table.tsx";

const HIDDEN_BY_DEFAULT: readonly DeliveryState[] = ["merged", "closed"];

export function PipelineView() {
  const { snapshot } = useSnapshot();
  const [shown, setShown] = useState<ReadonlySet<DeliveryState>>(
    () => new Set(STATES.filter((s) => !HIDDEN_BY_DEFAULT.includes(s))),
  );
  const [asking, setAsking] = useState<Delivery | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<number, { ok: boolean; text: string }>>>(
    {},
  );
  if (snapshot === null) return null;

  const rows = snapshot.deliveries.filter((d) => shown.has(d.state));
  const toggle = (state: DeliveryState) =>
    setShown((current) => {
      const next = new Set(current);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });

  const columns: Column<Delivery>[] = [
    {
      header: "Issue",
      mono: true,
      cell: (d) => (
        <span className="name-cell">
          <Link to={`/pipeline/${d.issue}`}>#{d.issue}</Link>
          {d.pr === null ? null : (
            <a
              href={d.pr.url}
              target="_blank"
              rel="noreferrer noopener"
              title="Pull request on GitHub"
            >
              PR #{d.pr.number}
              <span className="visually-hidden"> (opens GitHub in a new tab)</span>
            </a>
          )}
        </span>
      ),
    },
    {
      header: "Title",
      cell: (d) => (
        <span className="name-cell">
          {d.title}
          <span className="muted file">{d.kind}</span>
        </span>
      ),
    },
    { header: "State", cell: (d) => <StateStatus state={d.state} /> },
    {
      header: "Status line",
      mono: true,
      cell: (d) =>
        d.statusLine.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <span className="status-line">
            {d.statusLine.map((f) => (
              <span key={f.key} className="status-field">
                <span className="muted">{f.key}</span> {f.value}
              </span>
            ))}
          </span>
        ),
    },
    {
      header: "Time per phase",
      cell: (d) => <PhaseStrip phases={d.phases} current={d.currentPhase} />,
    },
    {
      header: "Total",
      numeric: true,
      cell: (d) => (d.totalMs > 0 ? formatDuration(d.totalMs) : "—"),
    },
    {
      header: "Findings",
      numeric: true,
      cell: (d) =>
        d.findings.known ? (
          <span title="raised / confirmed / rejected / nits">
            {d.findings.raised} / {d.findings.confirmed} / {d.findings.rejected} / {d.findings.nits}
            {d.findings.fromPr ? <span className="muted"> from PR</span> : null}
          </span>
        ) : (
          "—"
        ),
    },
    {
      header: "Run",
      cell: (d) => {
        const answer = answers[d.issue];
        return (
          <span className="run-cell">
            {d.canStart ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setAsking(d)}
              >
                Start run<span className="visually-hidden"> for #{d.issue}</span>
              </button>
            ) : null}
            {answer === undefined ? null : (
              <span className={answer.ok ? "hint" : "refusal"} role="status">
                {answer.text}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="view">
      <PageHeader
        title="Pipeline"
        subtitle="Every pending delivery, newest activity first, with the time each phase took."
      />
      <Panel
        title="Deliveries"
        description={`${rows.length} of ${snapshot.deliveries.length} shown`}
      >
        <fieldset className="filter">
          <legend>State</legend>
          {STATES.map((state) => (
            <label key={state}>
              <input type="checkbox" checked={shown.has(state)} onChange={() => toggle(state)} />
              {state}
            </label>
          ))}
        </fieldset>
        <DataTable
          rows={rows}
          rowId={(d) => String(d.issue)}
          empty="No delivery in the chosen states."
          columns={columns}
          wide
          caption="Deliveries"
        />
      </Panel>
      {asking === null ? null : (
        <ConfirmStart
          issue={asking.issue}
          onCancel={() => setAsking(null)}
          onStart={async () => {
            const issue = asking.issue;
            setAsking(null);
            try {
              await startRun(issue);
              setAnswers((a) => ({ ...a, [issue]: { ok: true, text: "Dispatched" } }));
            } catch (failure) {
              const text = failure instanceof Error ? failure.message : String(failure);
              setAnswers((a) => ({ ...a, [issue]: { ok: false, text } }));
            }
          }}
        />
      )}
    </div>
  );
}

/** "Start a factory run for #42?" with Start (primary) and Cancel. Escape cancels. */
function ConfirmStart(props: { issue: number; onStart: () => void; onCancel: () => void }) {
  const { issue, onCancel, onStart } = props;
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    start.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title" className="panel-title">
          Start a factory run for #{issue}?
        </h2>
        <p className="muted">The workflow checks who asked, then a worker picks it up.</p>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button" type="button" ref={start} onClick={onStart}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
