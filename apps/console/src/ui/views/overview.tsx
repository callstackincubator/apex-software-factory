import type { Delivery, Snapshot, Worker } from "../../shared/schema.ts";
import { useSnapshot } from "../data.tsx";
import { formatDuration } from "../format.ts";
import { PageHeader, Panel, StatCards } from "../layout.tsx";
import { PhaseStrip } from "../phase-strip.tsx";
import { Link } from "../router.tsx";
import { Status, StateStatus } from "../status.tsx";
import { DataTable, type Column } from "../table.tsx";

function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function OverviewView() {
  const { snapshot } = useSnapshot();
  if (snapshot === null) return null;
  return <Overview snapshot={snapshot} />;
}

export function Overview({ snapshot }: { snapshot: Snapshot }) {
  const { deliveries, queue, workers } = snapshot;
  const busy = workers.filter((w) => w.busy).length;
  const running = deliveries.filter((d) => d.state === "running").length;
  const mergedToday = deliveries.filter(
    (d) => d.pr?.mergedAt != null && d.pr.mergedAt >= startOfToday(snapshot.generatedAt),
  ).length;
  const attention = deliveries.filter((d) => d.state === "blocked" || d.state === "parked").length;
  const inProgress = deliveries
    .filter((d) => d.state === "running" || d.state === "queued")
    .sort((a, b) => Number(b.state === "running") - Number(a.state === "running"));

  return (
    <div className="view">
      <PageHeader title="Overview" subtitle="Who is working on what, right now." />
      <StatCards
        stats={[
          {
            label: "Workers busy",
            value: `${busy} / ${workers.length}`,
            caption: "factory runners holding an issue",
          },
          { label: "Queued", value: String(queue.length), caption: "runs waiting for a worker" },
          { label: "Running", value: String(running), caption: "deliveries in progress" },
          {
            label: "Merged today",
            value: String(mergedToday),
            caption: "pull requests merged since midnight",
          },
          { label: "Blocked or parked", value: String(attention), caption: "waiting for a person" },
        ]}
      />
      <Panel
        title="Workers"
        description={
          snapshot.workersNote === null
            ? "One card per factory runner."
            : `One card per factory runner — ${snapshot.workersNote}.`
        }
      >
        {workers.length === 0 ? (
          <p className="muted">No factory runner is known.</p>
        ) : (
          <ul className="cards">
            {workers.map((worker) => (
              <li key={worker.name} className="card">
                <WorkerCard worker={worker} />
              </li>
            ))}
          </ul>
        )}
        <h3 className="subhead">Waiting for a worker</h3>
        {queue.length === 0 ? (
          <p className="muted">Nothing is waiting.</p>
        ) : (
          <ol className="plain-list queue">
            {queue.map((item) => (
              <li key={item.issue}>
                <Link to={`/pipeline/${item.issue}`} className="mono">
                  #{item.issue}
                </Link>{" "}
                {item.title ?? ""}{" "}
                <span className="muted mono">waiting {formatDuration(item.waitingMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel
        title="In progress"
        description="Running and queued deliveries, with the time each phase has taken."
      >
        <DataTable
          rows={inProgress}
          rowId={(d) => String(d.issue)}
          empty="No delivery is running or queued."
          columns={progressColumns}
          wide
          caption="Deliveries in progress"
        />
      </Panel>
    </div>
  );
}

function WorkerCard({ worker }: { worker: Worker }) {
  return (
    <>
      <h3 className="card-title mono">{worker.name}</h3>
      <div className="statuses">
        <Status tone={worker.online === null ? "idle" : worker.online ? "ok" : "error"}>
          {worker.online === null ? "unknown" : worker.online ? "online" : "offline"}
        </Status>
        <Status tone="idle">{worker.busy ? "busy" : "idle"}</Status>
      </div>
      {worker.busy && worker.issue !== null ? (
        <dl className="facts">
          <div>
            <dt>Issue</dt>
            <dd>
              <Link to={`/pipeline/${worker.issue}`} className="mono">
                #{worker.issue}
              </Link>{" "}
              {worker.title ?? ""}
            </dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{worker.phase ?? "—"}</dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd className="mono">
              {worker.elapsedMs === null ? "—" : formatDuration(worker.elapsedMs)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Nothing to do.</p>
      )}
    </>
  );
}

const progressColumns: Column<Delivery>[] = [
  {
    header: "Issue",
    mono: true,
    cell: (d) => <Link to={`/pipeline/${d.issue}`}>#{d.issue}</Link>,
  },
  { header: "Title", cell: (d) => d.title },
  { header: "State", cell: (d) => <StateStatus state={d.state} /> },
  { header: "Phase", cell: (d) => d.currentPhase ?? (d.state === "queued" ? "waiting" : "—") },
  {
    header: "Time per phase",
    cell: (d) => <PhaseStrip phases={d.phases} current={d.currentPhase} />,
  },
  {
    header: "Elapsed",
    numeric: true,
    cell: (d) => (d.elapsedMs === null ? "—" : formatDuration(d.elapsedMs)),
  },
];
