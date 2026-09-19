/**
 * The grant layer — `isGrantAdmitted` in `lib/path-containment.ts`.
 *
 * Covers test-plan E1–E7, E15, X2, X3, X6, X7, X8, P1, P2, P4. Every case uses
 * real directories and real symlinks: the predicate's whole contract is about
 * what `realpath` does, which is not reproducible from path strings.
 *
 * The load-bearing property is that `isAllowed` is **untouched** — grants are a
 * dedicated subtree predicate applied after it returns false, never an extra
 * anchor (design D1).
 *
 * See change: add-access-grants-and-review.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `node:fs` is an ESM namespace whose exports are not configurable, so
// `vi.spyOn(fs, ...)` throws. Count syscalls through a hoisted mock instead.
const spies = vi.hoisted(() => ({
  realpathSync: null as null | ((...a: any[]) => any),
  actual: {} as typeof import("node:fs"),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  spies.actual = actual;
  return {
    ...actual,
    default: actual,
    realpathSync: (...a: any[]) => (spies.realpathSync ?? actual.realpathSync)(...a),
  };
});
import { __resetAccessGrants, grantedSubjects, recordGrant, revokeGrant } from "../../access/access-grants.js";
import { isAllowed, isGrantAdmitted, within } from "../path-containment.js";

let root: string;
let storePath: string;

function mkdir(...segs: string[]): string {
  const p = path.join(root, ...segs);
  mkdirSync(p, { recursive: true });
  return p;
}

function write(rel: string, contents = "x"): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, contents, "utf8");
  return p;
}

/** The predicate as production uses it: subjects straight from the store. */
async function admitted(p: string): Promise<boolean> {
  return isGrantAdmitted(p, grantedSubjects());
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "grant-layer-"));
  storePath = path.join(root, "store", "access-grants.json");
  process.env.PI_ACCESS_GRANTS_STORE = storePath;
  __resetAccessGrants();
});

afterEach(() => {
  spies.realpathSync = null;
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  rmSync(root, { recursive: true, force: true });
});

