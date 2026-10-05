import { useEffect, useRef, useState } from "react";
import type { Automation, AutomationsResponse } from "../../shared/schema.ts";
import { dispatchAutomation, fetchAutomations } from "../api.ts";
import { usePolled, useNow } from "../data.tsx";
import { formatDuration, formatTime } from "../format.ts";
import { PageHeader, Panel, StatCards } from "../layout.tsx";
import { Link } from "../router.tsx";
import { Status, type Tone } from "../status.tsx";
import { DataTable, type Column } from "../table.tsx";

const RUN_TONES: Readonly<Record<string, Tone>> = {
  success: "ok",
  failure: "error",
  timed_out: "error",
  startup_failure: "error",
  cancelled: "idle",
  skipped: "idle",
  in_progress: "idle",
  queued: "idle",
  waiting: "idle",
};

export const runTone = (word: string): Tone => RUN_TONES[word] ?? "idle";

export function RunStatus({ word }: { word: string }) {
  return <Status tone={runTone(word)}>{word.replaceAll("_", " ")}</Status>;
}

const STATUS_TONES: Readonly<Record<Automation["status"], Tone>> = {
  healthy: "ok",
  failing: "error",
  disabled: "idle",
};

export function AutomationStatus({ status }: { status: Automation["status"] }) {
  return <Status tone={STATUS_TONES[status]}>{status}</Status>;
}

