/**
 * Chrome reach + launch argv (change: add-browser-relay) — task 2.10 verify,
 * plus the D4 argv contract (macOS needs `-n … --args --profile-directory`).
 */
import { describe, expect, it } from "vitest";
import {
  buildChromeOpenCommand,
  canOpenChrome,
  chromeUserDataDir,
} from "../capability.js";

describe("canOpenChrome (2.10)", () => {
  const env = { HOME: "/home/u", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" };

  it("false when the host cannot reach a desktop (headless/container)", () => {
    expect(
      canOpenChrome({
        env: { ...env, PI_DASHBOARD_SYSTEM_OPEN: "0" },
        platform: "darwin",
        exists: () => true,
      }),
    ).toBe(false);
  });

  it("false on a desktop OS when Chrome's user-data dir is absent", () => {
    expect(
      canOpenChrome({ env: { ...env, PI_DASHBOARD_SYSTEM_OPEN: "1" }, platform: "darwin", exists: () => false }),
    ).toBe(false);
  });

  it("true on an explicit override + an existing user-data dir", () => {
    expect(
      canOpenChrome({
        env: { ...env, PI_DASHBOARD_SYSTEM_OPEN: "1" },
        platform: "darwin",
        exists: (p) => p === `${env.HOME}/Library/Application Support/Google/Chrome`,
      }),
    ).toBe(true);
  });

  it("false on a display-less Linux host even with a user-data dir", () => {
    expect(
      canOpenChrome({ env, platform: "linux", exists: () => true }),
    ).toBe(false);
  });

  it("resolves the per-OS user-data dir", () => {
    expect(chromeUserDataDir("darwin", env)).toBe(
      "/home/u/Library/Application Support/Google/Chrome",
    );
    expect(chromeUserDataDir("linux", env)).toBe("/home/u/.config/google-chrome");
    expect(chromeUserDataDir("win32", env)).toBe(
      "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data",
    );
  });
});

describe("buildChromeOpenCommand (D4)", () => {
  it("macOS: open -na Google Chrome --args --profile-directory=<dir> <url>", () => {
    expect(buildChromeOpenCommand("darwin", "Profile 37", "chrome-extension://x/connect.html")).toEqual({
      cmd: "open",
      args: [
        "-na",
        "Google Chrome",
        "--args",
        "--profile-directory=Profile 37",
        "chrome-extension://x/connect.html",
      ],
    });
  });

  it("passes a directory with spaces as ONE argv element (no shell)", () => {
    const { args } = buildChromeOpenCommand("darwin", "Profile 37", "u");
    expect(args.filter((a) => a.startsWith("--profile-directory="))).toEqual([
      "--profile-directory=Profile 37",
    ]);
  });

  it("linux / windows use the chrome binary directly", () => {
    expect(buildChromeOpenCommand("linux", "Default", "u").cmd).toBe("google-chrome");
    expect(buildChromeOpenCommand("win32", "Default", "u").cmd).toBe("chrome.exe");
    expect(buildChromeOpenCommand("linux", "Default", "u").args).toEqual([
      "--profile-directory=Default",
      "u",
    ]);
  });
});
