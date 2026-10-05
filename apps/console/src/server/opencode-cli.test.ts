import { describe, expect, it } from "vitest";
import { createOpencodeCli, loopbackLink, OpencodeUnavailable, type Exec } from "./opencode-cli.ts";

const PAIR_OUTPUT = `
  Open a link to connect. Links work once and expire in 5 minutes.

  http://127.0.0.1:4096/auth/connect/AbC123
`;

function stub(result: { stdout?: string; stderr?: string } | Error): {
  exec: Exec;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const exec: Exec = async (file, args, options) => {
    calls.push([file, args, options]);
    if (result instanceof Error) throw result;
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  return { exec, calls };
}

describe("pair", () => {
  it("runs opencode pair in the repository root with a 30 s timeout and answers its loopback link", async () => {
    const { exec, calls } = stub({ stdout: PAIR_OUTPUT });

    const answer = await createOpencodeCli({ cwd: "/repo", exec }).pair();

    expect(answer).toEqual({
      url: "http://127.0.0.1:4096/auth/connect/AbC123",
      expiresInMinutes: 5,
    });
    expect(calls).toEqual([["opencode", ["pair"], { cwd: "/repo", timeout: 30_000 }]]);
  });

  it("reads the expiry from the output", async () => {
    const { exec } = stub({ stdout: PAIR_OUTPUT.replace("5 minutes", "10 minutes") });

    expect((await createOpencodeCli({ cwd: "/r", exec }).pair()).expiresInMinutes).toBe(10);
  });

  it("ignores links on hosts that are not loopback and takes the first loopback one", async () => {
    const { exec } = stub({
      stdout:
        "http://192.168.1.20:4096/auth/connect/NOPE\nhttp://evil.example/auth/connect/X\nhttp://localhost:4097/auth/connect/Good1\n",
    });

    expect((await createOpencodeCli({ cwd: "/r", exec }).pair()).url).toBe(
      "http://localhost:4097/auth/connect/Good1",
    );
  });

  it("answers unavailable, quoting the output, when no loopback link comes back", async () => {
    const { exec } = stub({
      stdout: "Open a link to connect.\nhttp://10.0.0.5:4096/auth/connect/Z\n",
    });

    const pair = createOpencodeCli({ cwd: "/r", exec }).pair();

    await expect(pair).rejects.toBeInstanceOf(OpencodeUnavailable);
    await expect(pair).rejects.toThrow(/no loopback link/);
  });

  it("answers unavailable with PATH in the message when the binary is missing", async () => {
    const { exec } = stub(Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" }));

    await expect(createOpencodeCli({ cwd: "/r", exec }).pair()).rejects.toThrow(
      "opencode is not on PATH",
    );
  });

  it("passes on OpenCode's own message when the command fails", async () => {
    const message =
      "Pairing requires the background service; run `opencode service unset disabled` first";
    const { exec } = stub(
      Object.assign(new Error("exit 1"), { code: 1, stderr: `${message}\n`, stdout: "" }),
    );

    await expect(createOpencodeCli({ cwd: "/r", exec }).pair()).rejects.toThrow(message);
  });
});

describe("info", () => {
  it("reads the version once and keeps it", async () => {
    const { exec, calls } = stub({ stdout: "2.0.22\n" });
    const cli = createOpencodeCli({ cwd: "/r", exec });

    expect(await cli.info()).toEqual({ available: true, version: "2.0.22" });
    await cli.info();
    expect(calls).toHaveLength(1);
  });

  it("is unavailable without a version when the binary is missing", async () => {
    const { exec } = stub(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    expect(await createOpencodeCli({ cwd: "/r", exec }).info()).toEqual({ available: false });
  });
});

describe("loopbackLink", () => {
  it("accepts [::1] and refuses another 127.x address", () => {
    expect(loopbackLink("http://[::1]:4096/auth/connect/a")).toBe(
      "http://[::1]:4096/auth/connect/a",
    );
    expect(loopbackLink("http://127.0.0.2:4096/x")).toBeNull();
  });
});
