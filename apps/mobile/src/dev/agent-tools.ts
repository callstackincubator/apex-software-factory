/**
 * Agent tools: shortcuts an agent calls through appduct
 * (`appduct tools call <session> <name>`) to test the app without tapping
 * through it — read the build's state, jump to a screen, run an OTA check now,
 * emulate the "new feature landed" moment, list the native libraries in the
 * binary. They ship in every build, the booth
 * binary and OTA bundles included (a deliberate choice: one build profile,
 * `APPDUCT_ENABLED=1`, keeps the fingerprint stable), so none of them may
 * expose a secret, and anything that destroys state carries
 * `destructiveHint: true`, which the operator's appduct policy can deny.
 *
 * Handlers are plain functions over injected dependencies (`createAgentTools`),
 * unit-tested in `__tests__/agent-tools.test.ts`; `installAgentTools` registers
 * them with appduct once per JS runtime. A shipped feature adds its own tools
 * through `src/features/agent-tools.ts`; see `apps/mobile/AGENTS.md`.
 */
import type { ApiClient } from "@apex/contract";
import {
  type AppductRuntimeSchema,
  type AppductSubscription,
  type AppductToolGroupRegistrar,
  type AppductToolRegistration,
  createToolGroup,
  postEvent,
  registerEvent,
  registerTool,
} from "@appduct/react-native";
import { HotUpdater } from "@hot-updater/react-native";
import Constants from "expo-constants";
import { type Href, router } from "expo-router";
import { Platform } from "react-native";
import { z } from "zod";

import {
  defaultProbeDeps,
  type NativeCapabilityReport,
  probeNativeCapabilities,
} from "@/dev/native-capabilities";
import {
  getNavigationState,
  matchRoute,
  type NavigationState,
  waitForPathname,
} from "@/dev/navigation-state";
import { type FeatureAgentTools, featureAgentTools } from "@/features/agent-tools";
import { shippedFeatures } from "@/features/registry";
import { api, apiBaseUrl } from "@/lib/api";
import { otaBaseUrl } from "@/lib/ota";
import {
  checkForUpdateNow,
  type CheckOutcome,
  onUpdateStaged,
  previewUpdateBanner,
  type ReadyUpdate,
} from "@/lib/ota-control";
import { checkApiHealth, systemNow } from "@/lib/use-api-health";

/** Everything the handlers touch, injectable for tests. */
export type AgentToolDeps = {
  platform: string;
  appVersion: string;
  otaUrl: string;
  apiUrl: string;
  hotUpdater: Pick<
    typeof HotUpdater,
    "getBundleId" | "getMinBundleId" | "getChannel" | "getFingerprintHash" | "reload"
  >;
  api: Pick<ApiClient, "health">;
  /** Clock the API round trip is measured with; injectable for tests. */
  now: () => number;
  navigation: {
    get(): NavigationState;
    navigate(path: string): void;
    waitFor(pathname: string, timeoutMs: number): Promise<string>;
  };
  ota: {
    checkNow(): Promise<CheckOutcome>;
    preview(update: ReadyUpdate | null): boolean;
  };
  /** Runs `task` after the tool's reply has gone out (for tools that restart the app). */
  defer(task: () => void): void;
  /** Which native libraries the binary carries and whether each loads. */
  nativeCapabilities(): NativeCapabilityReport;
};

/** How long `open_route` waits for the router to land. */
export const NAVIGATION_TIMEOUT_MS = 3000;

// Keeps each registration's schema-to-handler inference while collecting them in one list.
type AnyRegistration = AppductToolRegistration<AppductRuntimeSchema, AppductRuntimeSchema>;
const tool = <I extends AppductRuntimeSchema, O extends AppductRuntimeSchema>(
  registration: AppductToolRegistration<I, O>,
): AnyRegistration => registration as unknown as AnyRegistration;

const OTA_STATUSES = [
  "no_update",
  "staged",
  "already_staged",
  "reloading",
  "download_failed",
  "failed",
  "busy",
  "unavailable",
] as const;

/** Flattens a check outcome into the object `ota_check_now` returns. */
function describeOutcome(outcome: CheckOutcome) {
  switch (outcome.status) {
    case "staged":
      return {
        status: outcome.status,
        bundleId: outcome.update.id,
        message: outcome.update.message,
        rollback: outcome.update.rollback,
      };
    case "already_staged":
    case "reloading":
    case "download_failed":
      return { status: outcome.status, bundleId: outcome.id };
    case "failed":
      return { status: outcome.status, error: outcome.error };
    default:
      return { status: outcome.status };
  }
}

