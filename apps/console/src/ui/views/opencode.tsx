import { useState } from "react";
import { startOpencode } from "../api.ts";
import { useSnapshot } from "../data.tsx";
import { formatCost, formatTime } from "../format.ts";
import { PageHeader, Panel } from "../layout.tsx";
import { Status } from "../status.tsx";
import { DataTable } from "../table.tsx";

export function OpencodeView() {
  const { snapshot } = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  if (snapshot === null) return null;
  const { available, version } = snapshot.opencode;

  const open = async () => {
    // Opened from the click itself, so a popup blocker lets it through; it gets its URL below.
    const tab = window.open("", "_blank");
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await startOpencode();
      if (tab !== null) tab.location.href = answer.url;
      else window.open(answer.url, "_blank");
      setPaired(answer.expiresInMinutes);
    } catch (failure) {
      tab?.close();
      setRefusal(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view">
      <PageHeader title="OpenCode" />
      <Panel title="Open OpenCode">
        <div className="open-row">
          <button className="button" type="button" onClick={open} disabled={busy}>
            {busy ? "Pairing…" : "Open OpenCode"}
          </button>
          <Status tone={available ? "ok" : "error"}>
            {available ? `opencode ${version ?? "found"}` : "opencode not on PATH"}
          </Status>
        </div>
        {refusal === null ? null : (
          <p className="refusal" role="alert">
            {refusal}
          </p>
        )}
        {paired === null || refusal !== null ? null : (
          <p className="hint" role="status">
            Paired. The link works once and expires in {paired} minutes.
          </p>
        )}
        <p className="hint">
          Signs you in with a one-time link. OpenCode runs on this machine, as you, with your
          logins.
        </p>
      </Panel>
      <Panel title="Recent sessions">
        <DataTable
          rows={snapshot.interactive}
          rowId={(s) => s.id}
          empty="No interactive session in the database."
          caption="Recent interactive sessions"
          wide
          columns={[
            { header: "Title", cell: (s) => s.title },
            { header: "Agent", mono: true, width: "7rem", cell: (s) => s.agent ?? "—" },
            {
              header: "Directory",
              mono: true,
              cell: (s) => (
                <span className="path" title={s.directory}>
                  {s.directory}
                </span>
              ),
            },
            {
              header: "Last activity",
              mono: true,
              width: "9rem",
              cell: (s) => formatTime(s.updatedAt, snapshot.generatedAt),
            },
            { header: "Cost", numeric: true, cell: (s) => formatCost(s.costUsd) },
          ]}
        />
      </Panel>
    </div>
  );
}
