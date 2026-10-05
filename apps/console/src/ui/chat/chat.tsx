import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH, type ChatMessage, type FormValue } from "../../shared/schema.ts";
import { answerChatForm, sendChatMessage, stopChat } from "../api.ts";
import { FormCard } from "./form-card.tsx";
import { ChatMarkdown } from "./markdown.tsx";
import { useChat } from "./use-chat.ts";

/** Within this many pixels of the end counts as "at the bottom". */
const NEAR_BOTTOM = 48;

/**
 * A conversation with an OpenCode agent through the console's `/api/chat`. It owns nothing but
 * the session id it is given: which agent it talks to was decided when the session was started.
 * `onGone` is called when the console no longer knows the session.
 */
export function Chat(props: ChatProps) {
  // One mounted conversation per session: a new id starts with a clean state.
  return <Conversation key={props.sessionId} {...props} />;
}

interface ChatProps {
  readonly sessionId: string;
  readonly onGone: () => void;
  readonly label?: string;
}

function Conversation({ sessionId, onGone, label = "Conversation" }: ChatProps) {
  const { state, error, refresh } = useChat(sessionId, onGone);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const messages = state?.messages ?? [];
  const forms = state?.forms ?? [];
  const running = state?.running ?? false;

  // oxlint-disable-next-line react/incompatible-library -- nothing here is memoized on its result
  const virtual = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 88,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });
  const total = virtual.getTotalSize();

  // Stay at the end while content arrives, unless the reader scrolled up.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [total, messages.length, forms.length, running, error, actionError]);

  // A disabled textarea loses focus: give it back after a send, unless the reader moved on.
  useEffect(() => {
    if (!sending && document.activeElement === document.body) input.current?.focus();
  }, [sending]);

  const onScroll = () => {
    const element = scroller.current;
    if (element === null) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM;
    atBottom.current = near;
    setShowJump(!near);
  };

  const jump = () => {
    const element = scroller.current;
    if (element === null) return;
    atBottom.current = true;
    setShowJump(false);
    element.scrollTop = element.scrollHeight;
  };

  const act = async (run: () => Promise<unknown>): Promise<boolean> => {
    setSending(true);
    setActionError(null);
    try {
      await run();
      atBottom.current = true;
      refresh();
      return true;
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if (text === "" || sending) return;
    if (await act(() => sendChatMessage(sessionId, text))) setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  const answer = (formId: string, values: Record<string, FormValue>) =>
    void act(() => answerChatForm(sessionId, formId, values));

  const shownError = actionError ?? error ?? state?.failure ?? null;

  return (
    <section className="chat" aria-label={label}>
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        <div className="chat-rows" style={{ height: total }} role="log" aria-live="polite">
          {virtual.getVirtualItems().map((row) => {
            const message = messages[row.index];
            if (message === undefined) return null;
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtual.measureElement}
                className="chat-row"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <MessageView message={message} />
              </div>
            );
          })}
        </div>
        <div className="chat-tail">
          {forms.map((form) => (
            <FormCard key={form.id} form={form} disabled={sending} onAnswer={answer} />
          ))}
          {state?.permissionPending === true ? (
            <p className="notice" role="status">
              OpenCode is waiting for a permission.
            </p>
          ) : null}
          {running && forms.length === 0 ? (
            <p className="chat-thinking muted" role="status">
              thinking…
            </p>
          ) : null}
        </div>
      </div>
      {showJump ? (
        <button className="button button-secondary chat-jump" type="button" onClick={jump}>
          Jump to latest
        </button>
      ) : null}
      {shownError === null ? null : (
        <p className="refusal chat-error" role="alert">
          {shownError}
        </p>
      )}
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          aria-label="Message"
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          value={draft}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-composer-actions">
          {running ? (
            <button
              className="button button-secondary"
              type="button"
              disabled={sending}
              onClick={() => void act(() => stopChat(sessionId))}
            >
              Stop
            </button>
          ) : null}
          <button className="button" type="submit" disabled={sending || draft.trim() === ""}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

const MessageView = memo(function MessageView({ message }: { readonly message: ChatMessage }) {
  return (
    <div className={`chat-message chat-${message.role}`}>
      {message.parts.map((part, index) => {
        if (part.kind === "tool") {
          return (
            <p
              key={index}
              className={`chat-tool mono${part.tool.status === "error" ? " is-error" : ""}`}
              title={part.tool.status}
            >
              {part.tool.summary}
            </p>
          );
        }
        return message.role === "user" ? (
          <p key={index} className="chat-text">
            {part.text}
          </p>
        ) : (
          <ChatMarkdown key={index} text={part.text} />
        );
      })}
    </div>
  );
});
