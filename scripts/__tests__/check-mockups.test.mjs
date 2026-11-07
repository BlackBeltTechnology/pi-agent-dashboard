/**
 * Mock check + this repo's mock-loop wiring (add-mock-site-exact-env test-plan
 * #E15, #E18, #E19). Drives the exported fns over a temp tree; the adoption case
 * moves a STATIC.md board with the real `mock-decide move`.
 *
 * See change: add-mock-site-exact-env.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockEntries, mockFindings } from "../check-mockups.mjs";
import { moveMockDir } from "../../packages/mockup-loop/src/mock-site/discover.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let root;
const w = (rel, body = "x") => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); return rel; };
const check = (files) => mockFindings(mockEntries(files), root);
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "check-mockups-"))); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("check-mockups (#E15)", () => {
  it("dated live mock passes", () => {
    expect(check([w("mockups/2026-12-01-live/mock.tsx")])).toEqual([]);
    expect(check([w("openspec/changes/x/mockups/2026-12-01-y/mock.tsx")])).toEqual([]);
  });
  it("static dir without STATIC.md is reported; with STATIC.md it passes", () => {
    const f = w("openspec/changes/x/mockups/2026-12-01-y/index.html");
    expect(check([f])).toEqual([{ entry: "openspec/changes/x/mockups/2026-12-01-y", reason: expect.stringContaining("not a live mock") }]);
    w("openspec/changes/x/mockups/2026-12-01-y/STATIC.md", "Exception: geometry repro.");
    expect(check([f])).toEqual([]);
    const slug = w("mockups/board/index.html");
    expect(check([slug])[0].entry).toBe("mockups/board");
  });
  it("a loose .html is always reported, with the move hint; root support files are not entries", () => {
    const r = check([w("mockups/a.html"), w("mockups/AGENTS.md"), w("mockups/mock-site.config.ts"), w("mockups/score.md")]);
    expect(r).toEqual([{ entry: "mockups/a.html", reason: expect.stringContaining("move it into a dir with STATIC.md") }]);
  });
  it("undated live mock is reported; archived changes are ignored", () => {
    expect(check([w("mockups/board/mock.tsx")])[0].reason).toContain("dated id");
    expect(check([w("openspec/changes/archive/2026-01-01-z/mockups/board/index.html")])).toEqual([]);
  });
  it("a STATIC.md board adopted into a change (mock-decide move) still passes", () => {
    w("mockups/board/index.html");
    w("mockups/board/STATIC.md", "Exception: no buildable components.");
    const r = moveMockDir(path.join(root, "mockups/board"), path.join(root, "openspec/changes/n"));
    expect(r.ok).toBe(true);
    expect(check(["openspec/changes/n/mockups/board/index.html", "openspec/changes/n/mockups/board/STATIC.md"])).toEqual([]);
  });
});

describe("repo wiring (#E18, #E19)", () => {
  it("#E18 adapter loads the workspace skill and drops loose html; root AGENTS.md routes mock work", () => {
    const adapter = fs.readFileSync(path.join(REPO, ".pi/skills/frontend-mockup-loop-dashboard/SKILL.md"), "utf8");
    expect(adapter).toContain("packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md");
    expect(adapter).not.toContain("<name>.html");
    const agents = fs.readFileSync(path.join(REPO, "AGENTS.md"), "utf8");
    expect(agents.split("\n").filter((l) => /mock/i.test(l) && l.includes("frontend-mockup-loop-dashboard"))).toHaveLength(1);
  });
  it("#E19 the mockup-loop package version is not bumped against develop", () => {
    let base;
    try { base = execFileSync("git", ["show", "origin/develop:packages/mockup-loop/package.json"], { cwd: REPO, encoding: "utf8" }); } catch { return; } // no develop ref (shallow CI clone)
    const now = JSON.parse(fs.readFileSync(path.join(REPO, "packages/mockup-loop/package.json"), "utf8"));
    expect(now.version).toBe(JSON.parse(base).version);
  });
});
