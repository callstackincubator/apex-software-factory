import { useState } from "react";
import type { Snapshot, SpecRow } from "../../shared/schema.ts";
import { startChat } from "../api.ts";
import { Chat } from "../chat/chat.tsx";
import { useSnapshot } from "../data.tsx";
import { PageHeader, Panel } from "../layout.tsx";
import { DataTable, type Column } from "../table.tsx";

type Mode = SpecRow["suggested"];

/** A running spec session: the page keeps it across a reload, so the title travels with it. */
interface Session {
  id: string;
  issue: number;
  title: string;
  mode: Mode;
}

const STORAGE_KEY = "apex-console-spec-session";

function remembered(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    const found = typeof value === "object" && value !== null ? (value as Partial<Session>) : {};
    return typeof found.id === "string" &&
      typeof found.issue === "number" &&
      typeof found.title === "string" &&
      (found.mode === "business" || found.mode === "technical")
      ? { id: found.id, issue: found.issue, title: found.title, mode: found.mode }
      : null;
  } catch {
    return null;
  }
}

function remember(session: Session | null): void {
  try {
    if (session === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Not remembered: a reload goes back to the queues.
  }
}

const LABELS: Readonly<Record<Mode, string>> = {
  business: "Write business spec",
  technical: "Write technical spec",
};

export function SpecsView() {
  const { snapshot } = useSnapshot();
  if (snapshot === null) return null;
  return <Specs snapshot={snapshot} />;
}

export function Specs({ snapshot }: { readonly snapshot: Snapshot }) {
  const [session, setSession] = useState<Session | null>(remembered);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const start = async (row: SpecRow, mode: Mode) => {
    setBusy(`${row.issue}:${mode}`);
    setRefusal(null);
    try {
      const started = await startChat({ role: "spec", issue: row.issue, mode });
      const next = { id: started.sessionId, issue: row.issue, title: row.title, mode };
      remember(next);
      setSession(next);
    } catch (failure) {
      setRefusal(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const leave = () => {
    remember(null);
    setSession(null);
  };

  if (session !== null) {
    return (
      <div className="view">
        <PageHeader
          title={`#${session.issue} ${session.title} · ${session.mode}`}
          actions={
            <button className="button button-secondary" type="button" onClick={leave}>
              Back to the queues
            </button>
          }
        />
        <Chat sessionId={session.id} onGone={leave} label={`Spec for #${session.issue}`} />
      </div>
    );
  }

  const actions = (row: SpecRow) => {
    // A request has no feature to write a technical spec in yet.
    const modes: Mode[] =
      row.kind === "request"
        ? ["business"]
        : row.suggested === "business"
          ? ["business", "technical"]
          : ["technical", "business"];
    return (
      <span className="spec-actions">
        {modes.map((mode) => (
          <button
            key={mode}
            className={mode === row.suggested ? "button" : "button button-secondary"}
            type="button"
            disabled={busy !== null}
            onClick={() => void start(row, mode)}
          >
            {busy === `${row.issue}:${mode}` ? "Starting…" : LABELS[mode]}
          </button>
        ))}
      </span>
    );
  };

  const base: Column<SpecRow>[] = [
    {
      header: "Issue",
      mono: true,
      width: "5.5rem",
      cell: (row) => (
        <a href={row.url} target="_blank" rel="noreferrer noopener">
          #{row.issue}
          <span className="visually-hidden"> (opens GitHub in a new tab)</span>
        </a>
      ),
    },
    { header: "Title", cell: (row) => row.title },
  ];
  const action: Column<SpecRow> = { header: "Action", cell: actions };
  const business: Column<SpecRow>[] = [
    ...base,
    { header: "Kind", width: "6rem", cell: (row) => <span className="muted">{row.kind}</span> },
    action,
  ];

  return (
    <div className="view">
      <PageHeader title="Specs" />
      <Panel title="Needs business spec">
        <DataTable
          rows={snapshot.specs.business}
          columns={business}
          rowId={(row) => String(row.issue)}
          empty="Nothing waits for a business spec."
          caption="Issues that need a business spec"
        />
      </Panel>
      <Panel title="Needs technical spec">
        <DataTable
          rows={snapshot.specs.technical}
          columns={[...base, action]}
          rowId={(row) => String(row.issue)}
          empty="Nothing waits for a technical spec."
          caption="Issues that need a technical spec"
        />
      </Panel>
      {refusal === null ? null : (
        <p className="refusal" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
