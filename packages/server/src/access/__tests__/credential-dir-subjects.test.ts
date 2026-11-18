/**
 * Credential directories and browser profiles are sensitive grant subjects
 * (harden-agent-tool-guards D7). Rows T.30–T.33, T.36, T.37, T.39, T.40, T.76, T.83 (parity oracle).
 * Test-plan #E30–#E33, #E36, #E37, #E39, #E40, #E77, #E84.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromeUserDataDir } from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offeredAncestorLadder } from "../ancestor-ladder.js";
import {
  browserProfileRoots,
  forbiddenGrantSubjects,
  isForbiddenGrantSubject,
  isUngrantableSubject,
} from "../forbidden-subjects.js";

const posix = (p: string, platform: NodeJS.Platform, home = "/h") => ({ homedir: home, platform, env: {} as NodeJS.ProcessEnv });
const BASE = (home: string) => [".ssh", ".pi", ".aws", ".config/gh", ".gnupg", ".kube", ".docker", ".netrc"].map((s) => path.posix.join(home, s));

describe("T.30 darwin browser roots (design D7 table, by equality)", () => {
  const env = posix("", "darwin");
  const support = "/h/Library/Application Support";
  const expected = ["Google/Chrome", "Chromium", "Microsoft Edge", "BraveSoftware", "Firefox"].map((d) => `${support}/${d}`);
  it("holds exactly the five roots", () => {
    expect(browserProfileRoots("darwin", "/h", {})).toEqual(expected);
    expect(forbiddenGrantSubjects(env).sensitive.sort()).toEqual([...BASE("/h"), ...expected].sort());
  });
  it("the Chrome entry equals chromeUserDataDir; linux/win32 roots are absent", () => {
    expect(expected[0]).toBe(chromeUserDataDir("darwin", { HOME: "/h" }));
    const sensitive = forbiddenGrantSubjects(env).sensitive.join("\n");
    expect(sensitive).not.toContain(".config/google-chrome");
    expect(sensitive).not.toContain(".mozilla");
    expect(sensitive).not.toMatch(/AppData/);
  });
  it("a read under each root is ungrantable / forbidden", () => {
    for (const r of expected) {
      expect(isForbiddenGrantSubject(`${r}/Default`, env), r).toBe(true);
      expect(isUngrantableSubject(`${r}/Default`, env), r).toBe(true);
    }
  });
});

describe("T.31 linux browser roots", () => {
  const env = posix("", "linux");
  const expected = ["google-chrome", "chromium", "microsoft-edge", "BraveSoftware"].map((d) => `/h/.config/${d}`).concat("/h/.mozilla");
  it("holds exactly the listed roots; macOS/Windows roots absent; ~/.config/app stays grantable", () => {
    expect(browserProfileRoots("linux", "/h", {})).toEqual(expected);
    expect(forbiddenGrantSubjects(env).sensitive.sort()).toEqual([...BASE("/h"), ...expected].sort());
    expect(expected[0]).toBe(chromeUserDataDir("linux", { HOME: "/h" }));
    expect(forbiddenGrantSubjects(env).sensitive.join("\n")).not.toContain("Library");
    for (const r of expected) expect(isForbiddenGrantSubject(`${r}/Default/Cookies`, env), r).toBe(true);
    expect(isUngrantableSubject("/h/.config/app", env)).toBe(false);
    expect(isForbiddenGrantSubject("/h/.config/app", env)).toBe(false);
  });
});

describe("T.32 win32 browser roots", () => {
  const vars = { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", APPDATA: "C:\\Users\\u\\AppData\\Roaming" } as NodeJS.ProcessEnv;
  const env = { homedir: "C:\\Users\\u", platform: "win32" as const, env: vars };
  const expected = [
    "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data",
    "C:\\Users\\u\\AppData\\Local\\Microsoft\\Edge\\User Data",
    "C:\\Users\\u\\AppData\\Local\\BraveSoftware",
    "C:\\Users\\u\\AppData\\Roaming\\Mozilla",
  ];
  it("holds exactly the listed roots; POSIX roots absent", () => {
    expect(browserProfileRoots("win32", "C:\\Users\\u", vars)).toEqual(expected);
    expect(expected[0]).toBe(chromeUserDataDir("win32", { LOCALAPPDATA: vars.LOCALAPPDATA }));
    const sensitive = forbiddenGrantSubjects(env).sensitive;
    for (const r of expected) expect(sensitive).toContain(r);
    expect(sensitive.join("\n")).not.toContain("/.config");
    for (const r of expected) expect(isForbiddenGrantSubject(`${r}\\Default`, env), r).toBe(true);
  });
});

describe("T.33 / T.39 grant subjects refused in both directions", () => {
  const env = posix("", "linux");
  it("a directory containing a sensitive dir is refused; ordinary dirs are not", () => {
    expect(isUngrantableSubject("/h/.config", env)).toBe(true); // contains ~/.config/gh
    expect(isUngrantableSubject("/h/.config/app", env)).toBe(false);
    const mac = posix("", "darwin");
    expect(isUngrantableSubject("/h/Library/Application Support", mac)).toBe(true);
    expect(isUngrantableSubject("/h/Library/Application Support/Code", mac)).toBe(false);
  });
  it("T.39 each credential directory and descendant is refused", () => {
    for (const s of ["/h/.aws", "/h/.aws/cache", "/h/.gnupg", "/h/.docker", "/h/.kube/x"]) {
      expect(isUngrantableSubject(s, env), s).toBe(true);
    }
    expect(isUngrantableSubject("/h/.config/app", env)).toBe(false);
  });
  it("T.39 a symlink to ~/.kube is refused (real-path comparison)", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cred-dir-")));
    try {
      const home = path.join(tmp, "home");
      fs.mkdirSync(path.join(home, ".kube"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "w"));
      fs.symlinkSync(path.join(home, ".kube"), path.join(tmp, "w", "x"));
      expect(isUngrantableSubject(path.join(tmp, "w", "x"), { homedir: home })).toBe(true);
      expect(isUngrantableSubject(path.join(tmp, "w"), { homedir: home })).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("T.36 / T.37 `~/.netrc` is exact-name only (recorded residual)", () => {
  it("~/.netrc.bak and ~/.netrc.d/x are not sensitive; ~/.netrc itself is; win32 `_netrc` is not", () => {
    const env = posix("", "linux");
    expect(isForbiddenGrantSubject("/h/.netrc", env)).toBe(true);
    expect(isForbiddenGrantSubject("/h/.netrc.bak", env)).toBe(false);
    expect(isForbiddenGrantSubject("/h/.netrc.d/x", env)).toBe(false);
    expect(isUngrantableSubject("/h/.netrc.d", env)).toBe(false); // still offers Always allow ~/.netrc.d
    const win = { homedir: "C:\\Users\\u", platform: "win32" as const, env: {} as NodeJS.ProcessEnv };
    expect(isForbiddenGrantSubject("C:\\Users\\u\\_netrc", win)).toBe(false);
  });
});

describe("T.40 ancestor ladder", () => {
  let home: string;
  beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ladder-cred-")));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
  it("names ~/.config/app (grantable) but no rung equals, lies inside or contains ~/.config/gh; nothing for ~/.aws", async () => {
    fs.mkdirSync(path.join(home, ".config", "app"), { recursive: true });
    fs.mkdirSync(path.join(home, ".config", "gh"), { recursive: true });
    fs.mkdirSync(path.join(home, ".aws"), { recursive: true });
    const env = { homedir: home };
    // A denial naming ~/.config/app/x has the grant subject ~/.config/app (its directory) ...
    expect(isUngrantableSubject(path.join(home, ".config", "app"), env)).toBe(false);
    // ... and the ladder above it may not climb into ~/.config (it contains ~/.config/gh).
    const app = await offeredAncestorLadder(path.join(home, ".config", "app"), env);
    expect(app).not.toContain(path.join(home, ".config"));
    expect(app.some((r) => r === path.join(home, ".config", "gh") || r.startsWith(`${path.join(home, ".config", "gh")}${path.sep}`))).toBe(false);
    // ~/.config/gh/hosts.yml and ~/.aws/x: the subject itself is refused and nothing is offered.
    expect(isUngrantableSubject(path.join(home, ".config", "gh"), env)).toBe(true);
    expect(await offeredAncestorLadder(path.join(home, ".config", "gh"), env)).toEqual([]);
    expect(isUngrantableSubject(path.join(home, ".aws"), env)).toBe(true);
    expect(await offeredAncestorLadder(path.join(home, ".aws"), env)).toEqual([]);
  });
});

describe("T.76 segment boundary: look-alikes are not credential dirs", () => {
  const env = posix("", "linux");
  it("look-alike names are neither forbidden nor ungrantable; exact names and descendants are", () => {
    for (const s of ["/h/.awscli/x", "/h/.aws-old/x", "/h/.config/github/x", "/h/.config/gh-ext/x", "/h/.dockerignore", "/h/.kubernetes/x", "/h/.gnupg2/x", "/h/.netrcx"]) {
      expect(isForbiddenGrantSubject(s, env), s).toBe(false);
      expect(isUngrantableSubject(s, env), s).toBe(false);
    }
    for (const s of ["/h/.aws", "/h/.aws/x", "/h/.config/gh", "/h/.config/gh/hosts.yml", "/h/.gnupg", "/h/.kube", "/h/.docker", "/h/.netrc"]) {
      expect(isForbiddenGrantSubject(s, env), s).toBe(true);
    }
  });
});

describe("T.83 parity oracle: a new subject behaves like ~/.ssh in the shared predicates", () => {
  it("forbidden / ungrantable verdicts equal ~/.ssh's", () => {
    const env = posix("", "linux");
    for (const s of ["/h/.aws", "/h/.kube/x", "/h/.docker"]) {
      expect(isForbiddenGrantSubject(s, env)).toBe(isForbiddenGrantSubject("/h/.ssh", env));
      expect(isUngrantableSubject(s, env)).toBe(isUngrantableSubject("/h/.ssh", env));
    }
  });
});
