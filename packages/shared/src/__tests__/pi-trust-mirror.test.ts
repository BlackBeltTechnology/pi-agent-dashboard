/**
 * Shared core of the dashboard-trust → pi mirror (test-plan #E1 #E2 #E6 #E7 #E8 #E9).
 * See change: mirror-dashboard-trust-to-pi.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forbiddenGrantSubjects } from "../forbidden-subjects.js";
import { nativePathApi, piPathComparisonKey, piPathsEqual } from "../pi-path-compare.js";
import { nearestRecordedEntry } from "../pi-trust-mirror-snapshot.js";
import {
  ancestorKeys,
  decidePiTrust,
  filterMirrorEntries,
  isMirrorDenied,
  type MirrorCandidate,
  type MirrorSourceKind,
  mirrorDenyRules,
  piTrustKey,
} from "../pi-trust-mirror.js";

const settings = (over: Partial<Record<MirrorSourceKind, boolean>> = {}) => ({
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true, ...over },
});
const FAKE_HOME = "/Users/me";
const facts = { choicesReadable: true, deny: mirrorDenyRules({ homedir: FAKE_HOME, platform: "linux" }), platform: "linux" } as const;

let home: string;
beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.homedir(), ".pi-trust-mirror-test-"));
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("#E8 piTrustKey vs the installed pi trust store key", () => {
  it("matches pi for tilde, symlink, missing leaf, NBSP, case variant; relative throws", async () => {
    const { getPiCore } = await import("../../../server/src/pi/pi-resource-activation.js");
    const core = await getPiCore();
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-key-agent-"));
    const store = new core.ProjectTrustStore(agentDir);
    const w = path.join(home, "w");
    fs.mkdirSync(w);
    const link = path.join(os.tmpdir(), `pi-key-link-${process.pid}`);
    fs.symlinkSync(w, link);
    const nbspDir = path.join(home, "a\u00a0b");
    fs.mkdirSync(nbspDir);
    const inputs = [
      path.join(home, "w"),
      link,
      path.join(home, "nope", "x"),
      nbspDir,
      path.join(home, "W"), // case variant
    ];
    try {
      for (const input of inputs) {
        store.set(input, true);
        const stored = Object.keys(JSON.parse(fs.readFileSync(path.join(agentDir, "trust.json"), "utf8")));
        const key = piTrustKey(input, { home: os.homedir() });
        expect(stored).toContain(key);
        store.set(input, null);
      }
      // tilde expands against the explicit home
      const rel = path.relative(os.homedir(), w);
      store.set(`~/${rel}`, true);
      const stored = Object.keys(JSON.parse(fs.readFileSync(path.join(agentDir, "trust.json"), "utf8")));
      expect(stored).toContain(piTrustKey(`~/${rel}`, { home: os.homedir() }));
      // NBSP not normalised
      expect(piTrustKey(nbspDir, { home })).toContain("\u00a0");
      expect(() => piTrustKey("relative/dir", { home })).toThrow();
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});

describe("#E6 mirrorDenyRules exact set", () => {
  const h = "/Users/me";
  const rules = mirrorDenyRules({ homedir: h, platform: "linux" });
  const denied = (p: string) => isMirrorDenied(p, rules, "linux");
  it("ignores /Users, $HOME, /, /usr; counts $HOME/Documents", () => {
    expect(denied("/Users")).toBe(true);
    expect(denied(h)).toBe(true);
    expect(denied("/")).toBe(true);
    expect(denied("/usr")).toBe(true);
    expect(denied(`${h}/Documents`)).toBe(false);
  });
});

describe("#E7 mirrorDenyRules subtree set", () => {
  it("ignores temp, Downloads, .ssh, .aws, .cache subtrees and leaves grant subjects untouched", () => {
    const before = JSON.stringify(forbiddenGrantSubjects());
    const h = os.homedir();
    const rules = mirrorDenyRules({ homedir: h });
    for (const p of [
      "/private/tmp",
      "/tmp/clone",
      path.join(os.tmpdir(), "x"),
      path.join(h, "Downloads", "x"),
      path.join(h, ".ssh", "k"),
      path.join(h, ".aws", "p"),
      path.join(h, ".cache", "c"),
    ]) {
      expect(isMirrorDenied(p, rules), p).toBe(true);
    }
    expect(JSON.stringify(forbiddenGrantSubjects())).toBe(before);
  });
});

describe("#E1 / #E2 filterMirrorEntries source + choice", () => {
  const rows: Array<[boolean, boolean | undefined, boolean]> = [
    [true, undefined, true],
    [true, true, true],
    [true, false, false],
    [false, undefined, false],
    [false, true, true],
    [false, false, false],
  ];
  it.each(rows)("pinned source=%s choice=%s → counted=%s", (sourceOn, choice, counted) => {
    const entry: MirrorCandidate = { sourceKind: "pinned", key: `${FAKE_HOME}/Documents`, choice };
    const r = filterMirrorEntries([entry], settings({ pinned: sourceOn }), facts);
    expect(r.counted.length).toBe(counted ? 1 : 0);
    if (!counted) expect(r.ignored[0].reason).toBe("source-off");
  });

  it("accessGrants off: choice true counts, no choice is source-off", () => {
    const a: MirrorCandidate = { sourceKind: "accessGrants", key: `${FAKE_HOME}/p1`, choice: true, projectRoot: true };
    const b: MirrorCandidate = { sourceKind: "accessGrants", key: `${FAKE_HOME}/p2`, projectRoot: true };
    const r = filterMirrorEntries([a, b], settings(), facts);
    expect(r.counted).toEqual([a]);
    expect(r.ignored).toEqual([{ entry: b, reason: "source-off" }]);
  });

  it("choice true does not rescue a forbidden folder", () => {
    const e: MirrorCandidate = { sourceKind: "accessGrants", key: "/private/tmp", choice: true, projectRoot: true };
    expect(filterMirrorEntries([e], settings(), facts).ignored[0].reason).toBe("forbidden-folder");
  });

  it("unreadable choices, changed hook, non-project-root grant, not-installed workflow", () => {
    const k = (n: string) => `${FAKE_HOME}/${n}`;
    const mk = (over: Partial<MirrorCandidate>): MirrorCandidate => ({ sourceKind: "pinned", key: k("a"), ...over });
    expect(filterMirrorEntries([mk({})], settings(), { ...facts, choicesReadable: false }).ignored[0].reason).toBe("choice-unreadable");
    expect(filterMirrorEntries([mk({ sourceKind: "worktreeInit", hookState: "changed" })], settings(), facts).ignored[0].reason).toBe("hook-changed");
    expect(filterMirrorEntries([mk({ sourceKind: "worktreeInit", hookState: "unreadable" })], settings(), facts).ignored[0].reason).toBe("hook-changed");
    expect(filterMirrorEntries([mk({ sourceKind: "accessGrants", choice: true, projectRoot: false })], settings(), facts).ignored[0].reason).toBe("not-project-root");
    expect(filterMirrorEntries([mk({ sourceKind: "workflow" })], settings(), { ...facts, installed: { workflow: false } }).ignored[0].reason).toBe("source-not-installed");
  });
});

describe("#E9 decidePiTrust table", () => {
  const pinned = { sourceKind: "pinned" as const, key: "/r" };
  const base = { hasTrustRequiringResources: true, recordedEntry: null, mirrorEntry: null, mirrorEnabled: true, piDefault: "ask" as const };
  it("recorded refusal beats a pin", () => {
    expect(decidePiTrust({ ...base, recordedEntry: { path: "/r", decision: false }, mirrorEntry: pinned })).toEqual({ trusted: false, source: { kind: "recorded", path: "/r" } });
  });
  it("nearer recorded true wins", () => {
    expect(decidePiTrust({ ...base, recordedEntry: { path: "/a/b", decision: true } }).source).toEqual({ kind: "recorded", path: "/a/b" });
  });
  it("pin fills the gap, also over default never", () => {
    for (const piDefault of ["ask", "never"] as const) {
      expect(decidePiTrust({ ...base, piDefault, mirrorEntry: pinned })).toEqual({ trusted: true, source: { kind: "dashboard", sourceKind: "pinned", entry: "/r" } });
    }
  });
  it("mirror disabled equals pi resolution", () => {
    expect(decidePiTrust({ ...base, mirrorEnabled: false, mirrorEntry: pinned })).toEqual({ trusted: false, source: { kind: "default", value: "ask" } });
    expect(decidePiTrust({ ...base, mirrorEnabled: false, mirrorEntry: pinned, piDefault: "always" }).trusted).toBe(true);
  });
  // pi 1.5 order (project-trust.js:22-23): the nearest recorded entry decides
  // before implicit trust. See change: update-pi-core-1-5-adopt-apis (test-plan #E13).
  it("a recorded refusal decides a folder with no trust-requiring resources", () => {
    expect(
      decidePiTrust({ ...base, hasTrustRequiringResources: false, recordedEntry: { path: "/r", decision: false }, mirrorEntry: pinned }),
    ).toEqual({ trusted: false, source: { kind: "recorded", path: "/r" } });
  });
  // test-plan #E14
  it("nothing recorded + no trust-requiring resources is implicitly trusted (dashboard and default not consulted)", () => {
    expect(
      decidePiTrust({ ...base, hasTrustRequiringResources: false, mirrorEntry: pinned, piDefault: "never" }),
    ).toEqual({ trusted: true, source: { kind: "implicit" } });
  });
  // test-plan #E15
  it("a recorded `true` on an ancestor decides a no-resources folder", () => {
    expect(
      decidePiTrust({ ...base, hasTrustRequiringResources: false, recordedEntry: { path: "/a", decision: true } }),
    ).toEqual({ trusted: true, source: { kind: "recorded", path: "/a" } });
  });
});

/**
 * pi's `pathsEqual` (1.5.0 `utils/paths.js:31-35`, `trust-manager.js:22-35`):
 * both paths resolved, case-insensitive on win32. The win32 branch runs on every
 * host through an injected `path.win32`.
 * See change: update-pi-core-1-5-adopt-apis (test-plan #E19-#E26).
 */
