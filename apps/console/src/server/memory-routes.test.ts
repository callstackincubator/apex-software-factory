import { describe, expect, it } from "vitest";
import { MemoryResponse } from "../shared/memory-schema.ts";
import { createApp } from "./app.ts";
import { demoAutomations, demoChat, demoCollector } from "./demo.ts";
import { demoGit } from "./memory-demo.ts";
import { createMemory } from "./memory.ts";
import { NOW } from "./test-support.ts";

const PORT = 4280;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` };

function makeApp() {
  return createApp({
    port: PORT,
    demo: true,
    distDir: "/nonexistent",
    collector: demoCollector(() => NOW),
    automations: demoAutomations("/nonexistent", () => NOW),
    opencode: {
      info: async () => ({ available: false }),
      pair: async () => ({ url: "", expiresInMinutes: 5 }),
    },
    chat: demoChat(),
    dispatch: async () => {},
    dispatchWorkflow: async () => {},
    memory: createMemory({ now: () => NOW, git: demoGit(() => NOW) }),
  });
}

describe("GET /api/memory", () => {
  it("answers the demo memory, valid against the schema", async () => {
    const res = await makeApp().request("/api/memory", { headers });
    const body = MemoryResponse.parse(await res.json());
    expect(body.status).toBe("ok");
    expect(body.runs.length).toBeGreaterThan(0);
  });
});

describe("GET /api/memory/file", () => {
  it("returns a listed file as Markdown", async () => {
    const app = makeApp();
    const body = MemoryResponse.parse(await (await app.request("/api/memory", { headers })).json());
    const path = body.retros[0]?.path ?? "";
    const res = await app.request(`/api/memory/file?path=${encodeURIComponent(path)}`, { headers });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { markdown: string }).markdown).toContain("## Proposals");
  });

  it("rejects a path that is not in the tree, or not allowed", async () => {
    const app = makeApp();
    for (const path of ["retros/1999-01-01.md", "lessons/../README.md", "/etc/passwd", ""]) {
      const res = await app.request(`/api/memory/file?path=${encodeURIComponent(path)}`, {
        headers,
      });
      expect(res.status, path).toBe(404);
    }
  });
});
