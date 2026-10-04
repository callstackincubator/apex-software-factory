import { createToolGroup, postEvent, registerEvent, registerTool } from "@appduct/react-native";
import { z } from "zod";

import {
  type AgentToolDeps,
  createAgentTools,
  installAgentTools,
  NAVIGATION_TIMEOUT_MS,
  OTA_UPDATE_STAGED,
  registerFeatureTools,
} from "@/dev/agent-tools";
import { notifyUpdateStaged } from "@/lib/ota-control";

jest.mock("@appduct/react-native", () => {
  const subscription = () => ({ remove: jest.fn() });
  return {
    registerTool: jest.fn(subscription),
    registerEvent: jest.fn(subscription),
    postEvent: jest.fn(async () => {}),
    createToolGroup: jest.fn((group: string) =>
      jest.fn((registration: object) => ({ group, registration, remove: jest.fn() })),
    ),
  };
});

jest.mock("@/features/registry", () => ({
  shippedFeatures: [
    { id: "confetti", title: "Confetti", summary: "", issue: 7, shippedAt: "2026-10-07" },
  ],
}));

beforeEach(() => jest.clearAllMocks());

const EMBEDDED = "0199a000-0000-7000-8000-000000000000";
const OTA = "0199b111-2222-7333-8444-555566667777";

function makeDeps(overrides: Partial<AgentToolDeps> = {}) {
  const deps = {
    platform: "ios",
    appVersion: "1.0.0",
    otaUrl: "http://192.168.1.20:3002/hot-updater",
    apiUrl: "http://192.168.1.20:3001",
    hotUpdater: {
      getBundleId: jest.fn(() => EMBEDDED),
      getMinBundleId: jest.fn(() => EMBEDDED),
      getChannel: jest.fn(() => "production"),
      getFingerprintHash: jest.fn(() => "610aaa016c9b22e58d1313b4d065a9ba0a833bae"),
      reload: jest.fn(async () => {}),
    },
    api: {
      health: jest.fn(async () => ({ status: "ok" as const, version: "0.1.0", uptimeSeconds: 3 })),
    },
    navigation: {
      get: jest.fn(() => ({ pathname: "/", routes: ["/", "/features/[id]", "/settings"] })),
      navigate: jest.fn(),
      waitFor: jest.fn(async (pathname: string) => pathname),
    },
    ota: {
      checkNow: jest.fn(async () => ({ status: "no_update" as const })),
      preview: jest.fn(() => true),
    },
    defer: jest.fn((task: () => void) => task()),
    ...overrides,
  };
  return deps satisfies AgentToolDeps;
}

/** Validates `input` with the tool's own schema, then runs its handler: what appduct does. */
async function call(deps: AgentToolDeps, name: string, input: unknown = {}) {
  const registration = createAgentTools(deps).find((tool) => tool.name === name);
  if (!registration) throw new Error(`no tool ${name}`);
  const args = (registration.inputSchema as z.ZodType).parse(input);
  const result = await registration.handler(args as never, undefined as never);
  return (registration.outputSchema as z.ZodType).parse(result) as Record<string, unknown>;
}