describe("#E19-#E21 piPathsEqual / piPathComparisonKey", () => {
  it("win32: case, trailing separator and dot-segments compare equal; drives differ", () => {
    expect(piPathsEqual("C:\\Work\\Repo", "c:\\work\\repo", path.win32)).toBe(true);
    expect(piPathsEqual("C:\\Work\\Repo\\", "c:\\work\\repo", path.win32)).toBe(true);
    expect(piPathsEqual("C:\\Work\\..\\Work\\Repo", "c:\\work\\repo", path.win32)).toBe(true);
    expect(piPathsEqual("C:\\Work\\Repo", "D:\\Work\\Repo", path.win32)).toBe(false);
    expect(piPathComparisonKey("C:\\Work\\Repo", path.win32)).toBe("c:\\work\\repo");
  });
  it("posix: resolved but case-sensitive", () => {
    expect(piPathsEqual("/r/", "/r", path.posix)).toBe(true);
    expect(piPathsEqual("/a//r", "/a/r", path.posix)).toBe(true);
    expect(piPathsEqual("/a/./r", "/a/r", path.posix)).toBe(true);
    expect(piPathsEqual("/R", "/r", path.posix)).toBe(false);
    expect(piPathsEqual("/r", "/r2", path.posix)).toBe(false);
  });
  it("nativePathApi is read at call time", () => {
    const desc = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process, "platform", { ...desc, value: "win32" });
      expect(nativePathApi()).toBe(path.win32);
      expect(piPathComparisonKey("C:\\X")).toBe("c:\\x");
    } finally {
      Object.defineProperty(process, "platform", desc);
    }
    expect(nativePathApi()).toBe(process.platform === "win32" ? path.win32 : path.posix);
    if (process.platform !== "win32") expect(piPathComparisonKey("/X")).toBe("/X");
  });
});

