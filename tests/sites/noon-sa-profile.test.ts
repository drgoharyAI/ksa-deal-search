import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateLegacyProfile, resolveProfileDir } from "@/src/sites/noon-sa/profile";

describe("resolveProfileDir", () => {
  it("prefers NOON_PROFILE_DIR", () => {
    expect(resolveProfileDir({ NOON_PROFILE_DIR: "/x/p", LOCALAPPDATA: "/la" }, "/h")).toBe(path.resolve("/x/p"));
  });
  it("uses LOCALAPPDATA", () => {
    expect(resolveProfileDir({ LOCALAPPDATA: "/la" }, "/h")).toBe(path.join("/la", "deal-search", "noon-profile"));
  });
  it("falls back to the home directory", () => {
    expect(resolveProfileDir({}, "/h")).toBe(path.join("/h", ".deal-search", "noon-profile"));
  });
});

describe("migrateLegacyProfile", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "noon-prof-"));
  it("moves the old profile when the new one is absent", () => {
    const root = tmp();
    const legacy = path.join(root, "old");
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "f"), "1");
    const target = path.join(root, "a", "new");
    expect(migrateLegacyProfile(target, legacy, () => {})).toBe("moved");
    expect(fs.existsSync(path.join(target, "f"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
  });
  it("skips when the new profile exists or there is no old one", () => {
    const root = tmp();
    const legacy = path.join(root, "old");
    const target = path.join(root, "new");
    expect(migrateLegacyProfile(target, legacy, () => {})).toBe("skipped");
    fs.mkdirSync(legacy);
    fs.mkdirSync(target);
    expect(migrateLegacyProfile(target, legacy, () => {})).toBe("skipped");
  });
  it("logs and does not throw when the rename fails", () => {
    const root = tmp();
    const legacy = path.join(root, "old");
    fs.mkdirSync(legacy);
    const blocker = path.join(root, "file");
    fs.writeFileSync(blocker, "x");
    const logs: string[] = [];
    expect(migrateLegacyProfile(path.join(blocker, "sub", "new"), legacy, (m) => logs.push(m))).toBe("failed");
    expect(logs).toHaveLength(1);
  });
});
