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

  it("withBound resolves the fallback on timeout and on rejection", async () => {
    expect(await withBound(new Promise<number>(() => {}), 5, 7)).toBe(7);
    expect(await withBound(Promise.reject(new Error("x")), 50, 8)).toBe(8);
  });
});
