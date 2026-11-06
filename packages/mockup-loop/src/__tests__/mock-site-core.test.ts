/**
 * L1 — mock-site pure modules: refs, discovery, decisions, adoption helpers.
 * See change: add-live-component-mock-site (test-plan E1-E4, E14, E15, E21, E22, X4).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseRef, refId, MOCK_ID_RE } from "../mock-site/refs.mjs";
import { discoverMocks, listAdoptable, moveMockDir } from "../mock-site/discover.mjs";
import { readDecisions, writeDecision, validateDecideBody } from "../mock-site/decisions.mjs";

let root: string;
const mk = (rel: string, body = "export default { title: 'T', category: 'C', frames: [] };\n") => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ms-core-"))); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("parseRef (E1, E2)", () => {
  it("parses every valid form; ?pane= ignored", () => {
    expect(parseRef("2026-11-03-a")).toEqual({ id: "2026-11-03-a" });
    expect(parseRef("#2026-11-03-a")).toEqual({ id: "2026-11-03-a" });
    expect(parseRef("#2026-11-03-a/1")).toEqual({ id: "2026-11-03-a", frame: 1 });
    expect(parseRef("#2026-11-03-a/1/proposed")).toEqual({ id: "2026-11-03-a", frame: 1, side: "proposed" });
    expect(parseRef("#2026-11-03-a/1/proposed/2")).toEqual({ id: "2026-11-03-a", frame: 1, side: "proposed", ring: "2" });
    expect(parseRef("http://localhost:5299/#2026-11-03-a/1/current/x-1")).toEqual({ id: "2026-11-03-a", frame: 1, side: "current", ring: "x-1" });
    expect(parseRef("http://localhost:5299/?pane=2026-11-03-a/1/current#2026-11-03-a/2")).toEqual({ id: "2026-11-03-a", frame: 2 });
  });
  it("rejects invalid refs, naming the bad part", () => {
    const bad = ["", "http://localhost:5299/", "#2026-1-3-a", "#2026-11-03-a/0", "#2026-11-03-a/1/left", "#2026-11-03-a/1/proposed/a/b", "#2026-11-03-A"];
    for (const b of bad) expect(() => parseRef(b), b).toThrow(/ref/i);
  });
  it("refId prefixes r-", () => {
    expect(refId("2026-11-03-a/1")).toBe("r-2026-11-03-a/1");
    expect(MOCK_ID_RE.test("2026-11-03-session-pills")).toBe(true);
  });
});

describe("discoverMocks (E3, E4)", () => {
  it("finds root + change mocks newest first, excludes archive / non-mocks", () => {
    mk("mockups/2026-11-01-a/mock.tsx");
    mk("mockups/2026-11-03-b/mock.tsx");
    mk("openspec/changes/x/mockups/2026-11-02-c/mock.tsx");
    mk("openspec/changes/archive/2026-01-01-y/mockups/2026-01-01-d/mock.tsx");
    mk("mockups/notes/readme.md", "x");
    mk("mockups/attention.html", "<p>");
    const r = discoverMocks(root);
    expect(r.mocks.map((m) => m.id)).toEqual(["2026-11-03-b", "2026-11-02-c", "2026-11-01-a"]);
    expect(r.mocks[1].dir).toBe(path.join(root, "openspec/changes/x/mockups/2026-11-02-c"));
    expect(r.errors).toEqual([]);
  });
  it("reports invalid ids and duplicates without listing them", () => {
    mk("mockups/Bad_Id/mock.tsx");
    mk("mockups/2026-11-01-a/mock.tsx");
    mk("openspec/changes/x/mockups/2026-11-01-a/mock.tsx");
    const r = discoverMocks(root);
    expect(r.mocks).toEqual([]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.join("\n")).toContain(path.join("mockups", "Bad_Id"));
    expect(r.errors.join("\n")).toContain(path.join("mockups", "2026-11-01-a"));
    expect(r.errors.join("\n")).toContain(path.join("openspec", "changes", "x", "mockups", "2026-11-01-a"));
  });
});

describe("example mock outside the mock roots (fix-mock-site-ux U1)", () => {
  it("the repo's mock site never lists the package example", () => {
    const repo = path.resolve(__dirname, "../../../..");
    expect(fs.existsSync(path.join(repo, "packages/mockup-loop/examples/2026-11-03-session-pills/mock.tsx"))).toBe(true);
    expect(discoverMocks(repo).mocks.map((m) => m.id)).not.toContain("2026-11-03-session-pills");
  });
});

describe("decisions (E14, E15, X4)", () => {
  it("writes the decision shape, deletes on open, leaves no temp file", () => {
    mk("mockups/2026-11-03-a/mock.tsx");
    const [m] = discoverMocks(root).mocks;
    writeDecision(m, { status: "accepted", by: "user" });
    const file = path.join(m.dir, "decision.json");
    const a = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(a.status).toBe("accepted");
    expect(a.by).toBe("user");
    expect(Number.isNaN(Date.parse(a.at))).toBe(false);
    expect("note" in a).toBe(false);
    writeDecision(m, { status: "rejected", by: "agent", note: "n" });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ status: "rejected", by: "agent", note: "n" });
    writeDecision(m, { status: "open", by: "user" });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(m.dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
  it("treats malformed files as open with a warning", () => {
    for (const [i, body] of ["{", '{"status":"maybe"}', "[]", "<<<<<<< HEAD", '{"status":"accepted","by":"hacker","at":"2026-11-01T00:00:00Z"}', '{"status":"accepted","by":"user","note":42,"at":"2026-11-01T00:00:00Z"}', '{"status":"accepted","by":"user","at":"x"}'].entries()) mk(`mockups/2026-11-0${i + 1}-m/decision.json`, body), mk(`mockups/2026-11-0${i + 1}-m/mock.tsx`);
    const { decisions, warnings } = readDecisions(discoverMocks(root).mocks);
    expect(Object.keys(decisions)).toEqual([]);
    expect(warnings).toHaveLength(7);
    expect(warnings[0]).toContain("decision.json");
  });
  it("refuses to write through a symlink", () => {
    mk("mockups/2026-11-03-a/mock.tsx");
    const outside = mk("outside.json", "X");
    const [m] = discoverMocks(root).mocks;
    fs.symlinkSync(outside, path.join(m.dir, "decision.json"));
    expect(() => writeDecision(m, { status: "accepted", by: "user" })).toThrow(/symlink/i);
    expect(fs.readFileSync(outside, "utf8")).toBe("X");
  });
  it("survives concurrent writes with one valid result", async () => {
    mk("mockups/2026-11-03-a/mock.tsx");
    const [m] = discoverMocks(root).mocks;
    await Promise.all(Array.from({ length: 25 }, (_, i) => Promise.resolve().then(() => writeDecision(m, { status: i % 2 ? "accepted" : "rejected", by: "user" }))));
    const d = JSON.parse(fs.readFileSync(path.join(m.dir, "decision.json"), "utf8"));
    expect(["accepted", "rejected"]).toContain(d.status);
    expect(fs.readdirSync(m.dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
  it("validateDecideBody enforces id allow-list, status enum, note length", () => {
    const ids = new Set(["2026-11-03-a"]);
    expect(validateDecideBody({ id: "2026-11-03-a", status: "accepted" }, ids)).toEqual({ ok: true, id: "2026-11-03-a", status: "accepted" });
    for (const id of ["../../etc", "2026-11-03-a/../../x", "2099-01-01-unknown", ""]) expect(validateDecideBody({ id, status: "accepted" }, ids).ok).toBe(false);
    for (const status of ["ACCEPTED", "approved", undefined]) expect(validateDecideBody({ id: "2026-11-03-a", status }, ids).ok).toBe(false);
    expect(validateDecideBody({ id: "2026-11-03-a", status: "open" }, ids).ok).toBe(true);
    expect(validateDecideBody({ id: "2026-11-03-a", status: "rejected", note: "x".repeat(500) }, ids).ok).toBe(true);
    expect(validateDecideBody({ id: "2026-11-03-a", status: "rejected", note: "x".repeat(499) + "😀" }, ids).ok).toBe(true);
    expect(validateDecideBody({ id: "2026-11-03-a", status: "rejected", note: "x".repeat(500) + "😀" }, ids).ok).toBe(false);
  });
});

describe("adoption helpers (E21, E22)", () => {
  const row = (file: string) => `| \`${file}\` | Explore mock. Pending change: thing |`;
  it("listAdoptable filters + labels by decision", () => {
    for (const id of ["2026-11-01-acc", "2026-11-02-open", "2026-11-03-rej", "2026-11-04-bad"]) mk(`mockups/${id}/mock.tsx`);
    mk("mockups/2026-11-01-acc/decision.json", JSON.stringify({ status: "accepted", by: "user", at: "2026-11-01T00:00:00Z" }));
    mk("mockups/2026-11-03-rej/decision.json", JSON.stringify({ status: "rejected", by: "user", at: "2026-11-01T00:00:00Z" }));
    mk("mockups/2026-11-04-bad/decision.json", "{");
    mk("mockups/x.html", "<p>");
    mk("mockups/AGENTS.md", ["| File | Purpose |", "|---|---|", row("x.html"), row("2026-11-02-open/"), row("2026-11-03-rej/"), row("2026-11-04-bad/"), row("2026-11-01-acc/"), "| `y.html` | owned. See change: z. Pending change: q |"].join("\n"));
    const r = listAdoptable(root);
    expect(r.options.map((o: { label: string }) => o.label)).toEqual(["2026-11-01-acc/ — thing (accepted)", "x.html — thing", "2026-11-02-open/ — thing (open)", "2026-11-04-bad/ — thing (open)"]);
    expect(r.skipped).toEqual([{ entry: "2026-11-03-rej/", reason: "rejected" }]);
    expect(r.warnings.join("\n")).toContain("2026-11-04-bad");
  });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "pipe" }).toString();
  const initRepo = () => { git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t"); };
  it("moveMockDir moves tracked + untracked as a unit", () => {
    initRepo();
    mk("mockups/2026-11-03-a/mock.tsx");
    git("add", "."); git("commit", "-qm", "x");
    mk("mockups/2026-11-03-a/decision.json", "{}");
    const changeDir = path.join(root, "openspec/changes/n");
    const r = moveMockDir(path.join(root, "mockups/2026-11-03-a"), changeDir);
    expect(r.ok).toBe(true);
    const dest = path.join(changeDir, "mockups/2026-11-03-a");
    expect(fs.existsSync(path.join(dest, "mock.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "decision.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "mockups/2026-11-03-a"))).toBe(false);
    const st = git("status", "--porcelain");
    expect(st).toMatch(/openspec\/changes\/n\/mockups\/2026-11-03-a\/decision\.json/);
    expect(st).not.toMatch(/^\?\?/m);
  });
  it("moveMockDir handles fully untracked dirs and refuses existing destinations", () => {
    initRepo();
    mk("mockups/2026-11-03-a/mock.tsx");
    mk("mockups/2026-11-03-b/mock.tsx");
    mk("openspec/changes/n/mockups/2026-11-03-b/mock.tsx", "other");
    const changeDir = path.join(root, "openspec/changes/n");
    expect(moveMockDir(path.join(root, "mockups/2026-11-03-a"), changeDir).ok).toBe(true);
    expect(fs.existsSync(path.join(root, "mockups/2026-11-03-a"))).toBe(false);
    expect(git("status", "--porcelain")).toMatch(/^A\s+openspec\/changes\/n\/mockups\/2026-11-03-a\/mock\.tsx$/m);
    const r = moveMockDir(path.join(root, "mockups/2026-11-03-b"), changeDir);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(root, "mockups/2026-11-03-b/mock.tsx"))).toBe(true);
  });
});
