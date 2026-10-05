import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "./index.ts";

declare module "./index.ts" {
  interface DomainEvents {
    "test/pinged": { count: number };
  }
}

describe("event bus", () => {
  it("delivers the payload to every listener, in subscription order, before emit returns", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.on("test/pinged", ({ count }) => seen.push(`first ${count}`));
    bus.on("test/pinged", ({ count }) => seen.push(`second ${count}`));

    bus.emit("test/pinged", { count: 1 });

    expect(seen).toEqual(["first 1", "second 1"]);
  });

  it("stops delivering to a listener once it unsubscribes", () => {
    const bus = createEventBus();
    const listener = vi.fn();
    const off = bus.on("test/pinged", listener);

    bus.emit("test/pinged", { count: 1 });
    off();
    bus.emit("test/pinged", { count: 2 });

    expect(listener.mock.calls).toEqual([[{ count: 1 }]]);
  });

  it("reports a failing listener and still runs the rest, without throwing at the emitter", () => {
    const failures: unknown[] = [];
    const bus = createEventBus((error) => failures.push(error));
    const later = vi.fn();
    bus.on("test/pinged", () => {
      throw new Error("side effect broke");
    });
    bus.on("test/pinged", later);

    expect(() => bus.emit("test/pinged", { count: 1 })).not.toThrow();
    expect(later).toHaveBeenCalledWith({ count: 1 });
    expect(failures).toEqual([new Error("side effect broke")]);
  });
});
