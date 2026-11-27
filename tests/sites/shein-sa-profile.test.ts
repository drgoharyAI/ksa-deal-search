import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { resolveSheinProfileDir } from "@/src/sites/shein-sa/profile";
import { resolveProfileDir as resolveNoonProfileDir } from "@/src/sites/noon-sa/profile";

describe("resolveSheinProfileDir", () => {
  it("prefers SHEIN_PROFILE_DIR", () => {
    expect(resolveSheinProfileDir({ SHEIN_PROFILE_DIR: "/x/s", LOCALAPPDATA: "/la" }, "/h")).toBe(path.resolve("/x/s"));
  });
  it("uses %LOCALAPPDATA%\deal-search\shein-profile", () => {
    expect(resolveSheinProfileDir({ LOCALAPPDATA: "/la" }, "/h")).toBe(path.join("/la", "deal-search", "shein-profile"));
  });
  it("falls back to the home directory", () => {
    expect(resolveSheinProfileDir({}, "/h")).toBe(path.join("/h", ".deal-search", "shein-profile"));
  });
  it("never shares noon's profile (separate cookies per store)", () => {
    const env = { LOCALAPPDATA: "/la" };
    expect(resolveSheinProfileDir(env, "/h")).not.toBe(resolveNoonProfileDir(env, "/h"));
    expect(resolveSheinProfileDir({ ...env, NOON_PROFILE_DIR: "/n" }, "/h")).toBe(path.join("/la", "deal-search", "shein-profile"));
  });
});

describe("SHEIN browser module", () => {
  it("importing it performs no fs calls and launches nothing", async () => {
    const spies = [vi.spyOn(fs, "existsSync"), vi.spyOn(fs, "mkdirSync"), vi.spyOn(fs, "readFileSync")];
    vi.resetModules();
    await import("@/src/sites/shein-sa/browser");
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});