describe("agent tools", () => {
  it("app_info reports the embedded bundle, channel, fingerprint and where the app is", async () => {
    const result = await call(makeDeps(), "app_info");

    expect(result).toEqual({
      appVersion: "1.0.0",
      platform: "ios",
      channel: "production",
      bundleId: EMBEDDED,
      embedded: true,
      fingerprint: "610aaa016c9b22e58d1313b4d065a9ba0a833bae",
      pathname: "/",
      routes: ["/", "/features/[id]", "/settings"],
      otaUrl: "http://192.168.1.20:3002/hot-updater",
      apiUrl: "http://192.168.1.20:3001",
    });
  });

  it("app_info reports an OTA bundle as not embedded", async () => {
    const deps = makeDeps();
    jest.mocked(deps.hotUpdater.getBundleId).mockReturnValue(OTA);

    const result = await call(deps, "app_info");

    expect(result).toMatchObject({ bundleId: OTA, embedded: false });
  });

  it("open_route navigates to a path a dynamic route matches and reports the arrival", async () => {
    const deps = makeDeps();

    const result = await call(deps, "open_route", { path: "/features/12?tab=demo" });

    expect(deps.navigation.navigate).toHaveBeenCalledWith("/features/12?tab=demo");
    expect(deps.navigation.waitFor).toHaveBeenCalledWith("/features/12", NAVIGATION_TIMEOUT_MS);
    expect(result).toEqual({ route: "/features/[id]", pathname: "/features/12", arrived: true });
  });

  it("open_route refuses a path no route matches, naming the routes, and stays put", async () => {
    const deps = makeDeps();

    await expect(call(deps, "open_route", { path: "/nope" })).rejects.toThrow(
      "No route matches /nope. Routes: /, /features/[id], /settings",
    );
    expect(deps.navigation.navigate).not.toHaveBeenCalled();
  });

  it("open_route says it did not arrive when the router has not landed in time", async () => {
    const deps = makeDeps();
    jest.mocked(deps.navigation.waitFor).mockResolvedValue("/");

    const result = await call(deps, "open_route", { path: "/settings" });

    expect(result).toEqual({ route: "/settings", pathname: "/", arrived: false });
  });

  it("open_route's schema refuses a path that does not start with a slash", async () => {
    await expect(call(makeDeps(), "open_route", { path: "settings" })).rejects.toThrow(
      "a path starting with /",
    );
  });

  it("ota_check_now runs a check now and returns the staged bundle", async () => {
    const deps = makeDeps();
    jest.mocked(deps.ota.checkNow).mockResolvedValue({
      status: "staged",
      update: { id: OTA, message: "Add a confetti button", rollback: false },
    } as never);

    const result = await call(deps, "ota_check_now");

    expect(deps.ota.checkNow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "staged",
      bundleId: OTA,
      message: "Add a confetti button",
      rollback: false,
    });
  });

  it("ota_check_now passes on why a check failed", async () => {
    const deps = makeDeps();
    jest.mocked(deps.ota.checkNow).mockResolvedValue({
      status: "failed",
      error: "Network request failed",
    } as never);

    expect(await call(deps, "ota_check_now")).toEqual({
      status: "failed",
      error: "Network request failed",
    });
  });

  it("show_update_banner previews the banner with the given message, marked as a preview", async () => {
    const deps = makeDeps();

    const result = await call(deps, "show_update_banner", {
      message: "Add a dark mode toggle",
      kind: "rollback",
    });

    expect(deps.ota.preview).toHaveBeenCalledWith({
      id: "preview-rollback",
      message: "Add a dark mode toggle",
      rollback: true,
      preview: true,
    });
    expect(result).toEqual({ shown: true });
  });

  it("show_update_banner defaults to a new-feature banner and says when none is mounted", async () => {
    const deps = makeDeps();
    jest.mocked(deps.ota.preview).mockReturnValue(false);

    const result = await call(deps, "show_update_banner");

    expect(deps.ota.preview).toHaveBeenCalledWith(
      expect.objectContaining({ rollback: false, message: "Preview: a feature just landed" }),
    );
    expect(result).toEqual({ shown: false });
  });

  it("hide_update_banner clears the banner", async () => {
    const deps = makeDeps();

    expect(await call(deps, "hide_update_banner")).toEqual({ hidden: true });
    expect(deps.ota.preview).toHaveBeenCalledWith(null);
  });

  it("reload_app is marked destructive and reloads only after replying", async () => {
    const deps = makeDeps({ defer: jest.fn() });

    const result = await call(deps, "reload_app");

    expect(result).toEqual({ reloading: true });
    expect(deps.hotUpdater.reload).not.toHaveBeenCalled();
    jest.mocked(deps.defer).mock.calls[0]?.[0]();
    expect(deps.hotUpdater.reload).toHaveBeenCalledTimes(1);
    const registration = createAgentTools(deps).find((tool) => tool.name === "reload_app");
    expect(registration?.annotations?.destructiveHint).toBe(true);
  });

  it("the api_health tool returns latencyMs when the API answers", async () => {
    // The injected clock advances 42 ms per health call: the tool reports the
    // round trip in whole milliseconds alongside the version.
    let t = 0;
    const deps = makeDeps({
      clock: () => t,
      api: {
        health: async () => {
          t = 42;
          return { status: "ok" as const, version: "0.1.0", uptimeSeconds: 3 };
        },
      },
    });

    expect(await call(deps, "api_health")).toEqual({
      state: "ok",
      version: "0.1.0",
      latencyMs: 42,
      apiUrl: "http://192.168.1.20:3001",
    });
  });

  it("api_health returns the API version through the contract client", async () => {
    const deps = makeDeps();

    const result = await call(deps, "api_health");
    expect(result).toMatchObject({ state: "ok", version: "0.1.0" });
    expect(result.apiUrl).toBe("http://192.168.1.20:3001");
    // The ok state always carries a measured whole-millisecond round trip.
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it("api_health reads any failure as offline, like the status footer", async () => {
    const deps = makeDeps();
    jest.mocked(deps.api.health).mockRejectedValue(new TypeError("Network request failed"));

    expect(await call(deps, "api_health")).toEqual({
      state: "offline",
      apiUrl: "http://192.168.1.20:3001",
    });
  });

  it("every tool has a unique name, a group and an object output schema an agent can read", () => {
    const tools = createAgentTools(makeDeps());

    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.group).toMatch(/^[a-z]+$/);
      expect(z.toJSONSchema(tool.outputSchema as z.ZodType)).toMatchObject({ type: "object" });
      // Only reload_app may change more than what the agent asked for.
      expect(Boolean(tool.annotations?.destructiveHint)).toBe(tool.name === "reload_app");
    }
  });
});

describe("installAgentTools", () => {
  it("registers every tool and the ota.update_staged event, and posts it when a bundle is staged", () => {
    const deps = makeDeps();
    const registration = installAgentTools(deps);

    const registered = jest.mocked(registerTool).mock.calls.map(([tool]) => tool.name);
    expect(registered).toEqual(createAgentTools(deps).map((tool) => tool.name));
    expect(registerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: OTA_UPDATE_STAGED }),
    );

    notifyUpdateStaged({ id: OTA, message: "Add a confetti button", rollback: false });
    expect(postEvent).toHaveBeenCalledWith(OTA_UPDATE_STAGED, {
      bundleId: OTA,
      message: "Add a confetti button",
      rollback: false,
    });

    registration.remove();
    notifyUpdateStaged({ id: OTA, message: null, rollback: false });
    expect(postEvent).toHaveBeenCalledTimes(1);
  });
});

describe("registerFeatureTools", () => {
  it("hands a shipped feature a registrar bound to its features/<id> group", () => {
    const register = jest.fn();

    registerFeatureTools("confetti", register);

    expect(createToolGroup).toHaveBeenCalledWith("features/confetti");
    expect(register).toHaveBeenCalledWith(jest.mocked(createToolGroup).mock.results[0]?.value);
  });

  it("refuses a feature that is not in shippedFeatures", () => {
    const register = jest.fn();

    expect(() => registerFeatureTools("not-shipped", register)).toThrow(
      'Feature "not-shipped" is not in shippedFeatures',
    );
    expect(register).not.toHaveBeenCalled();
  });
});
