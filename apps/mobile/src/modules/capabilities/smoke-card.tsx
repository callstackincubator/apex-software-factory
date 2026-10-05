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

import { Card, LiveDot, space, type Theme, useTheme } from "@/modules/ui";

// info: it ran, and the answer is a fact about the device (a permission, a missing sensor), not a pass.
export type SmokeStatus = "pending" | "ok" | "info" | "failed";

export type SmokeResult = { status: SmokeStatus; detail: string };

export const PENDING: SmokeResult = { status: "pending", detail: "running…" };

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
  id: string;
  title: string;
  result: SmokeResult;
  children?: ReactNode;
};

export function SmokeCard({ id, title, result, children }: CardProps) {
  const theme = useTheme();
  const color = statusColor(result.status, theme);
  return (
    <Card style={{ gap: space.sm, borderRadius: 12 }}>
      <View
        testID={`smoke-${id}`}
        accessible
        accessibilityLabel={`${title}: ${result.status}. ${result.detail}`}
      >
        <Card.Header>
          <LiveDot color={color} size={8} pulse={false} />
          <Text
            maxFontSizeMultiplier={1.6}
            style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.text }}
          >
            {title}
          </Text>
          <Card.Meta color={color}>{result.status}</Card.Meta>
        </Card.Header>
      </View>
      <Card.Meta color={theme.textMuted}>{result.detail}</Card.Meta>
      {children}
    </Card>
  );
}

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

export const ANSWER_TIMEOUT_MS = 5000;

export function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not answer in ${ANSWER_TIMEOUT_MS / 1000} s`)),
      ANSWER_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type BoundaryProps = {
  id: string;
  title: string;
  load: () => ComponentType;
};

// A missing native module throws when its package is first evaluated (VisionCamera creates its
// hybrid object at import): loaded lazily, inside this boundary, that fails one card, not the screen.
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