describe("#E22-#E25 nearestRecordedEntry matches keys with piPathsEqual", () => {
  it("win32: own refusal saved with different casing returns the stored spelling", () => {
    expect(nearestRecordedEntry({ "C:\\Work\\Repo": false }, "c:\\work\\repo", path.win32)).toEqual({ path: "C:\\Work\\Repo", decision: false });
  });
  it("win32: a case-different drive-letter ancestor", () => {
    expect(nearestRecordedEntry({ "C:\\Work": false }, "c:\\work\\repo", path.win32)).toEqual({ path: "C:\\Work", decision: false });
  });
  it("posix: a non-normalised key matches, lookup stays case-sensitive", () => {
    expect(nearestRecordedEntry({ "/r/": false }, "/r", path.posix)).toEqual({ path: "/r/", decision: false });
    expect(nearestRecordedEntry({ "/R": false }, "/r", path.posix)).toBe(null);
  });
  it("object order, boolean filter and nearer ancestor", () => {
    const loose = (o: Record<string, unknown>) => o as Record<string, boolean>;
    expect(nearestRecordedEntry(loose({ "/r/": "yes", "/r": false }), "/r", path.posix)).toEqual({ path: "/r", decision: false });
    expect(nearestRecordedEntry({ "/r/": true, "/r": false }, "/r", path.posix)).toEqual({ path: "/r/", decision: true });
    expect(nearestRecordedEntry({ "/a": false, "/a/b/": true }, "/a/b/c", path.posix)).toEqual({ path: "/a/b/", decision: true });
  });
});

describe("#E26 ancestorKeys with an injected path module", () => {
  it("win32 and the default", () => {
    expect(ancestorKeys("c:\\work\\repo", path.win32)).toEqual(["c:\\work\\repo", "c:\\work", "c:\\"]);
    if (process.platform !== "win32") expect(ancestorKeys("/a/b")).toEqual(["/a/b", "/a", "/"]);
  });
});

describe("#E2 snapshot liveCount reader (mirror-dashboard-trust-live-remote)", () => {
  const entry = { key: "/w", sourceKind: "pinned", dev: "1", ino: "2" };
  const read = async (obj: Record<string, unknown>) => {
    const { readPiTrustMirrorSnapshot } = await import("../pi-trust-mirror-snapshot.js");
    const f = path.join(home, `snap-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(f, JSON.stringify({ version: 1, generation: 3, entries: [entry], ...obj }));
    return readPiTrustMirrorSnapshot(f);
  };
  it.each([
    ["missing", undefined, 0],
    ["negative", -1, 0],
    ["fractional", 1.5, 0],
    ["string", "2", 0],
    ["zero", 0, 0],
    ["three", 3, 3],
  ])("liveCount %s → %s", async (_n, v, expected) => {
    const snap = await read(v === undefined ? {} : { liveCount: v });
    expect(snap?.liveCount).toBe(expected);
  });
  it("a parent-era snapshot reads liveCount 0 with its entries unchanged", async () => {
    const snap = await read({});
    expect(snap).toEqual({ version: 1, generation: 3, entries: [entry], liveCount: 0 });
  });
});
