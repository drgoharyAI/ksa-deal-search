import { describe, it, expect, vi } from "vitest";
import { createShutdown } from "@/src/lib/shutdown";

const quiet = { log: () => {} };

describe("createShutdown", () => {
  it("runs every step once, then exits 0", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const run = createShutdown({
      steps: [
        { name: "a", close: async () => void order.push("a") },
        { name: "b", close: async () => void order.push("b") },
      ],
      exit,
      ...quiet,
    });
    await Promise.all([run("SIGTERM"), run("SIGTERM")]);
    expect(order.sort()).toEqual(["a", "b"]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it("a failing step does not stop the others", async () => {
    const exit = vi.fn();
    const b = vi.fn(async () => {});
    await createShutdown({
      steps: [
        { name: "a", close: async () => Promise.reject(new Error("boom")) },
        { name: "b", close: b },
      ],
      exit,
      ...quiet,
    })("SIGTERM");
    expect(b).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
  it("a step that hangs is hard-killed after the timeout and shutdown still exits", async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const kill = vi.fn();
      const p = createShutdown({
        steps: [{ name: "chrome", close: () => new Promise<void>(() => {}), kill }],
        timeoutMs: 1000,
        exit,
        ...quiet,
      })("SIGTERM");
      await vi.advanceTimersByTimeAsync(1001);
      await p;
      expect(kill).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("later steps run after earlier ones (database closes after the browsers)", async () => {
    const order: string[] = [];
    await createShutdown({
      steps: [
        { name: "browser", close: () => new Promise<void>((r) => setTimeout(() => (order.push("browser"), r()), 20)) },
        { name: "db", close: async () => void order.push("db"), after: true },
      ],
      exit: () => {},
      ...quiet,
    })("SIGTERM");
    expect(order).toEqual(["browser", "db"]);
  });
});
