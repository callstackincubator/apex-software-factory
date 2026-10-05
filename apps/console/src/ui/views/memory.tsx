import {
  MemoryFile,
  MemoryResponse,
  type MemoryLesson,
  type MemoryRun,
} from "../../shared/memory-schema.ts";
import { ApiError } from "../api.ts";
import { ChatMarkdown } from "../chat/markdown.tsx";
import { useNow, usePolled } from "../data.tsx";
import { formatAge, formatDuration, formatTime } from "../format.ts";
import { PageHeader, Panel, StatCards } from "../layout.tsx";
import { Link } from "../router.tsx";
import { Status } from "../status.tsx";
import { DataTable, type Column } from "../table.tsx";

const fetchMemory = async (): Promise<MemoryResponse> => {
  const res = await fetch("/api/memory", { headers: { accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return MemoryResponse.parse(await res.json());
};

const fetchMemoryFile = async (path: string): Promise<MemoryFile> => {
  const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  return MemoryFile.parse(await res.json());
};

const fileLink = (path: string) => `/memory/${path}`;
const VISIBLE_LESSONS = 5;

export function MemoryView() {
  const { data, error } = usePolled(fetchMemory, "memory");
  if (data === null) {
    return (
      <div className="view">
        <PageHeader title="Memory" />
        <p
          className={error === null ? "muted" : "refusal"}
          role={error === null ? undefined : "alert"}
        >
          {error ?? "Loading the memory…"}
        </p>
      </div>
    );
  }
  return <Memory data={data} />;
}

export function Memory({ data }: { data: MemoryResponse }) {
  const now = useNow();
  if (data.status !== "ok") {
    return (
      <div className="view">
        <PageHeader title="Memory" />
        {data.status === "empty" ? (
          <p className="muted empty">The factory has not written its memory yet.</p>
        ) : (
          <p className="notice notice-error" role="alert">
            <strong>Memory unavailable:</strong> {data.reason ?? "no reason given"}
          </p>
        )}
      </div>
    );
  }

  const topics = [
    ...new Set([...data.curated.map((c) => c.topic), ...data.lessons.map((l) => l.topic)]),
  ].sort();
  const raw = (topic: string) => data.lessons.filter((l) => l.topic === topic);

  const columns: Column<MemoryRun>[] = [
    {
      header: "When",
      mono: true,
      width: "8rem",
      cell: (r) => (
        <Link to={fileLink(r.path)}>
          {r.startedAt === null ? "unknown" : formatTime(r.startedAt, now)}
        </Link>
      ),
    },
    {
      header: "Issue",
      mono: true,
      width: "6rem",
      cell: (r) =>
        r.issue === null ? (
          <span className="muted">—</span>
        ) : (
          <Link to={`/pipeline/${r.issue}`}>#{r.issue}</Link>
        ),
    },
    { header: "Mode", width: "7rem", cell: (r) => r.mode },
    { header: "Attempt", numeric: true, width: "6rem", cell: (r) => r.attempt ?? "—" },
    {
      header: "Outcome",
      cell: (r) =>
        r.outcome === "stopped" ? (
          <span title={r.reason ?? undefined}>
            <Status tone="warn">stopped</Status>
            <span className="muted"> {r.reason}</span>
          </span>
        ) : r.outcome === "finished" ? (
          <Status tone="ok">finished</Status>
        ) : (
          <Status tone="idle">unknown</Status>
        ),
    },
    {
      header: "Duration",
      numeric: true,
      width: "7rem",
      cell: (r) => (r.durationMs === null ? "—" : formatDuration(r.durationMs)),
    },
  ];

  return (
    <div className="view">
      <PageHeader title="Memory" />
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
          { label: "Lessons", value: String(data.counts.lessons), caption: "not yet curated" },
          { label: "Curated topics", value: String(data.counts.curated) },
          { label: "Run records", value: String(data.counts.runs) },
          { label: "Retros", value: String(data.counts.retros) },
          {
            label: "Last written",
            value: data.lastWrittenAt === null ? "—" : formatAge(now - data.lastWrittenAt),
          },
        ]}
      />
      <Panel title="Lessons">
        {topics.length === 0 ? (
          <p className="muted empty">No lessons yet.</p>
        ) : (
          topics.map((topic) => {
            const curated = data.curated.find((c) => c.topic === topic);
            const lessons = raw(topic);
            return (
              <section key={topic} className="memory-topic" aria-label={topic}>
                <h3 className="subhead">{topic}</h3>
                {curated === undefined ? null : (
                  // The file's own title repeats the topic heading above it.
                  <ChatMarkdown text={curated.markdown.replace(/^\s*#{1,6} .*\n+/, "")} />
                )}
                <LessonList lessons={lessons.slice(0, VISIBLE_LESSONS)} now={now} />
                {lessons.length <= VISIBLE_LESSONS ? null : (
                  <details>
                    <summary>{lessons.length - VISIBLE_LESSONS} older lessons</summary>
                    <LessonList lessons={lessons.slice(VISIBLE_LESSONS)} now={now} />
                  </details>
                )}
              </section>
            );
          })
        )}
      </Panel>
      <Panel title="Retros">
        {data.retros.length === 0 ? (
          <p className="muted empty">No retro has run yet.</p>
        ) : (
          <ul className="memory-list">
            {data.retros.map((r) => (
              <li key={r.path}>
                <span className="muted mono">{r.date}</span>{" "}
                <Link to={fileLink(r.path)}>{r.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Run records">
        <DataTable
          rows={data.runs}
          rowId={(r) => r.path}
          empty="No run has been recorded yet."
          columns={columns}
          caption="Run records"
        />
      </Panel>
    </div>
  );
}

function LessonList({ lessons, now }: { lessons: readonly MemoryLesson[]; now: number }) {
  return (
    <ul className="memory-list">
      {lessons.map((l) => (
        <li key={l.path}>
          {l.text}{" "}
          <span className="muted mono">
            {l.date === null ? "" : formatTime(l.date, now)}
            {l.issue === null ? "" : ` · #${l.issue}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One file of the branch, rendered as Markdown: a run digest or a retro report. */
export function MemoryFileView({ path }: { path: string }) {
  const { data, error } = usePolled(() => fetchMemoryFile(path), `memory-${path}`);
  const state = { markdown: data?.markdown ?? null, error };
  return (
    <div className="view">
      <PageHeader
        title={path.split("/").pop() ?? path}
        subtitle={<Link to="/memory">Back to the memory</Link>}
      />
      {state.error === null ? null : (
        <p className="refusal" role="alert">
          {state.error}
        </p>
      )}
      {state.markdown === null ? (
        state.error === null ? (
          <p className="muted">Loading…</p>
        ) : null
      ) : (
        <Panel
          title={
            path.startsWith("runs/")
              ? "Run record"
              : path.startsWith("retros/")
                ? "Retro"
                : "Memory file"
          }
        >
          <ChatMarkdown text={state.markdown} />
        </Panel>
      )}
    </div>
  );
}