/** The core tool set, independent of appduct's registry. */
export function createAgentTools(deps: AgentToolDeps): AnyRegistration[] {
  return [
    tool({
      name: "app_info",
      group: "app",
      description:
        "Return what is running: app version, platform, OTA channel, JS bundle (embedded or OTA id), native fingerprint, current route and every route. Read-only.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        appVersion: z.string(),
        platform: z.string(),
        channel: z.string(),
        bundleId: z.string(),
        embedded: z.boolean().describe("True while the binary's own JS runs (no OTA bundle yet)"),
        fingerprint: z.string().nullable().describe("Native fingerprint OTA bundles must match"),
        pathname: z.string().describe("Current route path, e.g. /"),
        routes: z.array(z.string()).describe("Screen routes, e.g. / or /features/[id]"),
        otaUrl: z.string(),
        apiUrl: z.string(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: () => {
        const bundleId = deps.hotUpdater.getBundleId();
        const nav = deps.navigation.get();
        return {
          appVersion: deps.appVersion,
          platform: deps.platform,
          channel: deps.hotUpdater.getChannel(),
          bundleId,
          embedded: bundleId === deps.hotUpdater.getMinBundleId(),
          fingerprint: deps.hotUpdater.getFingerprintHash(),
          pathname: nav.pathname,
          routes: nav.routes,
          otaUrl: deps.otaUrl,
          apiUrl: deps.apiUrl,
        };
      },
    }),

    tool({
      name: "open_route",
      group: "nav",
      description:
        "Navigate straight to a screen by its Expo Router path, skipping the taps in between. Refuses a path no route matches; app_info lists the routes.",
      inputSchema: z.object({
        path: z
          .string()
          .regex(/^\/[^\s]*$/, "a path starting with /, no spaces")
          .max(512)
          .describe("Route path with real values, e.g. / or /features/12; a ?query is passed on"),
      }),
      outputSchema: z.object({
        route: z.string().describe("The matching route, e.g. /features/[id]"),
        pathname: z.string().describe("Where the app is after navigating"),
        arrived: z
          .boolean()
          .describe(`False when the router had not landed after ${NAVIGATION_TIMEOUT_MS} ms`),
      }),
      annotations: { idempotentHint: true },
      handler: async ({ path }) => {
        const { routes } = deps.navigation.get();
        const route = matchRoute(path, routes);
        if (!route) {
          throw new Error(`No route matches ${path}. Routes: ${routes.join(", ") || "(none yet)"}`);
        }
        const target = path.split("?")[0] || "/";
        deps.navigation.navigate(path);
        const pathname = await deps.navigation.waitFor(target, NAVIGATION_TIMEOUT_MS);
        return { route, pathname, arrived: pathname === target };
      },
    }),

    tool({
      name: "ota_check_now",
      group: "ota",
      description:
        "Ask the OTA server for a newer JS bundle now instead of waiting up to 30 s; a new one is downloaded and staged, which shows the New feature landed banner. Release builds only: a debug build runs Metro's JS.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.enum(OTA_STATUSES).describe("staged = downloaded, banner showing"),
        bundleId: z.string().optional(),
        message: z.string().nullable().optional().describe("The deploy message"),
        rollback: z.boolean().optional(),
        error: z.string().optional(),
      }),
      timeoutMs: 60_000,
      annotations: { idempotentHint: true },
      handler: async () => describeOutcome(await deps.ota.checkNow()),
    }),

    tool({
      name: "show_update_banner",
      group: "ota",
      description:
        "Show the New feature landed banner as if an OTA bundle had arrived, to test or screenshot it without a deploy. Downloads nothing; tapping it only dismisses it.",
      inputSchema: z.object({
        message: z
          .string()
          .max(200)
          .default("Preview: a feature just landed")
          .describe("The deploy message shown under the title"),
        kind: z
          .enum(["update", "rollback"])
          .default("update")
          .describe("rollback shows Update withdrawn instead"),
      }),
      outputSchema: z.object({ shown: z.boolean().describe("False when no banner is mounted") }),
      annotations: { idempotentHint: true },
      handler: ({ message, kind }) => ({
        shown: deps.ota.preview({
          id: `preview-${kind}`,
          message,
          rollback: kind === "rollback",
          preview: true,
        }),
      }),
    }),

    tool({
      name: "hide_update_banner",
      group: "ota",
      description:
        "Hide the update banner, previewed or real. A real staged bundle still applies on the next cold start.",
      inputSchema: z.object({}),
      outputSchema: z.object({ hidden: z.boolean().describe("False when no banner is mounted") }),
      annotations: { idempotentHint: true },
      handler: () => ({ hidden: deps.ota.preview(null) }),
    }),

    tool({
      name: "reload_app",
      group: "ota",
      description:
        "Restart the JS runtime, into the staged OTA bundle if one is downloaded (what tapping the banner does). Loses in-memory state; the appduct session resumes.",
      inputSchema: z.object({}),
      outputSchema: z.object({ reloading: z.boolean() }),
      annotations: { destructiveHint: true },
      handler: () => {
        deps.defer(() => void deps.hotUpdater.reload());
        return { reloading: true };
      },
    }),

    tool({
      name: "api_health",
      group: "api",
      description:
        "Call the product API's /health through the contract client and return what the status footer would show, including the round trip in whole milliseconds when the API answers. Read-only.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        state: z.enum(["ok", "offline"]).describe("offline = unreachable, error, or bad response"),
        version: z.string().optional().describe("API version when ok"),
        latencyMs: z
          .number()
          .int()
          .optional()
          .describe("Round trip of this request in whole milliseconds, when ok"),
        apiUrl: z.string(),
      }),
      timeoutMs: 15_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: async () => ({
        ...(await checkApiHealth(deps.api, deps.now)),
        apiUrl: deps.apiUrl,
      }),
    }),

    tool({
      name: "native_capabilities",
      group: "native",
      description:
        "List the native libraries in this binary and whether each one's native module loads (linked, missing, or not-on-platform), checked cheaply with no permission prompts. Use it before planning a feature: OTA updates cannot add native code, so a feature that needs a library not linked here needs a native build. docs/internal/NATIVE-CAPABILITIES.md has permissions and limits. Read-only.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        platform: z.string(),
        allLinked: z.boolean().describe("True when every library with a native side here loaded"),
        missing: z.array(z.string()).describe("Ids of libraries whose native module did not load"),
        libraries: z.array(
          z.object({
            id: z.string().describe("Stable id, e.g. skia or vision-camera"),
            package: z.string().describe("npm package name"),
            version: z.string().nullable().describe("Version range in package.json"),
            status: z.enum(["linked", "missing", "not-on-platform"]),
            missingModules: z.array(z.string()).describe("kind:name of modules that did not load"),
            enables: z.string().describe("What a feature can do with it"),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
      handler: () => deps.nativeCapabilities(),
    }),
  ];
}

/** Events the app posts; agents wait on them with `appduct events tail --name 'ota.*'`. */
export const OTA_UPDATE_STAGED = "ota.update_staged";

const FEATURE_ID = /^[a-z0-9][a-z0-9-]{0,54}$/;

/**
 * Registers one feature's tools under the appduct group `features/<featureId>`.
 * `featureId` is the feature's `id` in `shippedFeatures`.
 */
export function registerFeatureTools(
  featureId: string,
  register: FeatureAgentTools["register"],
  group: (name: string) => AppductToolGroupRegistrar = createToolGroup,
): void {
  if (!FEATURE_ID.test(featureId)) {
    throw new Error(`Feature id "${featureId}" must be kebab-case, at most 55 characters.`);
  }
  if (!shippedFeatures.some((feature) => feature.id === featureId)) {
    throw new Error(`Feature "${featureId}" is not in shippedFeatures (src/features/registry.ts).`);
  }
  register(group(`features/${featureId}`));
}

/** The real app: hot-updater, Expo Router, the API client, the OTA loop. */
export function defaultAgentToolDeps(): AgentToolDeps {
  return {
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version ?? "unknown",
    otaUrl: otaBaseUrl,
    apiUrl: apiBaseUrl,
    hotUpdater: HotUpdater,
    api,
    now: systemNow,
    navigation: {
      get: getNavigationState,
      navigate: (path) => router.navigate(path as Href),
      waitFor: waitForPathname,
    },
    ota: { checkNow: checkForUpdateNow, preview: previewUpdateBanner },
    defer: (task) => setTimeout(task, 250),
    nativeCapabilities: () => probeNativeCapabilities(defaultProbeDeps()),
  };
}

let installed: AppductSubscription | null = null;

/**
 * Registers the core tools, the `ota.update_staged` event and every feature's
 * tools with appduct. Once per JS runtime; later calls return the first
 * registration.
 */
export function installAgentTools(
  deps: AgentToolDeps = defaultAgentToolDeps(),
): AppductSubscription {
  if (installed) return installed;
  const subscriptions = createAgentTools(deps).map((registration) => registerTool(registration));
  subscriptions.push(
    registerEvent({
      name: OTA_UPDATE_STAGED,
      description: "An OTA bundle was downloaded and staged; the New feature landed banner shows.",
      payloadSchema: z.object({
        bundleId: z.string(),
        message: z.string().nullable(),
        rollback: z.boolean(),
      }),
    }),
  );
  const stopListening = onUpdateStaged((update) => {
    void postEvent(OTA_UPDATE_STAGED, {
      bundleId: update.id,
      message: update.message,
      rollback: update.rollback,
    });
  });
  // Feature registrations are collected too, so `remove()` withdraws everything.
  const collectingGroup = (name: string): AppductToolGroupRegistrar => {
    const registerInGroup = createToolGroup(name) as (registration: unknown) => AppductSubscription;
    return ((registration: unknown) => {
      const subscription = registerInGroup(registration);
      subscriptions.push(subscription);
      return subscription;
    }) as AppductToolGroupRegistrar;
  };
  for (const feature of featureAgentTools) {
    registerFeatureTools(feature.featureId, feature.register, collectingGroup);
  }
  const registration: AppductSubscription = {
    remove() {
      stopListening();
      for (const subscription of subscriptions) subscription.remove();
      installed = null;
    },
  };
  installed = registration;
  return registration;
}
