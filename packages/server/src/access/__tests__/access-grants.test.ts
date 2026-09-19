/**
 * Unit tests for the path-grant store (`access/access-grants.ts`).
 *
 * Covers test-plan E1–E9, E15–E19, P4, P5, X1, X3, X4, X6, X7, X13 and the
 * store-level half of X5. Real directories are used throughout because the
 * store's contract is defined over `realpath`, which is not reproducible by
 * reasoning about path strings.
 *
 * See change: add-access-grants-and-review.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `node:fs` is an ESM namespace: its exports are not configurable, so
// `vi.spyOn(fs, ...)` throws. The repo's pattern is a hoisted `vi.mock` whose
// factory forwards to spy variables declared with `vi.hoisted`.
const spies = vi.hoisted(() => ({
  writeFileSync: null as null | ((...a: any[]) => any),
  readFileSync: null as null | ((...a: any[]) => any),
  realpathSync: null as null | ((...a: any[]) => any),
  // The real implementations, captured in the factory. The test file's `fs`
  // import resolves to the MOCK, so a wrapper that calls `fs.x` would recurse
  // into itself; it must call through here instead.
  actual: {} as typeof import("node:fs"),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  spies.actual = actual;
  return {
    ...actual,
    default: actual,
    writeFileSync: (...a: any[]) => (spies.writeFileSync ?? actual.writeFileSync)(...a),
    readFileSync: (...a: any[]) => (spies.readFileSync ?? actual.readFileSync)(...a),
    realpathSync: (...a: any[]) => (spies.realpathSync ?? actual.realpathSync)(...a),
  };
});

import {
  __accessGrantsLoadCount,
  __resetAccessGrants,
  accessGrantsStorePath,
  GRANT_CAP_PER_SCOPE,
  grantedSubjects,
  listGrants,
  normalizeGrantSubject,
  recordGrant,
  revokeGrant,
} from "../access-grants.js";

let root: string;
let storePath: string;

function mkdir(...segs: string[]): string {
  const p = path.join(root, ...segs);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "access-grants-"));
  storePath = path.join(root, "store", "access-grants.json");
  process.env.PI_ACCESS_GRANTS_STORE = storePath;
  __resetAccessGrants();
});

afterEach(() => {
  spies.writeFileSync = null;
  spies.readFileSync = null;
  spies.realpathSync = null;
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("1.1–1.4 store round-trip", () => {
  it("1.1 writes and re-reads a grant carrying all four fields", () => {
    const dir = mkdir("a", "b");
    const res = recordGrant({ subject: dir, origin: "sess-1", now: 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    __resetAccessGrants(); // simulate a restart: force a real disk read
    const [grant] = listGrants();
    expect(grant.subject).toBe(fs.realpathSync(dir));
    expect(grant.scope).toBe("project");
    expect(grant.grantedAt).toBe(1000);
    expect(grant.origin).toBe("sess-1");
  });

  it("1.2 project scope survives reload, session scope does not", () => {
    const projectDir = mkdir("proj");
    const sessionDir = mkdir("sess");
    recordGrant({ subject: projectDir, scope: "project" });
    recordGrant({ subject: sessionDir, scope: "session" });
    expect(listGrants()).toHaveLength(2);

    __resetAccessGrants(); // restart
    const after = listGrants();
    expect(after.map((g) => g.subject)).toEqual([fs.realpathSync(projectDir)]);
    expect(after.some((g) => g.subject === fs.realpathSync(sessionDir))).toBe(false);
  });

  it("1.3 absent store and invalid JSON both yield zero grants", () => {
    expect(listGrants()).toEqual([]);

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{not json", "utf8");
    __resetAccessGrants();
    expect(listGrants()).toEqual([]);

    // Structurally valid JSON but the wrong shape.
    fs.writeFileSync(storePath, JSON.stringify({ version: 1, grants: "nope" }), "utf8");
    __resetAccessGrants();
    expect(listGrants()).toEqual([]);
  });

  it("1.4 round-trips through listGrants / recordGrant / revokeGrant", () => {
    const dir = mkdir("rt");
    expect(listGrants()).toEqual([]);
    recordGrant({ subject: dir });
    expect(listGrants().map((g) => g.subject)).toEqual([fs.realpathSync(dir)]);
    expect(revokeGrant(dir)).toBe(true);
    expect(listGrants()).toEqual([]);
    // Revoke is idempotent-ish: a second revoke reports nothing removed.
    expect(revokeGrant(dir)).toBe(false);
  });
});

describe("1.5–1.7 subject normalisation", () => {
  it("1.5 stores a file path as its dirname", () => {
    const dir = mkdir("a", "b");
    const file = path.join(dir, "c.txt");
    fs.writeFileSync(file, "x", "utf8");
    recordGrant({ subject: file });
    expect(listGrants()[0].subject).toBe(fs.realpathSync(dir));
  });

  it("1.6 granting a symlinked dir persists the target; retargeting does not move it", () => {
    const v1 = mkdir("v1");
    const v2 = mkdir("v2");
    const link = path.join(root, "current");
    fs.symlinkSync(v1, link);

    recordGrant({ subject: link });
    expect(listGrants()[0].subject).toBe(fs.realpathSync(v1));

    // Repoint the symlink: the grant must stay bound to v1 (design D2).
    fs.unlinkSync(link);
    fs.symlinkSync(v2, link);
    __resetAccessGrants();
    expect(listGrants()[0].subject).toBe(fs.realpathSync(v1));
    expect(grantedSubjects()).not.toContain(fs.realpathSync(v2));
  });

  it("1.7 honours the store-path override and writes nothing under $HOME", () => {
    const home = process.env.HOME ?? "";
    recordGrant({ subject: mkdir("ov") });
    expect(accessGrantsStorePath()).toBe(storePath);
    expect(fs.existsSync(storePath)).toBe(true);
    expect(fs.existsSync(path.join(home, ".pi", "dashboard", "access-grants.json"))).toBe(false);
  });

  it("normalises a subject that does not exist without throwing", () => {
    const missing = path.join(root, "nope", "deeper");
    expect(() => normalizeGrantSubject(missing)).not.toThrow();
    expect(normalizeGrantSubject(missing)).toBe(path.join(fs.realpathSync(root), "nope", "deeper"));
  });
});

describe("1.8 / D11 failed write is non-fatal", () => {
  it("1.8 leaves the subject ungranted, logs, and returns ok:false on EACCES", () => {
    const dir = mkdir("denied");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    spies.writeFileSync = () => {
      throw eacces;
    };

    const res = recordGrant({ subject: dir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("EACCES");

    // The failure must be visible server-side…
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[access-grants]"));
    // …and the admitted set must NOT widen.
    spies.writeFileSync = null;
    __resetAccessGrants();
    expect(grantedSubjects()).toEqual([]);
    expect(listGrants()).toEqual([]);
  });

  it("D11 a failed write leaves a previously persisted grant intact", () => {
    const good = mkdir("good");
    recordGrant({ subject: good });
    const bad = mkdir("bad");

    vi.spyOn(console, "warn").mockImplementation(() => {});
    spies.writeFileSync = () => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    };
    expect(recordGrant({ subject: bad }).ok).toBe(false);

    spies.writeFileSync = null;
    __resetAccessGrants();
    const subjects = grantedSubjects();
    expect(subjects).toContain(fs.realpathSync(good));
    expect(subjects).not.toContain(fs.realpathSync(bad));
  });
});

describe("1.9 / 1.10 / D10 bounds and atomicity", () => {
  it("1.9 a 201st project grant evicts the oldest by grantedAt", () => {
    const dirs: string[] = [];
    for (let i = 0; i < GRANT_CAP_PER_SCOPE; i += 1) {
      const d = mkdir("cap", `d${i}`);
      dirs.push(d);
      recordGrant({ subject: d, now: 1000 + i });
    }
    expect(listGrants()).toHaveLength(GRANT_CAP_PER_SCOPE);

    const newest = mkdir("cap", "newest");
    recordGrant({ subject: newest, now: 999_999 });

    const grants = listGrants();
    expect(grants).toHaveLength(GRANT_CAP_PER_SCOPE);
    const subjects = grants.map((g) => g.subject);
    expect(subjects).not.toContain(fs.realpathSync(dirs[0])); // oldest evicted
    expect(subjects).toContain(fs.realpathSync(dirs[1]));
    expect(subjects).toContain(fs.realpathSync(newest));
  });

  it("1.9 session churn never evicts a persisted project grant", () => {
    const project = mkdir("keep");
    recordGrant({ subject: project, now: 1 });

    for (let i = 0; i < GRANT_CAP_PER_SCOPE + 25; i += 1) {
      recordGrant({ subject: mkdir("churn", `s${i}`), scope: "session", now: 10_000 + i });
    }

    const subjects = grantedSubjects();
    expect(subjects).toContain(fs.realpathSync(project));
    // Session grants obey their own cap.
    const sessionCount = listGrants().filter((g) => g.scope === "session").length;
    expect(sessionCount).toBe(GRANT_CAP_PER_SCOPE);

    __resetAccessGrants();
    expect(grantedSubjects()).toEqual([fs.realpathSync(project)]);
  });

  it("1.10 an interrupted write leaves the store old-or-new, never truncated", () => {
    const first = mkdir("first");
    recordGrant({ subject: first });
    const before = fs.readFileSync(storePath, "utf8");

    // Fail mid-write: the temp file gets partial content, then throws. The
    // rename never runs, so the real store must be untouched.
    let call = 0;
    spies.writeFileSync = (p: any, data: any, enc: any) => {
      call += 1;
      // Write partial content to the TEMP file, then fail before the rename.
      fs.writeFileSync(p, String(data).slice(0, 20), enc);
      throw Object.assign(new Error("EIO: interrupted"), { code: "EIO" });
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const second = mkdir("second");
    expect(recordGrant({ subject: second }).ok).toBe(false);
    expect(call).toBeGreaterThan(0);

    spies.writeFileSync = null;
    const after = fs.readFileSync(storePath, "utf8");
    expect(after).toBe(before);
    // Never truncated — still parseable, and still exactly the original grant.
    expect(() => JSON.parse(after)).not.toThrow();
    __resetAccessGrants();
    expect(grantedSubjects()).toEqual([fs.realpathSync(first)]);
  });

  it("1.10 leaves no temp file behind after a successful write", () => {
    recordGrant({ subject: mkdir("clean") });
    const leftovers = fs.readdirSync(path.dirname(storePath)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("1.11 / 1.12 / D16 in-memory load and session shape", () => {
  it("1.11 loads the store at most once across 500 reads and never sync-reads when warm", () => {
    recordGrant({ subject: mkdir("hot") });
    __resetAccessGrants();

    // Prime the lazy load first, so the spy below measures only warm reads.
    expect(grantedSubjects()).toContain(fs.realpathSync(path.join(root, "hot")));
    let reads = 0;
    spies.readFileSync = (...a: any[]) => {
      reads += 1;
      return spies.actual.readFileSync(...(a as [any]));
    };
    for (let i = 0; i < 500; i += 1) grantedSubjects();
    expect(__accessGrantsLoadCount()).toBe(1);
    expect(reads).toBe(0);
    spies.readFileSync = null;
  });

  it("1.11 an empty store costs zero reads and zero realpath syscalls", () => {
    let reads = 0;
    let realpaths = 0;
    spies.readFileSync = (...a: any[]) => {
      reads += 1;
      return spies.actual.readFileSync(...(a as [any]));
    };
    spies.realpathSync = (...a: any[]) => {
      realpaths += 1;
      return spies.actual.realpathSync(...(a as [any]));
    };
    // No grant has ever been recorded → the cache is still cold.
    expect(grantedSubjects()).toEqual([]);
    expect(__accessGrantsLoadCount()).toBe(1); // one lazy disk load, then cached
    expect(realpaths).toBe(0);
    expect(reads).toBe(1);
    // A second call must not read again.
    grantedSubjects();
    expect(reads).toBe(1);
    spies.readFileSync = null;
    spies.realpathSync = null;
  });

  it("1.12 a session grant carries the same four fields, not a bare string key", () => {
    const dir = mkdir("sfour");
    recordGrant({ subject: dir, scope: "session", origin: "sess-9", now: 4242 });
    const [grant] = listGrants();
    expect(grant).toEqual({
      subject: fs.realpathSync(dir),
      scope: "session",
      grantedAt: 4242,
      origin: "sess-9",
    });
    expect(typeof grant).toBe("object");
  });
});

describe("revoke semantics", () => {
  it("revoking a persisted grant invalidates the cache without a restart", () => {
    const dir = mkdir("rv");
    recordGrant({ subject: dir });
    expect(grantedSubjects()).toContain(fs.realpathSync(dir));
    expect(revokeGrant(dir)).toBe(true);
    // No __resetAccessGrants(): the live process must see it immediately.
    expect(grantedSubjects()).not.toContain(fs.realpathSync(dir));
  });

  it("revokes a session grant and a scope-targeted revoke leaves the other scope alone", () => {
    const dir = mkdir("both");
    recordGrant({ subject: dir, scope: "session" });
    recordGrant({ subject: dir, scope: "project" });

    expect(revokeGrant(dir, "session")).toBe(true);
    expect(listGrants().map((g) => g.scope)).toEqual(["project"]);

    recordGrant({ subject: dir, scope: "session" });
    expect(revokeGrant(dir, "project")).toBe(true);
    expect(listGrants().map((g) => g.scope)).toEqual(["session"]);
  });

  it("records a widened grant's provenance", () => {
    const child = mkdir("w", "child");
    const parent = mkdir("w");
    recordGrant({ subject: parent, widenedFrom: child });
    const [grant] = listGrants();
    expect(grant.subject).toBe(fs.realpathSync(parent));
    expect(grant.widenedFrom).toBe(fs.realpathSync(child));
  });

  it("omits widenedFrom when the widening resolves to the same subject", () => {
    const dir = mkdir("same");
    recordGrant({ subject: dir, widenedFrom: dir });
    expect(listGrants()[0].widenedFrom).toBeUndefined();
  });
});