/** "in 12 m", "in 3 h 05 m", "in 2 d"; "due" when GitHub is late. */
export function formatUntil(at: number, now: number): string {
  const ms = at - now;
  if (ms < 60_000) return "in under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} m`;
  if (minutes < 24 * 60)
    return `in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
  return `in ${Math.floor(minutes / 1440)} d`;
}

export function Schedule({ automation }: { automation: Automation }) {
  if (automation.schedule.length === 0) return <span className="muted">—</span>;
  return (
    <span className="schedule">
      {automation.schedule.map((s) =>
        s.words === null ? <code key={s.cron}>{s.cron}</code> : <span key={s.cron}>{s.words}</span>,
      )}
    </span>
  );
}

export function NextRun({ automation, now }: { automation: Automation; now: number }) {
  if (automation.dueSince !== null) {
    return <span title={`was due ${formatTime(automation.dueSince, now)} UTC schedule`}>due</span>;
  }
  if (automation.nextRun === null) return <span className="muted">—</span>;
  return (
    <span title={formatTime(automation.nextRun, now)}>{formatUntil(automation.nextRun, now)}</span>
  );
}

export function rate(a: Automation): string {
  return a.successRate === null ? "—" : `${Math.round(a.successRate * 100)} %`;
}

export function AutomationsView() {
  const { data, error } = usePolled(fetchAutomations, "automations");
  if (data === null) {
    return (
      <div className="view">
        <PageHeader title="Automations" />
        <p
          className={error === null ? "muted" : "refusal"}
          role={error === null ? undefined : "alert"}
        >
          {error ?? "Loading the automations…"}
        </p>
      </div>
    );
  }
  return <Automations data={data} />;
}

export function Automations({
  data,
  onRunNow,
}: {
  data: AutomationsResponse;
  onRunNow?: (file: string) => Promise<void>;
}) {
  const now = useNow();
  const [asking, setAsking] = useState<Automation | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<string, { ok: boolean; text: string }>>>(
    {},
  );
  const scheduled = data.automations.filter((a) => a.crons.length > 0);
  const events = data.automations.filter((a) => a.crons.length === 0);
  const failing = data.automations.filter((a) => a.status === "failing").length;
  const soonest = scheduled
    .map((a) => a.nextRun)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)[0];
  const due = scheduled.some((a) => a.dueSince !== null);

  const run = onRunNow ?? dispatchAutomation;
  const columns = (withSchedule: boolean): Column<Automation>[] => [
    {
      header: "Name",
      cell: (a) => (
        <span className="name-cell">
          <Link to={`/automations/${a.file}`}>{a.name}</Link>
          <span className="muted mono file">{a.file}</span>
        </span>
      ),
    },
    withSchedule
      ? { header: "Schedule", cell: (a) => <Schedule automation={a} /> }
      : {
          header: "Triggers",
          cell: (a) => <span className="triggers">{a.events.join(", ")}</span>,
        },
    ...(withSchedule
      ? [
          {
            header: "Next run",
            mono: true,
            cell: (a: Automation) => <NextRun automation={a} now={now} />,
          },
        ]
      : []),
    { header: "Status", cell: (a) => <AutomationStatus status={a.status} /> },
    {
      header: "Last run",
      cell: (a) =>
        a.lastRun === null ? (
          <span className="muted">no run yet</span>
        ) : (
          <span className="last-run">
            <RunStatus word={a.lastRun.word} />
            <span className="muted mono">
              {formatTime(a.lastRun.startedAt, now)}
              {a.lastRun.durationMs === null ? "" : ` · ${formatDuration(a.lastRun.durationMs)}`}
            </span>
          </span>
        ),
    },
    { header: "Success", numeric: true, cell: (a) => rate(a) },
    {
      header: "Median",
      numeric: true,
      cell: (a) => (a.medianMs === null ? "—" : formatDuration(a.medianMs)),
    },
    {
      header: "Run",
      cell: (a) => {
        const answer = answers[a.file];
        return (
          <span className="run-cell">
            {a.dispatchable ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setAsking(a)}
              >
                Run now<span className="visually-hidden"> {a.name}</span>
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
        title="Automations"
        subtitle="Every GitHub workflow in this repository. Scheduled ones are the factory's automations."
      />
      {data.notes.length === 0 ? null : (
        <ul className="notice-list" aria-label="Notes">
          {data.notes.map((n) => (
            <li key={n} className="notice">
              {n}
            </li>
          ))}
        </ul>
      )}
      <StatCards
        stats={[
          {
            label: "Automations",
            value: String(data.automations.length),
            caption: "workflow files",
          },
          { label: "Scheduled", value: String(scheduled.length), caption: "with on: schedule" },
          { label: "Failing", value: String(failing), caption: "last run failed" },
          {
            label: "Next run",
            value: due ? "due" : soonest === undefined ? "—" : formatUntil(soonest, now),
            caption: due ? "GitHub is late" : "soonest scheduled run",
          },
        ]}
      />
      <Panel
        title="Scheduled"
        description="Workflows with a cron, soonest first. Times are UTC schedules shown in your time."
      >
        <DataTable
          rows={scheduled}
          rowId={(a) => a.file}
          empty="No scheduled automations yet. A workflow with `on: schedule` appears here."
          columns={columns(true)}
          wide
          caption="Scheduled automations"
        />
      </Panel>
      <Panel
        title="On events"
        description="Workflows that start from pushes, pull requests, issues or by hand."
      >
        <DataTable
          rows={events}
          rowId={(a) => a.file}
          empty="Every workflow is scheduled."
          columns={columns(false)}
          wide
          caption="Event-driven workflows"
        />
      </Panel>
      {asking === null ? null : (
        <ConfirmRun
          automation={asking}
          onCancel={() => setAsking(null)}
          onRun={async () => {
            const file = asking.file;
            setAsking(null);
            try {
              await run(file);
              setAnswers((a) => ({ ...a, [file]: { ok: true, text: "Dispatched" } }));
            } catch (failure) {
              const text = failure instanceof Error ? failure.message : String(failure);
              setAnswers((a) => ({ ...a, [file]: { ok: false, text } }));
            }
          }}
        />
      )}
    </div>
  );
}

/** The same confirm dialog as Start run: "Run <name> now?" with Run (primary) and Cancel. */
export function ConfirmRun(props: {
  automation: Automation;
  onRun: () => void;
  onCancel: () => void;
}) {
  const { automation, onCancel, onRun } = props;
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-run-title">
        <h2 id="confirm-run-title" className="panel-title">
          Run {automation.name} now?
        </h2>
        <p className="muted">
          Dispatches <code>{automation.file}</code> on the default branch, as you.
          {automation.selfHosted ? " It runs on a self-hosted runner." : ""}
        </p>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button" type="button" ref={primary} onClick={onRun}>
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
