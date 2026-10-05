import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatState } from "../../shared/schema.ts";
import { ApiError, fetchChat } from "../api.ts";

export const POLL_BUSY_MS = 1_000;
export const POLL_IDLE_MS = 5_000;

export interface ChatSession {
  state: ChatState | null;
  /** The last failed poll, while OpenCode or the console cannot be reached. */
  error: string | null;
  /** Reads again now, such as right after a message was sent. */
  refresh: () => void;
}

/**
 * Polls one chat: every second while a turn runs or a form waits, every 5 seconds otherwise
 * (OpenCode's event stream is not used). Mount it once per session (key by the id). `onGone` is called when the console no longer knows the
 * session, such as after it restarted.
 */
export function useChat(sessionId: string, onGone: () => void): ChatSession {
  const [state, setState] = useState<ChatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wake = useRef<() => void>(() => {});
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  }, [onGone]);

  useEffect(() => {
    let live = true;
    let inflight = false;
    let soon = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (inflight) {
        soon = true;
        return;
      }
      inflight = true;
      clearTimeout(timer);
      let next = POLL_IDLE_MS;
      try {
        const answer = await fetchChat(sessionId);
        if (!live) return;
        setState(answer);
        setError(null);
        next = answer.running || answer.forms.length > 0 ? POLL_BUSY_MS : POLL_IDLE_MS;
      } catch (failure) {
        if (!live) return;
        if (failure instanceof ApiError && failure.status === 404) {
          gone.current();
          return;
        }
        setError(failure instanceof Error ? failure.message : String(failure));
        next = POLL_BUSY_MS * 3;
      } finally {
        inflight = false;
      }
      if (live) {
        timer = setTimeout(() => void tick(), soon ? 250 : next);
        soon = false;
      }
    };

    wake.current = () => void tick();
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sessionId]);

  const refresh = useCallback(() => wake.current(), []);
  return { state, error, refresh };
}
