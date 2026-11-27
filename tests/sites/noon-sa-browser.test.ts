import { describe, it, expect, vi, afterEach } from "vitest";
import { createNoonBrowser } from "@/src/sites/noon-sa/browser";

function fakeLauncher() {
  const state = { launches: 0, closes: 0 };
  const launch = vi.fn(async () => {
    state.launches++;
    const page = { id: state.launches };
    return {
      page: page as never,
      isAlive: () => true,
      close: async () => {
        state.closes++;
      },
    };
  });
  return { launch, state };
}

const tick = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  vi.useRealTimers();
});

describe("createNoonBrowser", () => {
  it("launches lazily once and runs concurrent jobs one at a time (FIFO)", async () => {
    const { launch, state } = fakeLauncher();
    const b = createNoonBrowser({ launch });
    expect(state.launches).toBe(0);

    const log: string[] = [];
    let releaseFirst!: () => void;
    const first = b.withPage(async () => {
      log.push("1 start");
      await new Promise<void>((r) => (releaseFirst = r));
      log.push("1 end");
      return 1;
    });
    const second = b.withPage(async () => {
      log.push("2 start");
      return 2;
    });
    for (let i = 0; i < 5; i++) await tick();
    expect(log).toEqual(["1 start"]);
    releaseFirst();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(log).toEqual(["1 start", "1 end", "2 start"]);
    expect(state.launches).toBe(1);
    await b.close();
  });

  it("a throwing job rejects its caller but does not break the queue", async () => {
    const { launch } = fakeLauncher();
    const b = createNoonBrowser({ launch });
    const bad = b.withPage(async () => {
      throw new Error("boom");
    });
    const good = b.withPage(async () => "fine");
    await expect(bad).rejects.toThrow("boom");
    expect(await good).toBe("fine");
    await b.close();
  });

  it("a failed launch rejects the job and the next job retries the launch", async () => {
    let n = 0;
    const b = createNoonBrowser({
      launch: async () => {
        if (++n === 1) throw new Error("Chrome not found");
        return { page: {} as never, isAlive: () => true, close: async () => {} };
      },
    });
    await expect(b.withPage(async () => 1)).rejects.toThrow("Chrome not found");
    expect(await b.withPage(async () => 2)).toBe(2);
    expect(n).toBe(2);
    await b.close();
  });

  it("closes Chrome after 10 min idle and relaunches on next use", async () => {
    vi.useFakeTimers();
    const { launch, state } = fakeLauncher();
    const b = createNoonBrowser({ launch });
    await b.withPage(async () => null);
    expect(state.closes).toBe(0);

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(state.closes).toBe(0);
    // Activity resets the idle timer.
    await b.withPage(async () => null);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(state.closes).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000 + 10);
    expect(state.closes).toBe(1);

    await b.withPage(async () => null);
    expect(state.launches).toBe(2);
    await b.close();
    expect(state.closes).toBe(2);
  });

  it("relaunches when the previous Chrome died", async () => {
    let alive = true;
    let launches = 0;
    const b = createNoonBrowser({
      launch: async () => {
        launches++;
        return { page: {} as never, isAlive: () => alive, close: async () => {} };
      },
    });
    await b.withPage(async () => null);
    alive = false;
    await b.withPage(async () => null);
    expect(launches).toBe(2);
    await b.close();
  });
});
