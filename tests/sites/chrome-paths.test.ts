import { describe, it, expect } from "vitest";
import path from "node:path";
import { chromeCandidates } from "@/src/sites/chrome/cdp";

describe("chromeCandidates", () => {
  it("CHROME_PATH comes first on every platform", () => {
    expect(chromeCandidates({ CHROME_PATH: "/opt/chrome/chrome" }, "linux")[0]).toBe("/opt/chrome/chrome");
    expect(chromeCandidates({ CHROME_PATH: "D:\c\chrome.exe", ProgramFiles: "C:\PF" }, "win32")[0]).toBe("D:\c\chrome.exe");
  });
  it("Linux: the Google Chrome stable install paths (Docker image), then Chromium", () => {
    const c = chromeCandidates({}, "linux");
    expect(c.slice(0, 3)).toEqual(["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/opt/google/chrome/chrome"]);
    expect(c).toContain("/usr/bin/chromium");
    expect(c.some((p) => p.endsWith(".exe"))).toBe(false);
  });
  it("Windows: Program Files, Program Files (x86), LocalAppData", () => {
    const c = chromeCandidates({ ProgramFiles: "C:\PF", "ProgramFiles(x86)": "C:\PF86", LOCALAPPDATA: "C:\L" }, "win32");
    const rel = path.join("Google", "Chrome", "Application", "chrome.exe");
    expect(c).toEqual([path.join("C:\PF", rel), path.join("C:\PF86", rel), path.join("C:\L", rel)]);
  });
  it("macOS: the app bundle", () => {
    expect(chromeCandidates({}, "darwin")).toEqual(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]);
  });
});
