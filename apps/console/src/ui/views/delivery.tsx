import type { Attempt, Interval, Report, Round } from "../../shared/schema.ts";
import { useDelivery } from "../data.tsx";
import { formatDuration, formatTime } from "../format.ts";
import { PageHeader, Panel, StatCards } from "../layout.tsx";
import { phaseFill } from "../phase-strip.tsx";
import { Link } from "../router.tsx";
import { StateStatus } from "../status.tsx";
import { DataTable, type Column } from "../table.tsx";

export function DeliveryView({ issue }: { issue: number }) {
  const { detail, error, loading } = useDelivery(issue);
  if (detail === null) {
    return (
      <div className="view">
        <PageHeader
          title={`#${issue}`}
          subtitle={<Link to="/pipeline">Back to the pipeline</Link>}
        />
        <p
          className={error === null ? "muted" : "refusal"}
          role={error === null ? undefined : "alert"}
        >
          {loading ? "Loading the delivery…" : (error ?? "No such delivery.")}
        </p>
      </div>
    );
  }
  const { delivery } = detail;
  const f = delivery.findings;
  return (
    <div className="view">
      <PageHeader
        title={
          <>
            <span className="mono">#{delivery.issue}</span> {delivery.title}
          </>
        }
        subtitle={
          <span className="header-links">
            <StateStatus state={delivery.state} />
            <Link to="/pipeline">All deliveries</Link>
            {delivery.issueUrl === null ? null : (
              <a href={delivery.issueUrl} target="_blank" rel="noreferrer noopener">
                Issue on GitHub
              </a>
            )}
            {delivery.pr === null ? null : (
              <a href={delivery.pr.url} target="_blank" rel="noreferrer noopener">
                PR #{delivery.pr.number} on GitHub
              </a>
            )}
          </span>
        }
      />
      <StatCards
        stats={[
          {
            label: "Total time",
            value: delivery.totalMs > 0 ? formatDuration(delivery.totalMs) : "—",
            caption: `${detail.attempts.length} attempt${detail.attempts.length === 1 ? "" : "s"}`,
          },
          { label: "Rounds", value: String(f.rounds), caption: "review-verifier rounds" },
          {
            label: "Raised",
            value: f.known ? String(f.raised) : "—",
            caption: f.fromPr ? "from the PR's Review section" : "spec and code findings",
          },
          {
            label: "Confirmed",
            value: f.known ? String(f.confirmed) : "—",
            caption: "blocking, fixed",
          },
          { label: "Rejected", value: f.known ? String(f.rejected) : "—", caption: "not valid" },
          { label: "Nits", value: f.known ? String(f.nits) : "—", caption: "not worth a round" },
        ]}
      />
      <TimelinePanel attempts={detail.attempts} />
      <ReviewPanel rounds={detail.rounds} rejected={detail.rejected} />
      <Panel title="Status" description="From the pull request, and from the watchdog.">
        <h3 className="subhead">Status line</h3>
        {delivery.statusLine.length === 0 ? (
          <p className="muted">The PR has no Status line yet.</p>
        ) : (
          <dl className="facts">
            {delivery.statusLine.map((field) => (
              <div key={field.key}>
                <dt>{field.key}</dt>
                <dd className="mono">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <h3 className="subhead">Assumptions</h3>
        {detail.assumptions.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ul className="plain-list">
            {detail.assumptions.map((a) => (
              <li key={a}>Assumption: {a}</li>
            ))}
          </ul>
        )}
        <h3 className="subhead">Watchdog stops</h3>
        {detail.stops.length === 0 ? (
          <p className="muted">The watchdog never stopped a run of this issue.</p>
        ) : (
          <DataTable
            rows={detail.stops}
            rowId={(s) => `${s.attempt}-${s.at}`}
            empty=""
            columns={[
              { header: "When", mono: true, cell: (s) => formatTime(s.at) },
              { header: "Attempt", numeric: true, cell: (s) => String(s.attempt) },
              { header: "Reason", cell: (s) => s.reason },
            ]}
            caption="Watchdog stops"
          />
        )}
      </Panel>
    </div>
  );
}

/** Assigns each interval a lane so that intervals that overlap in time sit on different rows. */
export function lanes(intervals: readonly Interval[]): { interval: Interval; lane: number }[] {
  const ends: number[] = [];
  return [...intervals]
    .sort((a, b) => a.start - b.start)
    .map((interval) => {
      let lane = ends.findIndex((end) => end <= interval.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = interval.end;
      return { interval, lane };
    });
}

function TimelinePanel({ attempts }: { attempts: readonly Attempt[] }) {
  const phases = [...new Set(attempts.flatMap((a) => a.phases.map((p) => p.phase)))];
  return (
    <Panel
      title="Timeline"
      description="Each attempt on its own time axis; what ran in parallel is stacked."
    >
      {attempts.length === 0 ? (
        <p className="muted">The database has no run for this issue.</p>
      ) : (
        <>
          <ul className="legend" aria-label="Phases">
            {phases.map((phase) => (
              <li key={phase}>
                <span
                  className="swatch"
                  style={{ background: phaseFill(phase) }}
                  aria-hidden="true"
                />
                {phase}
              </li>
            ))}
          </ul>
          {attempts.map((attempt) => (
            <AttemptBar key={attempt.runId} attempt={attempt} />
          ))}
          <details className="chart-data">
            <summary>Phase by phase</summary>
            <DataTable
              rows={attempts.flatMap((a) =>
                a.intervals.map((i, n) => ({
                  attempt: a.attempt,
                  interval: i,
                  key: `${a.runId}-${n}`,
                })),
              )}
              rowId={(r) => r.key}
              empty="No subagent ran."
              caption="Phase by phase"
              columns={phaseColumns}
            />
          </details>
        </>
      )}
    </Panel>
  );
}

const phaseColumns: Column<{ attempt: number; interval: Interval }>[] = [
  { header: "Attempt", numeric: true, cell: (r) => String(r.attempt) },
  { header: "Phase", cell: (r) => `${r.interval.phase} (${r.interval.agent})` },
  { header: "Start", mono: true, cell: (r) => formatTime(r.interval.start) },
  { header: "End", mono: true, cell: (r) => formatTime(r.interval.end) },
  {
    header: "Duration",
    numeric: true,
    cell: (r) => formatDuration(r.interval.end - r.interval.start),
  },
];

const LANE_HEIGHT = 24;

function AttemptBar({ attempt }: { attempt: Attempt }) {
  const span = Math.max(1, attempt.end - attempt.start);
  const placed = lanes(attempt.intervals);
  const laneCount = Math.max(1, ...placed.map((p) => p.lane + 1));
  return (
    <figure className="attempt">
      <figcaption className="attempt-caption">
        <span className="mono">Attempt {attempt.attempt}</span>
        <span className="muted mono">
          {attempt.mode} · {formatDuration(span)}
          {attempt.live ? " · live" : ""}
        </span>
        {attempt.stop === null ? null : <span className="refusal">stopped: {attempt.stop}</span>}
      </figcaption>
      <div
        className="timeline"
        role="img"
        aria-label={`Attempt ${attempt.attempt}: ${attempt.phases.map((p) => `${p.phase} ${formatDuration(p.ms)}`).join(", ")}`}
        style={{ height: laneCount * LANE_HEIGHT }}
      >
        {placed.map(({ interval, lane }, i) => (
          <span
            key={`${interval.agent}-${i}`}
            className="timeline-bar"
            style={{
              left: `${((interval.start - attempt.start) / span) * 100}%`,
              width: `${Math.max(((interval.end - interval.start) / span) * 100, 0.4)}%`,
              top: lane * LANE_HEIGHT,
              height: LANE_HEIGHT - 4,
              background: phaseFill(interval.phase),
            }}
            title={`${interval.phase} (${interval.agent}): ${formatDuration(interval.end - interval.start)}`}
          >
            <span className="timeline-label">{interval.phase}</span>
          </span>
        ))}
      </div>
      <div className="timeline-axis mono">
        <span>{formatTime(attempt.start)}</span>
        <span>{formatTime(attempt.end)}</span>
      </div>
    </figure>
  );
}

function ItemList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <dt>{title}</dt>
      <dd>
        {items.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul className="plain-list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

function count(findings: number | null, blocking: number | null, skipped: boolean): string {
  if (skipped) return "skipped";
  if (findings === null) return "—";
  return `${findings} findings (${blocking ?? 0} blocking)`;
}

function RoundReport({ report }: { report: Report }) {
  return (
    <dl className="facts round-facts">
      <div>
        <dt>Spec review</dt>
        <dd className="mono">
          {count(report.specFindings, report.specBlocking, report.specSkipped)}
        </dd>
      </div>
      <div>
        <dt>Code review</dt>
        <dd className="mono">
          {count(report.codeFindings, report.codeBlocking, report.codeSkipped)}
        </dd>
      </div>
      <ItemList title="Fix" items={report.fix} />
      <ItemList title="Nits" items={report.nits} />
      <ItemList title="Rejected" items={report.rejected} />
      <div>
        <dt>Spec needs</dt>
        <dd>{report.specNeeds ?? <span className="muted">none</span>}</dd>
      </div>
      <div>
        <dt>Rerun</dt>
        <dd className="mono">{report.rerun ?? "—"}</dd>
      </div>
    </dl>
  );
}

function ReviewPanel({
  rounds,
  rejected,
}: {
  rounds: readonly Round[];
  rejected: readonly string[];
}) {
  return (
    <Panel title="Review" description="What the review-verifier reported, round by round.">
      {rounds.length === 0 ? <p className="muted">No review round has run.</p> : null}
      {rounds.map((round) => (
        <section
          key={round.sessionId}
          className="round"
          aria-label={`Round ${round.round}, attempt ${round.attempt}`}
        >
          <h3 className="subhead">
            Round {round.round} <span className="muted">· attempt {round.attempt}</span>
          </h3>
          {round.report === null ? (
            <p className="muted">No report block in the verifier&apos;s reply.</p>
          ) : (
            <RoundReport report={round.report} />
          )}
        </section>
      ))}
      {rejected.length === 0 ? null : (
        <>
          <h3 className="subhead">Rejected, as the PR lists it</h3>
          <ul className="plain-list">
            {rejected.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
