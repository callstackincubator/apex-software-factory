import { events } from "@apex/event-bus";
import { createToolGroup, postEvent, registerEvent, registerTool } from "@appduct/react-native";
import { z } from "zod";

import { createFakeApiClient, setApiClient } from "@/modules/api";
import { createFakeUpdater, type FakeUpdater, setUpdater } from "@/modules/updater";

import {
  type AgentToolDeps,
  createAgentTools,
  installAgentTools,
  NAVIGATION_TIMEOUT_MS,
  OTA_UPDATE_STAGED,
  registerFeatureTools,
} from "../tools";

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

jest.mock("@/modules/registry", () => ({
  shippedFeatures: [
    { id: "confetti", title: "Confetti", summary: "", issue: 7, shippedAt: "2026-10-07" },
  ],
}));

const OTA = "0199b111-2222-7333-8444-555566667777";

let updater: FakeUpdater;

beforeEach(() => {
  jest.clearAllMocks();
  updater = createFakeUpdater();
  setUpdater(updater);
  setApiClient(
    createFakeApiClient(async () =>
      Response.json({ status: "ok", version: "0.1.0", uptimeSeconds: 3 }),
    ),
  );
});

function makeDeps(overrides: Partial<AgentToolDeps> = {}) {
  const deps = {
    platform: "ios",
    appVersion: "1.0.0",
    apiUrl: "http://192.168.1.20:3001",
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
    nativeCapabilities: jest.fn(() => ({
      platform: "ios",
      allLinked: false,
      missing: ["maps"],
      libraries: [
        {
          id: "skia",
          package: "@shopify/react-native-skia",
          version: "2.6.2",
          status: "linked" as const,
          missingModules: [],
          enables: "2D drawing",
        },
        {
          id: "maps",
          package: "react-native-maps",
          version: "1.27.2",
          status: "missing" as const,
          missingModules: ["turbo:RNMapsAirModule"],
          enables: "map views",
        },
      ],
    })),
    ...overrides,
  };
  return deps satisfies AgentToolDeps;
}

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
      bundleId: updater.runningBundle().id,
      embedded: true,
      fingerprint: "fake-fingerprint",
      pathname: "/",
      routes: ["/", "/features/[id]", "/settings"],
      otaUrl: "http://ota.test/hot-updater",
      apiUrl: "http://192.168.1.20:3001",
    });
  });

  it("app_info reports an OTA bundle as not embedded", async () => {
    updater.runBundle({ id: OTA, embedded: false });

    const result = await call(makeDeps(), "app_info");

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
    expect(updater.reloads).toBe(0);
    jest.mocked(deps.defer).mock.calls[0]?.[0]();
    expect(updater.reloads).toBe(1);
    const registration = createAgentTools(deps).find((tool) => tool.name === "reload_app");
    expect(registration?.annotations?.destructiveHint).toBe(true);
  });

  it("api_health returns the API version through the contract client", async () => {
    const deps = makeDeps();

    expect(await call(deps, "api_health")).toEqual({
      state: "ok",
      version: "0.1.0",
      apiUrl: "http://192.168.1.20:3001",
    });
  });

  it("api_health reads any failure as offline, like the status footer", async () => {
    setApiClient(
      createFakeApiClient(() => Promise.reject(new TypeError("Network request failed"))),
    );

    expect(await call(makeDeps(), "api_health")).toEqual({
      state: "offline",
      apiUrl: "http://192.168.1.20:3001",
    });
  });

  it("native_capabilities passes on the probe's report of what the binary links", async () => {
    const deps = makeDeps();

    const result = await call(deps, "native_capabilities");

    expect(deps.nativeCapabilities).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      platform: "ios",
      allLinked: false,
      missing: ["maps"],
      libraries: [
        { id: "skia", status: "linked", version: "2.6.2" },
        { id: "maps", status: "missing", missingModules: ["turbo:RNMapsAirModule"] },
      ],
    });
    const registration = createAgentTools(deps).find((tool) => tool.name === "native_capabilities");
    expect(registration?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
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

    events.emit("ota/update-staged", {
      id: OTA,
      message: "Add a confetti button",
      rollback: false,
    });
    expect(postEvent).toHaveBeenCalledWith(OTA_UPDATE_STAGED, {
      bundleId: OTA,
      message: "Add a confetti button",
      rollback: false,
    });

    registration.remove();
    events.emit("ota/update-staged", { id: OTA, message: null, rollback: false });
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
