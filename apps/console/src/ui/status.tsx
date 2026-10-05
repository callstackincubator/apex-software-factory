import type { ReactNode } from "react";
import type { DeliveryState } from "../shared/schema.ts";

/**
 * A state is a word with an 8px square of its status colour: the colour is a second signal,
 * never the only one, and never the green of the brand.
 */
export type Tone = "ok" | "warn" | "error" | "idle";

export function Status({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  return (
    <span className={`status status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

const STATE_TONES: Readonly<Record<DeliveryState, Tone>> = {
  merged: "ok",
  running: "idle",
  queued: "idle",
  ready: "idle",
  triage: "idle",
  parked: "warn",
  blocked: "warn",
  failed: "error",
  closed: "idle",
};

export function StateStatus({ state }: { readonly state: DeliveryState }) {
  return <Status tone={STATE_TONES[state]}>{state}</Status>;
}
