import {
  Component,
  type ComponentType,
  createElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Text, View } from "react-native";

import { LiveDot } from "@/components/live-dot";
import { fonts, space, type Theme, useTheme } from "@/theme";

/**
 * - `pending`: still running or waiting for a native view to report back
 * - `ok`: the native side did what was asked
 * - `info`: ran, but the answer is a fact about the device (a permission
 *   status, a sensor that a simulator lacks), not a pass
 * - `failed`: threw, or never reported back
 */
export type SmokeStatus = "pending" | "ok" | "info" | "failed";

export type SmokeResult = { status: SmokeStatus; detail: string };

export const PENDING: SmokeResult = { status: "pending", detail: "running…" };

/** How long a native view gets to report that it rendered. */
export const RENDER_TIMEOUT_MS = 10_000;

function statusColor(status: SmokeStatus, theme: Theme) {
  switch (status) {
    case "ok":
      return theme.accent;
    case "failed":
      return theme.danger;
    default:
      return theme.textFaint;
  }
}

type CardProps = {
  /** Stable id: the card's testID is `smoke-<id>`. */
  id: string;
  title: string;
  result: SmokeResult;
  children?: ReactNode;
};

/** One library's live smoke: a status line, and the native view it rendered, if any. */
export function SmokeCard({ id, title, result, children }: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
      }}
    >
      <View
        testID={`smoke-${id}`}
        accessible
        accessibilityLabel={`${title}: ${result.status}. ${result.detail}`}
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <LiveDot color={statusColor(result.status, theme)} size={8} pulse={false} />
        <Text
          maxFontSizeMultiplier={1.6}
          style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.text }}
        >
          {title}
        </Text>
        <Text
          maxFontSizeMultiplier={1.6}
          style={{ fontFamily: fonts.mono, fontSize: 12, color: statusColor(result.status, theme) }}
        >
          {result.status}
        </Text>
      </View>
      <Text
        selectable
        maxFontSizeMultiplier={1.6}
        style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.textMuted }}
      >
        {result.detail}
      </Text>
      {children}
    </View>
  );
}

/**
 * Runs `check` once on mount; a returned string is the detail of an `ok`
 * result (or return a whole result), a throw is `failed`.
 */
export function useSmoke(check: () => Promise<string | SmokeResult> | string | SmokeResult) {
  const [result, setResult] = useState<SmokeResult>(PENDING);
  // Runs once per mount by design: later renders' `check` is ignored.
  const firstCheck = useRef(check);
  useEffect(() => {
    let live = true;
    (async () => firstCheck.current())()
      .then((value) => {
        if (live) setResult(typeof value === "string" ? { status: "ok", detail: value } : value);
      })
      .catch((error: unknown) => {
        if (live) setResult({ status: "failed", detail: describeError(error) });
      });
    return () => {
      live = false;
    };
  }, []);
  return result;
}

/**
 * For smokes that pass when a native view reports back (onLayout, onLoad,
 * onMapReady): `failed` if `report` is not called within RENDER_TIMEOUT_MS.
 */
export function useRenderSmoke(what: string) {
  const [result, setResult] = useState<SmokeResult>({ status: "pending", detail: "rendering…" });
  useEffect(() => {
    const timer = setTimeout(() => {
      setResult((current) =>
        current.status === "pending"
          ? {
              status: "failed",
              detail: `${what} did not report back in ${RENDER_TIMEOUT_MS / 1000} s`,
            }
          : current,
      );
    }, RENDER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [what]);
  return [result, setResult] as const;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type BoundaryProps = {
  id: string;
  title: string;
  /** Requires the smoke's module, so a library that fails to load fails only its own card. */
  load: () => ComponentType;
};

/**
 * Loads one smoke lazily and contains its failure: a native module that is
 * missing throws when its JS package is first evaluated (VisionCamera, for
 * one, creates its hybrid object at import), and that must turn into a red
 * card, not a blank screen. Lazy loading also keeps these libraries out of
 * the app's start-up path: they are evaluated only when the screen opens.
 */
export class SmokeBoundary extends Component<BoundaryProps, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: describeError(error) };
  }

  render() {
    const { id, title, load } = this.props;
    if (this.state.error) {
      return (
        <SmokeCard id={id} title={title} result={{ status: "failed", detail: this.state.error }} />
      );
    }
    return <LoadedSmoke load={load} />;
  }
}

// `load` returns the same component on every call (Metro caches the module),
// so creating the element from it does not remount the smoke.
function LoadedSmoke({ load }: { load: () => ComponentType }) {
  return createElement(load());
}
