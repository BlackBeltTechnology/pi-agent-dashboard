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
  grantedWriteSubjects,
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

/**
 * Load-time hardening. The write path already enforced these; the READ path did
 * not, so a store that was hand-edited, hostile, copied between machines, or
 * written by an OLDER build (whose forbidden list and format differed) could put
 * the process into a state the write path would never have allowed.
 *
 * Found by the task 8.8 doubt-driven review (findings 1, 2, 3, 5, 12); each case
 * below FAILS on the pre-fix `loadFromDisk`, which filtered on shape alone.
 */
describe("D15/D11 load-time hardening", () => {
  function seedStore(grants: unknown[], version = 1): void {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({ version, grants }), "utf8");
    __resetAccessGrants();
  }

  it("finding 1: a forbidden subject ALREADY ON DISK is never admitted", () => {
    // `recordGrant` refuses these, but nothing re-checked the file. One on-disk
    // "/" admits every path on the machine.
    seedStore([{ subject: "/", scope: "project", grantedAt: 1, origin: "hostile" }]);
    expect(grantedSubjects()).toEqual([]);

    seedStore([{ subject: "/etc", scope: "project", grantedAt: 1, origin: "hostile" }]);
    expect(grantedSubjects()).toEqual([]);
  });

  it("finding 1: a forbidden subject is refused while its siblings still load", () => {
    const ok = mkdir("legit");
    seedStore([
      { subject: fs.realpathSync(ok), scope: "project", grantedAt: 2, origin: "s" },
      { subject: "/", scope: "project", grantedAt: 1, origin: "hostile" },
    ]);
    expect(grantedSubjects()).toEqual([fs.realpathSync(ok)]);
  });

  it("finding 2: an unknown store version is refused rather than misread as v1", () => {
    const dir = mkdir("v2");
    seedStore([{ subject: fs.realpathSync(dir), scope: "project", grantedAt: 1, origin: "s" }], 2);
    expect(grantedSubjects()).toEqual([]);
  });

  it("finding 3: the cap is enforced at load, not only on write", () => {
    const base = fs.realpathSync(mkdir("flood"));
    seedStore(
      Array.from({ length: GRANT_CAP_PER_SCOPE * 3 }, (_, i) => ({
        subject: path.join(base, `d${i}`),
        scope: "project",
        grantedAt: 1000 + i,
        origin: "hostile",
      })),
    );
    // Newest survive; the flood cannot grow the hot path's Set without bound.
    expect(grantedSubjects()).toHaveLength(GRANT_CAP_PER_SCOPE);
    expect(grantedSubjects()).toContain(path.join(base, `d${GRANT_CAP_PER_SCOPE * 3 - 1}`));
    expect(grantedSubjects()).not.toContain(path.join(base, "d0"));
  });

  it("finding 5: a disk-resident session grant is not resurrected", () => {
    // Session scope means "until server restart". Loading one from disk would
    // both survive the restart and be unrevocable through the scoped API.
    const dir = mkdir("ghost");
    seedStore([{ subject: fs.realpathSync(dir), scope: "session", grantedAt: 1, origin: "s" }]);
    expect(grantedSubjects()).toEqual([]);
  });

  it("finding 12: a missing origin is coerced, not left undefined", () => {
    const dir = mkdir("noorigin");
    seedStore([{ subject: fs.realpathSync(dir), scope: "project", grantedAt: 1 }]);
    expect(listGrants()[0].origin).toBe("unknown");
  });

  it("a non-finite grantedAt is dropped rather than poisoning the eviction sort", () => {
    // JSON has no NaN literal and `JSON.stringify(NaN)` emits `null` (which the
    // shape filter already rejects, so it would test nothing). `1e999` DOES parse
    // to Infinity, which passes a bare `typeof === "number"` check while breaking
    // the eviction sort — so the raw text is written deliberately.
    const dir = mkdir("nan");
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      `{"version":1,"grants":[{"subject":${JSON.stringify(fs.realpathSync(dir))},` +
        `"scope":"project","grantedAt":1e999,"origin":"s"}]}`,
      "utf8",
    );
    __resetAccessGrants();
    expect(grantedSubjects()).toEqual([]);
  });

  it("finding 4: a grant that would sort oldest is never the one evicted", () => {
    // D11 promises the caller is told when a grant did not stick. A rolled-back
    // clock (or a future-dated entry already in the file) made the NEW grant
    // sort oldest, so it was evicted before persisting while `recordGrant` still
    // returned ok:true — a UI claiming a grant that does not exist.
    const base = fs.realpathSync(mkdir("full"));
    seedStore(
      Array.from({ length: GRANT_CAP_PER_SCOPE }, (_, i) => ({
        subject: path.join(base, `e${i}`),
        scope: "project",
        grantedAt: 1000 + i,
        origin: "seed",
      })),
    );

    const fresh = mkdir("full", "fresh");
    const res = recordGrant({ subject: fresh, origin: "s", now: 1 });
    expect(res.ok).toBe(true);
    expect(grantedSubjects()).toContain(fs.realpathSync(fresh));
    expect(grantedSubjects()).toHaveLength(GRANT_CAP_PER_SCOPE);

    __resetAccessGrants();
    expect(grantedSubjects()).toContain(fs.realpathSync(fresh));
  });
});

