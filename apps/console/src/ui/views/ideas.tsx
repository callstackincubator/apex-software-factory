import { useState } from "react";
import { startChat } from "../api.ts";
import { Chat } from "../chat/chat.tsx";
import { PageHeader } from "../layout.tsx";

const STORAGE_KEY = "apex-console-idea-session";

// A reload resumes the conversation. Storage can be blocked, so nothing depends on it.
function remembered(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null): void {
  try {
    if (id === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not remembered: a reload starts over.
  }
}

export function IdeasView() {
  const [sessionId, setSessionId] = useState<string | null>(remembered);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const started = await startChat({ role: "intake" });
      remember(started.sessionId);
      setSessionId(started.sessionId);
    } catch (failure) {
      setRefusal(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const gone = () => {
    remember(null);
    setSessionId(null);
  };

  return (
    <div className="view">
      <PageHeader
        title="Ideas"
        actions={
          sessionId === null ? undefined : (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void start()}
              disabled={busy}
            >
              New idea
            </button>
          )
        }
      />
      {sessionId === null ? (
        <div className="open-row">
          <button className="button" type="button" onClick={() => void start()} disabled={busy}>
            {busy ? "Starting…" : "Start an idea"}
          </button>
        </div>
      ) : (
        <Chat sessionId={sessionId} onGone={gone} label="Idea" />
      )}
      {refusal === null ? null : (
        <p className="refusal" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
