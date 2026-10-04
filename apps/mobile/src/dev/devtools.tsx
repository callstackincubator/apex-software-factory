/**
 * Rozenite DevTools plugins, for debug builds served by Metro with
 * `WITH_ROZENITE=true` (`pnpm --filter @apex/mobile start:agent`):
 *
 * - Network Activity: every fetch the app makes (API health, OTA checks).
 * - Require Profiler: which modules slow down startup.
 * - Controls: buttons a person can press in DevTools for the same OTA actions
 *   the agent tools offer.
 * - Agent bridge: the agent tools again, under Rozenite's `app` domain
 *   (`rozenite agent app call --tool app.app_info`), so an agent with Metro but
 *   no appduct session still has them.
 *
 * The root layout loads this file only under `__DEV__`, so release and OTA
 * bundles carry none of it (each plugin entry would also swap itself for a
 * no-op when `NODE_ENV` is `production`). Expo Atlas is a Metro-only plugin
 * (metro.config.js).
 */
import { type AgentTool, useRozeniteInAppAgentTool } from "@rozenite/agent-bridge";
import { useRozeniteControlsPlugin } from "@rozenite/controls-plugin";
import { useNetworkActivityDevTools } from "@rozenite/network-activity-plugin";
import { useRequireProfilerDevTools } from "@rozenite/require-profiler-plugin";
import { useMemo, useState } from "react";
import { z } from "zod";

import { type AgentToolDeps, createAgentTools, defaultAgentToolDeps } from "@/dev/agent-tools";

type Registration = ReturnType<typeof createAgentTools>[number];

/** One agent tool, offered through Rozenite's agent bridge. */
function BridgedTool({ registration }: { registration: Registration }) {
  const tool = useMemo<AgentTool>(
    () => ({
      name: registration.name,
      description: registration.description,
      readOnly: registration.annotations?.readOnlyHint,
      destructive: registration.annotations?.destructiveHint,
      idempotent: registration.annotations?.idempotentHint,
      inputSchema: (registration.inputSchema
        ? z.toJSONSchema(registration.inputSchema as z.ZodType, { io: "input" })
        : { type: "object" }) as AgentTool["inputSchema"],
    }),
    [registration],
  );
  useRozeniteInAppAgentTool({
    tool,
    handler: async (args: unknown) => {
      const schema = registration.inputSchema as z.ZodType | undefined;
      const input = schema ? schema.parse(args ?? {}) : args;
      return registration.handler(input as never, undefined as never);
    },
  });
  return null;
}

function OtaControls({ deps }: { deps: AgentToolDeps }) {
  const [lastCheck, setLastCheck] = useState("not run");
  useRozeniteControlsPlugin({
    sections: [
      {
        id: "ota",
        title: "Over-the-air updates",
        items: [
          { id: "last-check", type: "text", title: "Last check", value: lastCheck },
          {
            id: "check-now",
            type: "button",
            title: "Check for an update now",
            actionLabel: "Check",
            onPress: async () => setLastCheck((await deps.ota.checkNow()).status),
          },
          {
            id: "preview-banner",
            type: "button",
            title: "Preview the New feature landed banner",
            actionLabel: "Show",
            onPress: () => {
              deps.ota.preview({
                id: "preview-update",
                message: "Preview: a feature just landed",
                rollback: false,
                preview: true,
              });
            },
          },
          {
            id: "hide-banner",
            type: "button",
            title: "Hide the banner",
            actionLabel: "Hide",
            onPress: () => {
              deps.ota.preview(null);
            },
          },
        ],
      },
    ],
  });
  return null;
}

/** Mount once in the root layout. Renders nothing. */
export function DevTools() {
  useNetworkActivityDevTools();
  useRequireProfilerDevTools();
  const deps = useMemo(() => defaultAgentToolDeps(), []);
  const tools = useMemo(() => createAgentTools(deps), [deps]);
  return (
    <>
      <OtaControls deps={deps} />
      {tools.map((registration) => (
        <BridgedTool key={registration.name} registration={registration} />
      ))}
    </>
  );
}