describe("add-access-provisioning: provisioned grants and `evict:false`", () => {
  function seedFull(provisioned: (i: number) => boolean): string[] {
    const base = fs.realpathSync(mkdir("prov"));
    const subjects = Array.from({ length: GRANT_CAP_PER_SCOPE }, (_, i) => path.join(base, `p${i}`));
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        grants: subjects.map((subject, i) => ({
          subject,
          scope: "project",
          grantedAt: 1000 + i,
          origin: "seed",
          ...(provisioned(i) ? { via: "provision" } : {}),
        })),
      }),
      "utf8",
    );
    __resetAccessGrants();
    return subjects;
  }

  it("1.1 a store entry with via:'provision' round-trips through loadFromDisk", () => {
    const dir = mkdir("rt-prov");
    expect(recordGrant({ subject: dir, via: "provision", origin: "/w/app", now: 5 }).ok).toBe(true);
    __resetAccessGrants();
    const [grant] = listGrants();
    expect(grant.via).toBe("provision");
    expect(grant.origin).toBe("/w/app");
  });

  it("E18 an eviction skips provisioned grants and is logged; all-provisioned refuses", () => {
    // Oldest (index 0) is provisioned, so the oldest NON-provisioned (index 1) goes.
    const subjects = seedFull((i) => i === 0 || i > 100);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = mkdir("prov-first");
    expect(recordGrant({ subject: first, via: "prompt", now: 9_000 }).ok).toBe(true);
    const kept = grantedSubjects();
    expect(kept).toHaveLength(GRANT_CAP_PER_SCOPE);
    expect(kept).toContain(subjects[0]); // provisioned and oldest: kept
    expect(kept).not.toContain(subjects[1]); // oldest non-provisioned: evicted
    expect(kept).toContain(fs.realpathSync(first));
    const logged = warn.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.startsWith("[access-grants] evicted subject=") && l.includes(`${JSON.stringify(subjects[1])} via=none`))).toBe(true);

    // Now every grant is provisioned: a denial-path write is refused, 200 remain.
    const all = seedFull(() => true);
    const second = mkdir("prov-second");
    expect(recordGrant({ subject: second, via: "prompt", now: 9_001 })).toEqual({ ok: false, error: "capacity" });
    expect(grantedSubjects()).toHaveLength(GRANT_CAP_PER_SCOPE);
    expect(grantedSubjects()).not.toContain(fs.realpathSync(second));
    expect(grantedSubjects().sort()).toEqual([...all].sort());
  });

  it("E19 evict:false refuses at the cap with `capacity` and leaves the file unchanged", () => {
    seedFull(() => false);
    const before = fs.readFileSync(storePath, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = recordGrant({ subject: mkdir("prov-noevict"), via: "provision", evict: false, now: 9_000 });
    expect(res).toEqual({ ok: false, error: "capacity" });
    expect(fs.readFileSync(storePath, "utf8")).toBe(before);
    expect(grantedSubjects()).toHaveLength(GRANT_CAP_PER_SCOPE);
    expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes("evicted"))).toBe(false);
  });

  it("E19 evict:false is idempotent on an existing subject even at the cap", () => {
    const subjects = seedFull(() => false);
    const res = recordGrant({ subject: subjects[3], via: "provision", evict: false });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fix-file-link-editor-routing 3a: grants carry an optional access `mode`.
// Absent = read; only the exact string "write" is a write grant (fail closed).
// test-plan #S17-#S22.
// ---------------------------------------------------------------------------
describe("write-mode grants (fix-file-link-editor-routing 3a)", () => {
  function seedStore(grants: unknown[]): void {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({ version: 1, grants }), "utf8");
    __resetAccessGrants();
  }
  const entry = (subject: string, extra: Record<string, unknown> = {}) => ({
    subject: fs.realpathSync(subject),
    scope: "project",
    grantedAt: 1,
    origin: "s",
    ...extra,
  });
  const readStore = (): { version: number; grants: Array<{ subject: string; mode?: string }> } =>
    JSON.parse(fs.readFileSync(storePath, "utf8"));

  it("S17 only the exact string 'write' loads as a write entry; every other value is read", () => {
    const values: Array<[string, unknown, boolean]> = [
      ["absent", undefined, false],
      ["write", "write", true],
      ["read", "read", false],
      ["banana", "banana", false],
      ["WRITE", "WRITE", false],
      ["write-space", "write ", false],
      ["number", 1, false],
      ["null", null, false],
      ["object", {}, false],
    ];
    for (const [label, value, isWrite] of values) {
      const dir = mkdir("s17", label);
      seedStore([entry(dir, value === undefined ? {} : { mode: value })]);
      expect(grantedSubjects(), label).toEqual([fs.realpathSync(dir)]);
      expect(grantedWriteSubjects(), label).toEqual(isWrite ? [fs.realpathSync(dir)] : []);
      expect(listGrants()[0].mode === "write", label).toBe(isWrite);
    }
  });

  it("S18 a pre-change version:1 store loads as read grants and is not rewritten", () => {
    const dirs = [mkdir("s18", "a"), mkdir("s18", "b"), mkdir("s18", "c")];
    seedStore(dirs.map((d) => entry(d)));
    const before = fs.statSync(storePath);
    const bytes = fs.readFileSync(storePath, "utf8");

    expect(listGrants()).toHaveLength(3);
    expect(grantedSubjects().sort()).toEqual(dirs.map((d) => fs.realpathSync(d)).sort());
    expect(grantedWriteSubjects()).toEqual([]);

    const after = fs.statSync(storePath);
    expect(fs.readFileSync(storePath, "utf8")).toBe(bytes);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("S19 recordGrant is idempotent per (subject, scope, mode); version stays 1", () => {
    const dir = mkdir("s19");
    expect(recordGrant({ subject: dir, now: 1 }).ok).toBe(true);
    expect(recordGrant({ subject: dir, mode: "write", now: 2 }).ok).toBe(true);
    const again = recordGrant({ subject: dir, mode: "write", now: 3 });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.grant.grantedAt).toBe(2); // the existing entry, not a new one
    expect(recordGrant({ subject: dir, now: 4 }).ok).toBe(true);

    const store = readStore();
    expect(store.version).toBe(1);
    expect(store.grants).toHaveLength(2);
    expect(store.grants.map((g) => g.mode ?? "read").sort()).toEqual(["read", "write"]);
    // An explicit read request stores no `mode` key.
    expect(store.grants.find((g) => g.mode === undefined)).toBeDefined();
  });

  it("S20 the per-scope cap counts entries, not subjects", () => {
    const base = fs.realpathSync(mkdir("s20"));
    const seed = (n: number) =>
      seedStore(Array.from({ length: n }, (_, i) => ({ subject: path.join(base, `d${i}`), scope: "project", grantedAt: 1000 + i, origin: "s" })));

    // 199 entries + a write grant for a directory that already has a read entry → 200, nothing evicted.
    seed(GRANT_CAP_PER_SCOPE - 1);
    expect(recordGrant({ subject: path.join(base, "d5"), mode: "write", now: 9_000 }).ok).toBe(true);
    expect(listGrants()).toHaveLength(GRANT_CAP_PER_SCOPE);
    expect(listGrants().some((g) => g.subject === path.join(base, "d0"))).toBe(true);

    // 200 entries + the same shape → still 200, oldest-by-grantedAt evicted, new write grant present.
    seed(GRANT_CAP_PER_SCOPE);
    const res = recordGrant({ subject: path.join(base, "d5"), mode: "write", now: 9_000 });
    expect(res.ok).toBe(true);
    expect(listGrants()).toHaveLength(GRANT_CAP_PER_SCOPE);
    expect(listGrants().some((g) => g.subject === path.join(base, "d0"))).toBe(false);
    expect(grantedWriteSubjects()).toEqual([path.join(base, "d5")]);
  });

  describe("S21 per-mode revoke matrix", () => {
    const setups: Array<[string, Array<"read" | "write">]> = [
      ["read only", ["read"]],
      ["write only", ["write"]],
      ["both", ["read", "write"]],
    ];
    function setup(modes: Array<"read" | "write">, name: string): string {
      const dir = mkdir("s21", name);
      for (const m of modes) recordGrant({ subject: dir, mode: m, now: 1 });
      return dir;
    }
    const modesLeft = (): string[] => listGrants().map((g) => g.mode ?? "read").sort();

    it("undefined removes every entry for the subject", () => {
      for (const [name, modes] of setups) {
        const dir = setup(modes, `all-${name}`);
        expect(revokeGrant(dir), name).toBe(true);
        expect(listGrants().filter((g) => g.subject === fs.realpathSync(dir)), name).toEqual([]);
      }
    });

    it("'write' on both leaves the read entry (reads admitted, writes not)", () => {
      const dir = setup(["read", "write"], "w-both");
      expect(revokeGrant(dir, undefined, "write")).toBe(true);
      expect(modesLeft()).toEqual(["read"]);
      expect(grantedSubjects()).toEqual([fs.realpathSync(dir)]);
      expect(grantedWriteSubjects()).toEqual([]);
    });

    it("'read' on both leaves the write entry", () => {
      const dir = setup(["read", "write"], "r-both");
      expect(revokeGrant(dir, undefined, "read")).toBe(true);
      expect(modesLeft()).toEqual(["write"]);
      expect(grantedWriteSubjects()).toEqual([fs.realpathSync(dir)]);
    });

    it("'write' on read-only and 'read' on write-only touch nothing", () => {
      const ro = setup(["read"], "ro");
      const wo = setup(["write"], "wo");
      const bytes = fs.readFileSync(storePath, "utf8");
      expect(revokeGrant(ro, undefined, "write")).toBe(false);
      expect(revokeGrant(wo, undefined, "read")).toBe(false);
      expect(fs.readFileSync(storePath, "utf8")).toBe(bytes);
    });

    it("an unknown mode removes nothing and leaves the store unchanged", () => {
      const dir = setup(["read", "write"], "bad");
      const bytes = fs.readFileSync(storePath, "utf8");
      for (const bad of ["banana", "", 1, null, {}, "WRITE"]) {
        expect(revokeGrant(dir, undefined, bad as never), String(bad)).toBe(false);
      }
      expect(fs.readFileSync(storePath, "utf8")).toBe(bytes);
      expect(modesLeft()).toEqual(["read", "write"]);
    });

    it("a mode-scoped revoke applies to session grants too", () => {
      const dir = mkdir("s21", "session");
      recordGrant({ subject: dir, scope: "session", now: 1 });
      recordGrant({ subject: dir, scope: "session", mode: "write", now: 2 });
      expect(revokeGrant(dir, "session", "write")).toBe(true);
      expect(listGrants().map((g) => g.mode ?? "read")).toEqual(["read"]);
    });
  });

  it("S22 grantedSubjects() is the read predicate (write ⊃ read); grantedWriteSubjects() only write", () => {
    const d = mkdir("s22", "d");
    const d2 = mkdir("s22", "d2");
    recordGrant({ subject: d, now: 1 });
    recordGrant({ subject: d2, mode: "write", now: 2 });
    expect(grantedSubjects().sort()).toEqual([fs.realpathSync(d), fs.realpathSync(d2)].sort());
    expect(grantedWriteSubjects()).toEqual([fs.realpathSync(d2)]);
  });
});
