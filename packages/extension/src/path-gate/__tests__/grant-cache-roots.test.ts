import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { GrantCache } from "../grant-cache.js";
import { RootsProvider, withBound } from "../roots.js";

function tmpFile(content: string): string {
  const d = fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-grants-"));
  const f = nodePath.join(d, "access-grants.json");
  fs.writeFileSync(f, content);
  return f;
}
const store = (subjects: Array<[string, string]>) =>
  JSON.stringify({ version: 1, grants: subjects.map(([subject, scope]) => ({ subject, scope, grantedAt: 1, origin: "s" })) });

describe("GrantCache", () => {
  it("reads project-scope subjects only", () => {
    const f = tmpFile(store([["/w/other", "project"], ["/w/sess", "session"]]));
    expect(new GrantCache({ file: f }).get()).toEqual(["/w/other"]);
  });

  it("E16 revoke via file rewrite is picked up on mtime bump", () => {
    const f = tmpFile(store([["/w/other", "project"]]));
    const c = new GrantCache({ file: f });
    expect(c.get()).toEqual(["/w/other"]);
    fs.writeFileSync(f, store([]));
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(f, future, future);
    expect(c.get()).toEqual([]);
  });

  it("review B3: an atomic same-size/same-mtime rewrite that revokes a grant is still seen (inode/ctime in the signature)", () => {
    const a = store([["/w/aaaa", "project"]]);
    const b = store([["/w/bbbb", "project"]]);
    expect(a.length).toBe(b.length);
    const f = tmpFile(a);
    const pinned = new Date(1_700_000_000_000);
    fs.utimesSync(f, pinned, pinned);
    const c = new GrantCache({ file: f });
    expect(c.get()).toEqual(["/w/aaaa"]);
    // Atomic replace via rename (what the store does), same size, same recorded mtime.
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, b);
    fs.utimesSync(tmp, pinned, pinned);
    fs.renameSync(tmp, f);
    expect(c.get()).toEqual(["/w/bbbb"]);
  });

  it("E17 malformed / unknown-version / missing store → empty, no throw", () => {
    expect(new GrantCache({ file: tmpFile("{not json") }).get()).toEqual([]);
    expect(new GrantCache({ file: tmpFile(JSON.stringify({ version: 2, grants: [{ subject: "/x" }] })) }).get()).toEqual([]);
    expect(new GrantCache({ file: "/nonexistent/access-grants.json" }).get()).toEqual([]);
  });
});

describe("RootsProvider", () => {
  const res = { agentDir: "/h/.pi/agent", skillDirs: [], contextFiles: [] };
  it("E12 probe exceeding its bound falls back to cwd only", async () => {
    const p = new RootsProvider({
      getCwd: () => "/w/repo/packages/a",
      getSessionDir: () => undefined,
      getPiResources: () => res,
      probe: () => new Promise<string[]>(() => {}),
      probeBoundMs: 10,
    });
    const r = await p.roots([], true);
    expect(r.workspace).toEqual(["/w/repo/packages/a"]);
    expect(p.probeSettled).toBe(true);
  });

  it("settled probe adds the checkout root without further waiting", async () => {
    const p = new RootsProvider({
      getCwd: () => "/w/repo/packages/a",
      getSessionDir: () => "/h/.pi/agent/sessions/s",
      getPiResources: () => res,
      probe: async () => ["/w/repo"],
    });
    const r = await p.roots(["/g"], true);
    expect(r.workspace).toEqual(["/w/repo/packages/a", "/w/repo"]);
    expect(r.grants).toEqual(["/g"]);
    expect(r.readOnly).toContain("/h/.pi/agent");
    expect(r.readWrite).toContain("/h/.pi/agent/sessions/s");
  });

  it("review r4/B1: a superseded checkout probe never publishes its result for the new cwd (out-of-order resolution)", async () => {
    let cwd = "/w/a/pkg";
    const pending = new Map<string, (r: string[]) => void>();
    const p = new RootsProvider({
      getCwd: () => cwd,
      getSessionDir: () => undefined,
      getPiResources: () => res,
      probe: (c) => new Promise<string[]>((resolve) => pending.set(c, resolve)),
      probeBoundMs: 10_000,
    });
    // cwd A: probe starts and stays pending.
    p.startProbe();
    // cwd changes to B: a new probe starts; A's is now superseded.
    cwd = "/w/b/pkg";
    const rootsB = p.roots([], true, "/w/b/pkg");
    // A's probe resolves LATE, while B's is still pending — it must not leak A's checkout root.
    pending.get("/w/a/pkg")?.(["/w/a"]);
    await new Promise((r) => setTimeout(r, 0));
    const early = await p.roots([], false, "/w/b/pkg");
    expect(early.workspace).toEqual(["/w/b/pkg"]);
    // B's own probe resolves: only now does B get ITS checkout root, never A's.
    pending.get("/w/b/pkg")?.(["/w/b"]);
    const done = await rootsB;
    expect(done.workspace).toEqual(["/w/b/pkg", "/w/b"]);
    expect((await p.roots([], false, "/w/b/pkg")).workspace).toEqual(["/w/b/pkg", "/w/b"]);
  });

  it("withBound resolves the fallback on timeout and on rejection", async () => {
    expect(await withBound(new Promise<number>(() => {}), 5, 7)).toBe(7);
    expect(await withBound(Promise.reject(new Error("x")), 50, 8)).toBe(8);
  });
});
