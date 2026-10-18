/**
 * Chrome reach + launch argv (change: add-browser-relay) — task 2.10 verify,
 * plus the D4 argv contract (macOS needs `-n … --args --profile-directory`).
 */
import { describe, expect, it } from "vitest";
import {
  buildChromeOpenCommand,
  canOpenChrome,
  chromeUserDataDir,
  dedicatedAvailability,
  resolveChromeBinary,
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

// ── Dedicated agent browser — test-plan #E1 (availability) + #E2 (binary resolution)
// See change: add-dedicated-agent-browser (tasks 1.2, 9.1, 9.2).

const MAC_SYS = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAC_USER = "/Users/u/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

describe("resolveChromeBinary (E2)", () => {
  const only = (p: string) => (q: string) => q === p;

  it("darwin: /Applications", () => {
    expect(resolveChromeBinary({ platform: "darwin", env: {}, home: "/Users/u", exists: only(MAC_SYS) })).toBe(MAC_SYS);
  });

  it("darwin: ~/Applications when /Applications has none", () => {
    expect(resolveChromeBinary({ platform: "darwin", env: {}, home: "/Users/u", exists: only(MAC_USER) })).toBe(MAC_USER);
  });

  it("darwin: home falls back to env.HOME", () => {
    expect(resolveChromeBinary({ platform: "darwin", env: { HOME: "/Users/u" }, exists: only(MAC_USER) })).toBe(MAC_USER);
  });

  it("win32: %LOCALAPPDATA%", () => {
    const exe = "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    expect(
      resolveChromeBinary({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", ProgramFiles: "C:\\Program Files" },
        exists: only(exe),
      }),
    ).toBe(exe);
  });

  it("win32: ProgramFiles(x86) is consulted", () => {
    const exe = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
    expect(
      resolveChromeBinary({ platform: "win32", env: { "ProgramFiles(x86)": "C:\\Program Files (x86)" }, exists: only(exe) }),
    ).toBe(exe);
  });

  it("linux: google-chrome-stable on PATH", () => {
    expect(
      resolveChromeBinary({
        platform: "linux",
        env: {},
        which: (n) => (n === "google-chrome-stable" ? "/usr/bin/google-chrome-stable" : null),
      }),
    ).toBe("/usr/bin/google-chrome-stable");
  });

  it("linux: default PATH walk finds google-chrome", () => {
    expect(
      resolveChromeBinary({ platform: "linux", env: { PATH: "/nope:/opt/bin" }, exists: only("/opt/bin/google-chrome") }),
    ).toBe("/opt/bin/google-chrome");
  });

  it("linux: Flatpak-only (no PATH command) → null", () => {
    expect(
      resolveChromeBinary({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        exists: only("/var/lib/flatpak/exports/bin/com.google.Chrome"),
      }),
    ).toBeNull();
  });

  it("unsupported platform → null", () => {
    expect(resolveChromeBinary({ platform: "freebsd", env: {}, exists: () => true })).toBeNull();
  });
});

describe("dedicatedAvailability (E1)", () => {
  // (binary present?, system-open?, default Chrome data dir?) — the data dir must not matter.
  const probe = (binary: boolean, systemOpen: boolean, dataDir: boolean) => {
    const exists = (p: string) =>
      (binary && p === MAC_SYS) || (dataDir && p === "/Users/u/Library/Application Support/Google/Chrome");
    const deps = { platform: "darwin" as const, env: { HOME: "/Users/u" }, exists, systemOpen: () => systemOpen };
    return { dedicated: dedicatedAvailability(deps), canOpen: canOpenChrome(deps) };
  };

  it("(binary, display, no data dir) → available, while canOpenChrome is false", () => {
    expect(probe(true, true, false)).toEqual({ dedicated: { available: true }, canOpen: false });
  });

  it("(no binary, display, data dir) → no-chrome", () => {
    expect(probe(false, true, true).dedicated).toEqual({ available: false, reason: "no-chrome" });
  });

  it("(binary, no display, data dir) → no-display", () => {
    expect(probe(true, false, true).dedicated).toEqual({ available: false, reason: "no-display" });
  });

  it("no-chrome wins when both are missing", () => {
    expect(probe(false, false, false).dedicated).toEqual({ available: false, reason: "no-chrome" });
  });

  it("default system-open probe honours PI_DASHBOARD_SYSTEM_OPEN=0", () => {
    expect(
      dedicatedAvailability({
        platform: "darwin",
        env: { HOME: "/Users/u", PI_DASHBOARD_SYSTEM_OPEN: "0" },
        exists: (p) => p === MAC_SYS,
      }),
    ).toEqual({ available: false, reason: "no-display" });
  });
});
