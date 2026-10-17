/**
 * Shared core of the dashboard-trust → pi mirror (test-plan #E1 #E2 #E6 #E7 #E8 #E9).
 * See change: mirror-dashboard-trust-to-pi.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forbiddenGrantSubjects } from "../forbidden-subjects.js";
import {
  decidePiTrust,
  filterMirrorEntries,
  isMirrorDenied,
  type MirrorCandidate,
  type MirrorSourceKind,
  mirrorDenyRules,
  piTrustKey,
} from "../pi-trust-mirror.js";

const settings = (over: Partial<Record<MirrorSourceKind, boolean>> = {}) => ({
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, ...over },
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
  it("no trust-requiring resources is implicitly trusted", () => {
    expect(decidePiTrust({ ...base, hasTrustRequiringResources: false, recordedEntry: { path: "/r", decision: false } })).toEqual({ trusted: true, source: { kind: "implicit" } });
  });
});