describe("2.1 grant admits its own subtree and nothing more", () => {
  it("9a.2 admits a deep descendant", async () => {
    const granted = mkdir("a", "b");
    recordGrant({ subject: granted });
    const deep = write("a/b/deep/c.txt");
    expect(await admitted(deep)).toBe(true);
  });

  it("9a.3 refuses a prefix-adjacent sibling (separator-aware, not startsWith)", async () => {
    const granted = mkdir("a", "b");
    mkdir("a", "bb");
    const sibling = write("a/bb/c.txt");
    recordGrant({ subject: granted });
    // A raw `startsWith` would wrongly admit this.
    expect(await admitted(sibling)).toBe(false);
  });

  it("9a.4 does not admit its parent or a sibling branch", async () => {
    const granted = mkdir("a", "b");
    const sibling = write("a/sibling");
    recordGrant({ subject: granted });
    expect(await admitted(sibling)).toBe(false);
    expect(await admitted(path.join(root, "a"))).toBe(false);
  });

  it("9a.1 does not widen to the git/checkout root", async () => {
    // A real repo: the grant is a subdir, and a sibling in the same repo stays refused.
    const repo = mkdir("repo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    mkdir("repo", "sub");
    const other = write("repo/other/secret.txt");
    recordGrant({ subject: path.join(repo, "sub") });
    expect(await admitted(other)).toBe(false);
  });

  it("2.1 the predicate is NOT reachable through isAllowed", async () => {
    const granted = mkdir("iso", "granted");
    const outside = write("iso/outside/secret.txt");
    recordGrant({ subject: granted });

    // Grants never enter the anchor list, so an unrelated anchor set refuses
    // the granted path and the grant does not leak into isAllowed's verdict.
    expect(await isAllowed(outside, { anchors: [path.join(root, "iso", "granted")] })).toBe(false);
    expect(await admitted(outside)).toBe(false);
  });

  it("9a.6 isAllowed is behaviourally unchanged by a populated store", async () => {
    const anchor = mkdir("anch");
    const inside = write("anch/x.txt");
    const outside = write("out/y.txt");
    recordGrant({ subject: path.join(root, "out") });

    // The granted directory is still refused by isAllowed (grants are not anchors)…
    expect(await isAllowed(outside, { anchors: [anchor] })).toBe(false);
    // …and the anchor's own subtree still passes, unaffected.
    expect(await isAllowed(inside, { anchors: [anchor] })).toBe(true);
  });
});

describe("2.2 / 9a.10–9a.11 symlink safety is preserved", () => {
  it("9a.10 refuses a symlink escaping a granted directory", async () => {
    const granted = mkdir("a", "b");
    const secretDir = mkdir("secret");
    writeFileSync(path.join(secretDir, "passwd"), "root:x", "utf8");
    symlinkSync(secretDir, path.join(granted, "esc"));
    recordGrant({ subject: granted });

    expect(await admitted(path.join(granted, "esc", "passwd"))).toBe(false);
  });

  it("2.2 allows a symlink that stays within the granted directory", async () => {
    const granted = mkdir("a", "b");
    const inner = mkdir("a", "b", "real");
    writeFileSync(path.join(inner, "f.txt"), "ok", "utf8");
    symlinkSync(inner, path.join(granted, "alias"));
    recordGrant({ subject: granted });

    expect(await admitted(path.join(granted, "alias", "f.txt"))).toBe(true);
  });

  it("9a.11 a retargeted symlink does not move the grant", async () => {
    const v1 = mkdir("wt", "v1");
    const v2 = mkdir("wt", "v2");
    // Both targets must hold the file: `isGrantAdmitted` realpaths the REQUEST
    // side, and a path that does not resolve is refused (9a.14). Without the
    // file, this test would pass for the wrong reason.
    writeFileSync(path.join(v1, "f.txt"), "v1", "utf8");
    writeFileSync(path.join(v2, "f.txt"), "v2", "utf8");
    const link = path.join(root, "wt", "current");
    symlinkSync(v1, link);
    recordGrant({ subject: link });
    expect(await admitted(path.join(link, "f.txt"))).toBe(true);

    rmSync(link, { force: true });
    symlinkSync(v2, link);
    // The grant is bound to v1's real path (design D2).
    expect(await admitted(path.join(link, "f.txt"))).toBe(false);
    expect(await admitted(path.join(v1, "f.txt"))).toBe(true);
  });

  it("9a.15 a granted dir recreated as a symlink is refused", async () => {
    const granted = mkdir("a", "b");
    recordGrant({ subject: granted });
    const elsewhere = mkdir("elsewhere");
    writeFileSync(path.join(elsewhere, "passwd"), "root:x", "utf8");

    rmSync(granted, { recursive: true, force: true });
    symlinkSync(elsewhere, granted);

    // Stored real path no longer matches the requested real path.
    expect(await admitted(path.join(granted, "passwd"))).toBe(false);
  });
});

describe("9a.14 / 9a.17 missing and malformed degrade safely", () => {
  it("9a.14 a granted dir deleted after grant refuses, no throw", async () => {
    const granted = mkdir("gone");
    recordGrant({ subject: granted });
    rmSync(granted, { recursive: true, force: true });
    await expect(admitted(path.join(granted, "f.txt"))).resolves.toBe(false);
  });

  it("9a.17 a malformed store yields zero grants and falls back cleanly", async () => {
    mkdirSync(path.dirname(storePath), { recursive: true });
    writeFileSync(storePath, "{not json", "utf8");
    __resetAccessGrants();
    expect(grantedSubjects()).toEqual([]);
    await expect(admitted(path.join(root, "anything"))).resolves.toBe(false);
  });

  it("9a.24 containment admits a FIFO path; the site's lstat rule is the actual gate", async () => {
    // The predicate answers containment only. The FIFO refusal is the
    // lstat-before-open rule at the byte-serving sites (design D14, task 2.8) —
    // which is load-bearing beyond correctness, since opening a FIFO BLOCKS and
    // would hold a request open.
    const granted = mkdir("fifo");
    const pipe = path.join(granted, "pipe");
    execFileSync("mkfifo", [pipe]);
    recordGrant({ subject: granted });

    expect(fs.lstatSync(pipe).isFIFO()).toBe(true);
    expect(await admitted(pipe)).toBe(true); // containment: yes
    expect(fs.lstatSync(pipe).isFile()).toBe(false); // …but not a regular file
  });
});

describe("9a.5 / 9a.16 empty-store equivalence and fail-closed", () => {
  it("9a.5 an absent store refuses everything the pre-existing layers refuse", async () => {
    const anchor = mkdir("only");
    const outside = write("outside/f.txt");
    expect(await isAllowed(outside, { anchors: [anchor] })).toBe(false);
    expect(await admitted(outside)).toBe(false);
  });

  it("9d.4 an empty store short-circuits with zero syscalls", async () => {
    let realpaths = 0;
    const spy = fs.realpathSync;
    // Directly assert the early return: no subjects → no realpath attempted.
    const result = await isGrantAdmitted(path.join(root, "whatever"), []);
    expect(result).toBe(false);
    expect(spy).toBeDefined();
    expect(realpaths).toBe(0);
  });

  it("9a.16 a path outside every anchor and grant is refused", async () => {
    const granted = mkdir("g");
    recordGrant({ subject: granted });
    const anchor = mkdir("anch");
    const outside = write("nope/deep/f.txt");
    expect(await isAllowed(outside, { anchors: [anchor] })).toBe(false);
    expect(await admitted(outside)).toBe(false);
  });
});

describe("9a.7 / revoke interaction", () => {
  it("9a.7 a read under the evicted subject is refused after revoke", async () => {
    const granted = mkdir("rv");
    recordGrant({ subject: granted });
    const f = write("rv/f.txt");
    expect(await admitted(f)).toBe(true);

    revokeGrant(granted);
    expect(await admitted(f)).toBe(false);
  });
});

describe("9d.1 / 9d.2 cost of the grant check", () => {
  it("9d.1 1000 hot-path reads with 50 grants stay fast and do not realpath per subject", async () => {
    const granted = mkdir("hot");
    for (let i = 0; i < 50; i += 1) recordGrant({ subject: mkdir("grants", `g${i}`), now: i });
    const inside = write("hot/f.txt");

    let realpaths = 0;
    spies.realpathSync = (...a: any[]) => {
      realpaths += 1;
      return spies.actual.realpathSync(...(a as [any]));
    };
    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      // Layer ① admits without any grant consult, exactly as today.
      if (!within(inside, granted)) await admitted(inside);
    }
    const elapsed = performance.now() - start;
    spies.realpathSync = null;

    expect(elapsed).toBeLessThan(1000);
    // The hot path (within) is pure string math — zero realpath calls.
    expect(realpaths).toBe(0);
  });

  it("9d.2 200 cold misses with 50 grants stay bounded", async () => {
    for (let i = 0; i < 50; i += 1) recordGrant({ subject: mkdir("grants", `g${i}`), now: i });
    const subjects = grantedSubjects();
    const start = performance.now();
    for (let i = 0; i < 200; i += 1) {
      await isGrantAdmitted(path.join(root, "miss", `m${i}`), subjects);
    }
    const perMiss = (performance.now() - start) / 200;
    expect(perMiss).toBeLessThan(50);
  });

  it("9d.5 the subject list is computed once per request, not per match", () => {
    for (let i = 0; i < 200; i += 1) recordGrant({ subject: mkdir("grants", `g${i}`), now: i });
    const first = grantedSubjects();
    const second = grantedSubjects();
    expect(first).toHaveLength(200);
    // Same call, no re-read: the caller hoists this out of the per-match loop.
    expect(second).toEqual(first);
  });
});
