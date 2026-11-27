import { describe, expect, it } from "vitest";
import { CHROME_GAP_MS, SITE_CAPS, checkIntervalMs, gapFor } from "@/src/lib/alerts/service";

describe("checker settings", () => {
  it("waits at least 60 s before Chrome-backed stores and caps SHEIN at 8 per cycle", () => {
    expect(CHROME_GAP_MS).toBeGreaterThanOrEqual(60_000);
    expect(gapFor("noon-sa")).toBe(CHROME_GAP_MS);
    expect(gapFor("shein-sa")).toBe(CHROME_GAP_MS);
    expect(gapFor("amazon-sa")).toBeLessThan(CHROME_GAP_MS);
    expect(SITE_CAPS["shein-sa"]).toBe(8);
  });
  it("reads ALERT_CHECK_HOURS, default 6", () => {
    expect(checkIntervalMs({})).toBe(6 * 3_600_000);
    expect(checkIntervalMs({ ALERT_CHECK_HOURS: "2" })).toBe(2 * 3_600_000);
    expect(checkIntervalMs({ ALERT_CHECK_HOURS: "x" })).toBe(6 * 3_600_000);
  });
});
