import { useEffect } from "react";
import type { Source } from "../shared/schema.ts";
import { SnapshotProvider, useNow, useSnapshot } from "./data.tsx";
import { formatAge } from "./format.ts";
import { Brand } from "./layout.tsx";
import { Link, usePath } from "./router.tsx";
import { Status } from "./status.tsx";
import { DeliveryView } from "./views/delivery.tsx";
import { OpencodeView } from "./views/opencode.tsx";
import { OverviewView } from "./views/overview.tsx";
import { PipelineView } from "./views/pipeline.tsx";
import { AutomationView } from "./views/automation.tsx";
import { AutomationsView } from "./views/automations.tsx";
import { StatsView } from "./views/stats.tsx";

export const TABS = [
  { path: "/", label: "Overview" },
  { path: "/pipeline", label: "Pipeline" },
  { path: "/stats", label: "Stats" },
  { path: "/automations", label: "Automations" },
  { path: "/opencode", label: "OpenCode" },
] as const;

type Tab = (typeof TABS)[number];

export function tabFor(path: string): Tab | undefined {
  if (path === "/") return TABS[0];
  return TABS.find(
    (tab) => tab.path !== "/" && (path === tab.path || path.startsWith(`${tab.path}/`)),
  );
}

export function App() {
  return (
    <SnapshotProvider>
      <Shell />
    </SnapshotProvider>
  );
}

function Route({ path }: { path: string }) {
  if (path === "/") return <OverviewView />;
  if (path === "/pipeline") return <PipelineView />;
  const delivery = /^\/pipeline\/(\d+)$/.exec(path);
  if (delivery) return <DeliveryView issue={Number(delivery[1])} />;
  if (path === "/stats") return <StatsView />;
  if (path === "/automations") return <AutomationsView />;
  const automation = /^\/automations\/([^/]+)$/.exec(path);
  if (automation) return <AutomationView file={decodeURIComponent(automation[1] ?? "")} />;
  if (path === "/opencode") return <OpencodeView />;
  return (
    <div className="view">
      <h1>Not found</h1>
      <p className="muted">
        There is no page at <code>{path}</code>. <Link to="/">Back to the overview</Link>.
      </p>
    </div>
  );
}

export function Shell() {
  const path = usePath();
  const tab = tabFor(path);
  const { error, snapshot } = useSnapshot();

  useEffect(() => {
    document.title = tab === undefined ? "Apex Factory" : `${tab.label} · Apex Factory`;
  }, [tab]);

  const unavailable = snapshot?.sources.filter((s) => s.status === "unavailable") ?? [];
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Brand />
        <div className="topbar-end">
          {snapshot === null ? null : <SourceStatuses snapshot={snapshot} />}
        </div>
      </header>
      <nav className="tabs" aria-label="Console">
        <ul>
          {TABS.map((entry) => (
            <li key={entry.path}>
              <Link to={entry.path} aria-current={entry === tab ? "page" : undefined}>
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" className="main" tabIndex={-1}>
        {error === null ? null : (
          <p className="notice notice-error" role="alert">
            The console server did not answer: {error}.{" "}
            {snapshot === null ? "" : "Showing what the page last received."}
          </p>
        )}
        {unavailable.length === 0 ? null : (
          <ul className="notice-list" aria-label="Unavailable sources">
            {unavailable.map((source) => (
              <li key={source.name} className="notice">
                <strong>{SOURCE_NAMES[source.name]} unavailable:</strong>{" "}
                {source.reason ?? "no reason given"}
              </li>
            ))}
          </ul>
        )}
        {snapshot === null && error === null ? <p className="muted">Loading the factory…</p> : null}
        {snapshot === null && error !== null ? null : <Route path={path} />}
      </main>
    </div>
  );
}

const SOURCE_NAMES: Readonly<Record<Source["name"], string>> = {
  github: "GitHub",
  opencode: "OpenCode database",
  runLogs: "Run logs",
};

const SOURCE_LABELS: Readonly<Record<Source["name"], string>> = {
  github: "github",
  opencode: "opencode",
  runLogs: "run logs",
};

function SourceStatuses({
  snapshot,
}: {
  snapshot: NonNullable<ReturnType<typeof useSnapshot>["snapshot"]>;
}) {
  const now = useNow();
  return (
    <>
      <ul className="statuses connection" aria-label="Sources">
        {snapshot.demo ? (
          <li>
            <Status tone="warn">demo</Status>
          </li>
        ) : (
          snapshot.sources.map((source) => (
            <li key={source.name} title={source.reason}>
              <Status tone={source.status === "ok" ? "ok" : "error"}>
                {SOURCE_LABELS[source.name]} {source.status}
              </Status>
            </li>
          ))
        )}
      </ul>
      <p className="connection mono updated" role="status">
        updated {formatAge(now - snapshot.generatedAt)}
      </p>
    </>
  );
}
