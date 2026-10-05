import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { DeliveryDetail, Snapshot, Window } from "../shared/schema.ts";
import { fetchDelivery, fetchSnapshot } from "./api.ts";

export const POLL_MS = 10_000;

export interface SnapshotState {
  snapshot: Snapshot | null;
  /** The last failed refresh, while the console's server cannot be reached. */
  error: string | null;
  window: Window;
  setWindow: (window: Window) => void;
}

export const SnapshotContext = createContext<SnapshotState | null>(null);

export function useSnapshot(): SnapshotState {
  const state = useContext(SnapshotContext);
  if (state === null) throw new Error("useSnapshot needs a SnapshotContext provider");
  return state;
}

/** Asks `/api/snapshot` every 10 seconds, and keeps the last answer when one fails. */
export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [window, setWindow] = useState<Window>("7d");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetchSnapshot(window).then(
        (next) => {
          if (!live) return;
          setSnapshot(next);
          setError(null);
        },
        (failure: unknown) => {
          if (live) setError(failure instanceof Error ? failure.message : String(failure));
        },
      );
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [window]);

  const value = useMemo(() => ({ snapshot, error, window, setWindow }), [snapshot, error, window]);
  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

export interface Polled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Asks `load` now and every 10 seconds; keeps the last answer when one fails. */
export function usePolled<T>(load: () => Promise<T>, key: string): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null, loading: true });
    const once = () =>
      load().then(
        (data) => live && setState({ data, error: null, loading: false }),
        (failure: unknown) =>
          live &&
          setState((previous) => ({
            data: previous.data,
            error: failure instanceof Error ? failure.message : String(failure),
            loading: false,
          })),
      );
    void once();
    const timer = setInterval(() => void once(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // `load` is a closure over `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export interface DetailState {
  detail: DeliveryDetail | null;
  error: string | null;
  loading: boolean;
}

/** One delivery's detail, asked again every 10 seconds. */
export function useDelivery(issue: number): DetailState {
  const { data, error, loading } = usePolled(() => fetchDelivery(issue), `delivery-${issue}`);
  return { detail: data, error, loading };
}

/** The current time, ticking every second, for "updated 4 s ago". */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
