/**
 * scripts/codeql-local.mjs against the REAL CodeQL CLI on tiny temp repos
 * (test-plan #E4, #E18, #X6). Skipped when `codeql` is not on PATH or the
 * pinned query packs are not cached — CI has no CodeQL, so these run on
 * developer machines and in ship-it worktrees.
 *
 * See change: add-local-codeql-ratchet.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_PACKS } from "../codeql-local.mjs";
import { baselineOf, makeRepo, REAL_CONFIG, SCRIPT, write, writeBaselineFile } from "./fixtures/codeql-harness.mjs";

// `npm test` points HOME at an ephemeral dir; the CodeQL pack cache lives in the REAL home.
const realHome = userInfo().homedir;
const probe = spawnSync("codeql", ["version", "--format=json"], { encoding: "utf8", env: { ...process.env, HOME: realHome } });
const cliVersion = probe.status === 0 ? JSON.parse(probe.stdout).version : null;
const packsCached =
  cliVersion !== null &&
  Object.entries({
    "codeql/javascript-queries": "codeql-suites/javascript-code-scanning.qls",
    "codeql/actions-queries": "codeql-suites/actions-code-scanning.qls",
  }).every(([pack, suite]) => spawnSync("codeql", ["resolve", "queries", `${pack}@${SEED_PACKS[pack]}:${suite}`], { encoding: "utf8", env: { ...process.env, HOME: realHome } }).status === 0);

// A request-derived password reaching console.log: js/clear-text-logging in .js and .mjs alike.
const FLAGGED = 'import http from "http";\nhttp.createServer((req, res) => { const password = req.body.password; console.log("pw " + password); res.end(); });\n';
const FILLER = `// ${"unchanged trailing context ".repeat(8)}\n`;

// Mini monorepo mirroring production: a shared package exporting `./*.js` → `./src/*.ts`, and a route that
// imports the guard through the `.js` specifier. Uses the REPO'S model file (the bytes CI loads).
const MODEL_REL = ".github/codeql/extensions/cwd-guard.model.yml";
const GUARD_IMPORT = '@blackbelt-technology/pi-dashboard-shared/cwd-guard.js';
const monorepo = (route) => ({
  "package.json": '{ "name": "mini", "private": true }\n',
  "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
  "packages/shared/package.json": JSON.stringify({ name: "@blackbelt-technology/pi-dashboard-shared", type: "module", exports: { "./*.js": "./src/*.ts", "./*": "./src/*" } }),
  // Opaque bodies on purpose: `known().includes(cwd)` is itself a CodeQL sanitizing guard, which would hide the model.
  "packages/shared/src/cwd-guard.ts":
    "export function isAllowedCwd(cwd: string, known: () => string[]): boolean { return cwd.length > 0 && known().length > Date.now() % 2; }\n" +
    "export async function admitCwd(cwd: string, known: () => string[]): Promise<{ ok: boolean; cwd: string }> { return { ok: isAllowedCwd(cwd, known), cwd }; }\n",
  "packages/server/src/probe.ts": route,
  [MODEL_REL]: readFileSync(join(import.meta.dirname, "..", "..", MODEL_REL), "utf8"),
});
const GUARDED_AND_TWIN = `import Fastify from "fastify";
import fs from "node:fs";
import { isAllowedCwd } from "${GUARD_IMPORT}";
const app = Fastify();
const known = () => ["/a"];
app.get("/guarded", async (req: any) => { const c = req.query.cwd; if (isAllowedCwd(c, known)) { return fs.readFileSync(c + "/x"); } return null; });
app.get("/unguarded", async (req: any) => { const c = req.query.cwd; return fs.readFileSync(c + "/z"); });
app.listen({ port: 1 });
`;
const UNCHECKED_BARRIER = `import Fastify from "fastify";
import fs from "node:fs";
import { admitCwd } from "${GUARD_IMPORT}";
const app = Fastify();
const known = () => ["/a"];
app.get("/unchecked", async (req: any) => { const c = req.query.cwd; await admitCwd(c, known); return fs.readFileSync(c + "/x"); });
app.listen({ port: 1 });
`;
const pathInjectionLines = (out) => out.newResults.filter((r) => r.ruleId === "js/path-injection" && r.file === "packages/server/src/probe.ts").map((r) => r.startLine);
const lineOf = (text, needle) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

const realRun = (repo, args = [], env = {}) => {
  const childEnv = { ...process.env, HOME: realHome, TMPDIR: repo.tmp, ...env };
  delete childEnv.CODEQL_BIN;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo.dir, env: childEnv, encoding: "utf8", timeout: 600_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const realBaseline = (entries = []) => baselineOf(entries, { codeql: cliVersion, packs: { ...SEED_PACKS } });
const realRepo = (files) => {
  const repo = makeRepo({ files, config: readFileSync(REAL_CONFIG, "utf8") });
  writeBaselineFile(repo, realBaseline());
  return repo;
};

describe.skipIf(!packsCached)("real CodeQL CLI", () => {
  it("#E4 real exclusions apply; non-test scripts stay analyzed", () => {
    const repo = realRepo({
      "src/__tests__/a.js": FLAGGED,
      "mockups/m.js": FLAGGED,
      "scripts/x.mjs": FLAGGED,
      "scripts/__tests__/x.test.mjs": FLAGGED,
      "lib/a.js": FLAGGED,
    });
    const r = realRun(repo, ["--json"]);
    const out = JSON.parse(r.stdout);
    const files = new Set([...out.newResults].map((x) => x.file));
    expect(files).toEqual(new Set(["lib/a.js", "scripts/x.mjs"]));
  }, 600_000);

  it("#E12 spike/** excludes the root spike directory only; a nested spike/ stays analyzed", () => {
    const config = `${readFileSync(REAL_CONFIG, "utf8")}  - "spike/**"\n`;
    const repo = makeRepo({ files: { "spike/a.mjs": FLAGGED, "packages/x/spike/b.mjs": FLAGGED }, config });
    writeBaselineFile(repo, realBaseline());
    const out = JSON.parse(realRun(repo, ["--json"]).stdout);
    expect(new Set(out.newResults.map((x) => x.file))).toEqual(new Set(["packages/x/spike/b.mjs"]));
  }, 600_000);

  it("#E4 the quoted `.js` model suppresses the guarded sink and keeps the unguarded twin", () => {
    const repo = realRepo(monorepo(GUARDED_AND_TWIN));
    const out = JSON.parse(realRun(repo, ["--json"]).stdout);
    expect(out.versions.models).toMatch(/^[0-9a-f]{64}$/);
    expect(pathInjectionLines(out)).toEqual([lineOf(GUARDED_AND_TWIN, '"/z"')]);
  }, 600_000);

  it("#E5 an admitCwd result that is never branched on does not bless later sinks", () => {
    const repo = realRepo(monorepo(UNCHECKED_BARRIER));
    const out = JSON.parse(realRun(repo, ["--json"]).stdout);
    expect(pathInjectionLines(out)).toEqual([lineOf(UNCHECKED_BARRIER, "readFileSync")]);
  }, 600_000);

  // R1–R6 (codeql-file-containment-barrier D5): the shapes the containment sites ship. One analysis per
  // repo; every sink is on its own marked line. `PATH_EXPECT` is the OBSERVED outcome per shape: a shape
  // CodeQL cannot propagate is recorded as expected residue (evidence/codeql.md), never hoped silent.
  const CONTAINMENT_GUARD_IMPORT = "@blackbelt-technology/pi-dashboard-shared/containment-guard.js";
  const containmentFiles = () => {
    const probe = `import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { containmentAllows } from "${CONTAINMENT_GUARD_IMPORT}";
import { decidePassive, evaluateContainment } from "./gate.js";
import { readIt } from "./lib/sinks.js";
const app = Fastify();
const isArtifact = (p: string) => p.length > Date.now() % 7;
async function gate(rel: string) {
  const resolved = path.resolve("/base", rel);
  const d = await evaluateContainment(resolved, ["/base"]);
  if (!containmentAllows(d, resolved)) return { code: 403 as const };
  return { resolved };
}
app.get("/a", async (req: any) => { const resolved = path.resolve("/base", req.query.path); const d = await evaluateContainment(resolved, ["/base"]); if (!containmentAllows(d, resolved)) return null; return fs.readFileSync(resolved); /*A*/ });
app.get("/b", async (req: any) => { const resolved = path.resolve("/base", req.query.path); await evaluateContainment(resolved, ["/base"]); return fs.readFileSync(resolved); /*B*/ });
app.get("/c", async (req: any) => { const a = path.resolve("/base", req.query.path); const b = path.resolve("/base", req.query.other); const d = await evaluateContainment(a, ["/base"]); if (!containmentAllows(d, a)) return null; return fs.readFileSync(b); /*C*/ });
app.get("/d", async (req: any) => { const resolved = path.resolve("/base", req.query.path); const d = await evaluateContainment(resolved, ["/base"]); containmentAllows(d, resolved); return fs.readFileSync(resolved); /*D*/ });
app.get("/f", async (req: any) => { const matches: { path: string }[] = req.query.m; return Promise.all(matches.map(async (m) => { const r = path.resolve("/base", m.path); const d = await decidePassive(r, ["/base"]); if (containmentAllows(d, r)) return fs.readFileSync(r); /*F*/ return null; })); });
app.get("/g", async (req: any) => { const g = await gate(req.query.path); if ("code" in g) return null; return readIt(g.resolved); });
app.get("/h", async (req: any) => { const resolved = path.resolve("/base", req.query.path); const d = await evaluateContainment(resolved, ["/base"]); if (!(containmentAllows(d, resolved) || isArtifact(resolved))) return null; return fs.readFileSync(resolved); /*H*/ });
app.listen({ port: 1 });
`;
    const files = monorepo(probe);
    // Opaque bodies: a real `===` inside the guard would itself be a sanitizing guard and hide the model.
    files["packages/shared/src/containment-guard.ts"] =
      "export type PathDecision = { allowed: boolean; viaGrant: boolean; resolved: string };\n" +
      "export function containmentAllows(d: PathDecision, r: string): boolean { return d.allowed && r.length > d.resolved.length % 3; }\n";
    files["packages/server/src/gate.ts"] =
      `import type { PathDecision } from "${CONTAINMENT_GUARD_IMPORT}";\n` +
      "export async function evaluateContainment(resolved: string, anchors: string[]): Promise<PathDecision> { return { allowed: anchors.length > Date.now() % 2, viaGrant: false, resolved }; }\n" +
      "export async function decidePassive(resolved: string, anchors: string[]): Promise<PathDecision> { return evaluateContainment(resolved, anchors); }\n";
    files["packages/server/src/lib/sinks.ts"] = 'import fs from "node:fs";\nexport function readIt(p: string) { return fs.readFileSync(p); /*G*/ }\n';
    return { files, probe };
  };
  // Observed shape outcomes (true = still reported), CodeQL 2.27.2 / javascript-queries 2.4.7.
  // A guarded: silent. B unguarded, C predicate on A but sink on B, D result never branched on: reported.
  // F (filter shape, #R3) and G (guarded value returned from a helper, read in another module, #R4): silent.
  // H (#R5, `containmentAllows(..) || <unmodelled admission>`): reported, so the raw site's artifact-root branch
  // stays residue. Update only from a real run, with the reason in evidence/codeql.md.
  const PATH_EXPECT = { A: false, B: true, C: true, D: true, F: false, G: false, H: true };
  const reportedMarkers = (out, probe) => {
    const hits = new Set(out.newResults.filter((r) => r.ruleId === "js/path-injection").map((r) => `${r.file}:${r.startLine}`));
    const at = (file, text, m) => hits.has(`${file}:${lineOf(text, `/*${m}*/`)}`);
    const sinks = 'import fs from "node:fs";\nexport function readIt(p: string) { return fs.readFileSync(p); /*G*/ }\n';
    const r = {};
    for (const m of "ABCDFH") r[m] = at("packages/server/src/probe.ts", probe, m);
    r.G = at("packages/server/src/lib/sinks.ts", sinks, "G");
    return r;
  };

  it("#R1 #R2 #R3 #R4 #R5 containmentAllows model: guarded silent, twins reported, shapes measured", () => {
    const { files, probe } = containmentFiles();
    const out = JSON.parse(realRun(realRepo(files), ["--json"]).stdout);
    const got = reportedMarkers(out, probe);
    // eslint-disable-next-line no-console
    console.log(`#R observed ${JSON.stringify(got)}`);
    for (const [m, want] of Object.entries(PATH_EXPECT)) expect({ m, reported: got[m] }).toEqual({ m, reported: want });
  }, 600_000);

  it("#R6 without the model file the guarded read IS reported (R1 depends on the model)", () => {
    const { files, probe } = containmentFiles();
    delete files[MODEL_REL];
    const out = JSON.parse(realRun(realRepo(files), ["--json"]).stdout);
    expect(reportedMarkers(out, probe).A).toBe(true);
  }, 600_000);

  // #E16 (design D0): the guard SHAPES the git/openspec routes ship. Every sink is its own function in a
  // separate lib module (a shared sink line would report for the twin and hide the guarded result).
  it("#E16 the shipped admission shapes are recognised; every unguarded twin is reported", () => {
    const sinks = `import fs from "node:fs";
import path from "node:path";
export function rawGuarded(cwd: string) { return fs.readFileSync(cwd + "/rawGuarded"); }
export function rawTwin(cwd: string) { return fs.readFileSync(cwd + "/rawTwin"); }
export function canonGuarded(cwd: string) { return fs.readFileSync(cwd + "/canonGuarded"); }
export function tasksGuarded(cwd: string, change: string) { return fs.readFileSync(path.join(cwd, "openspec", "changes", change, "tasksGuarded.md")); }
export function tasksTwin(cwd: string, change: string) { return fs.readFileSync(path.join(cwd, "openspec", "changes", change, "tasksTwin.md")); }
export function helperGuarded(cwd: string) { return fs.readFileSync(cwd + "/helperGuarded"); }
export function helperTwin(cwd: string) { return fs.readFileSync(cwd + "/helperTwin"); }
export function admittedRawHelper(cwd: string) { return fs.readFileSync(cwd + "/admittedRawHelper"); }
`;
    const route = `import Fastify from "fastify";
import { admissionAllows, releaseAdmission } from "${GUARD_IMPORT}";
import { isPortableProjectName } from "@blackbelt-technology/pi-dashboard-shared/project-name.js";
import { admitRouteCwd } from "./lib/route-admission.js";
import { admittedRawHelper, canonGuarded, helperGuarded, helperTwin, rawGuarded, rawTwin, tasksGuarded, tasksTwin } from "./lib/sinks.js";
const app = Fastify();
// (a) route shape: admit, branch on admissionAllows(adm, cwd) in the handler, sinks on cwd and on token.canonCwd
app.get("/a-guarded", async (req: any) => {
  const cwd = req.query.cwd;
  const adm = await admitRouteCwd(cwd);
  if (adm.kind !== "admit" || !admissionAllows(adm, cwd)) return null;
  try { rawGuarded(cwd); canonGuarded(adm.token.canonCwd); return 1; } finally { releaseAdmission(adm.token); }
});
app.get("/a-twin", async (req: any) => { const cwd = req.query.cwd; return rawTwin(cwd); });
// (b) segment shape: cwd guarded by admission, request segment guarded by isPortableProjectName
app.get("/b-guarded", async (req: any) => {
  const cwd = req.query.cwd; const change = req.query.change;
  const adm = await admitRouteCwd(cwd);
  if (adm.kind !== "admit" || !admissionAllows(adm, cwd)) return null;
  if (!isPortableProjectName(change)) return null;
  return tasksGuarded(cwd, change);
});
app.get("/b-twin", async (req: any) => {
  const cwd = req.query.cwd; const change = req.query.change;
  const adm = await admitRouteCwd(cwd);
  if (adm.kind !== "admit" || !admissionAllows(adm, cwd)) return null;
  return tasksTwin(cwd, change);
});
// (c) helper shape: the guard runs in a helper returning { ok, cwd: token.canonCwd }; the sink is in the caller
async function validateCwd(raw: string | undefined) {
  if (!raw) return { ok: false as const };
  const adm = await admitRouteCwd(raw);
  if (adm.kind !== "admit" || !admissionAllows(adm, raw)) return { ok: false as const };
  return { ok: true as const, cwd: adm.token.canonCwd, admission: adm };
}
async function validateRaw(raw: string | undefined) {
  if (!raw) return { ok: false as const };
  const adm = await admitRouteCwd(raw);
  if (adm.kind !== "admit" || !admissionAllows(adm, raw)) return { ok: false as const };
  return { ok: true as const, cwd: raw, admission: adm };
}
app.get("/c-guarded", async (req: any) => {
  const v = await validateCwd(req.query.cwd);
  if (!v.ok) return null;
  try { return helperGuarded(v.cwd); } finally { releaseAdmission(v.admission.token); }
});
app.get("/c-twin", async (req: any) => { return helperTwin(req.query.cwd); });
// (c') the helper hands back the guarded RAW value (the openspec sites keep the raw cwd)
app.get("/c-raw", async (req: any) => {
  const v = await validateRaw(req.query.cwd);
  if (!v.ok) return null;
  return admittedRawHelper(v.cwd);
});
app.listen({ port: 1 });
`;
    const files = monorepo(route);
    files["packages/shared/src/cwd-guard.ts"] =
      "export type Admission = { kind: \"admit\"; token: { canonCwd: string; rawCwd: string } } | { kind: \"refuse\" };\n" +
      "export async function admitCwd(cwd: string, known: () => string[]): Promise<Admission> { return known().length > Date.now() % 2 ? { kind: \"admit\", token: { canonCwd: cwd.trim(), rawCwd: cwd } } : { kind: \"refuse\" }; }\n" +
      "export function admissionAllows(adm: Admission, cwd: string | undefined): cwd is string { return adm.kind === \"admit\" && cwd !== undefined && cwd.length > Date.now() % 3; }\n" +
      "export function releaseAdmission(token: { canonCwd: string }): void { void token.canonCwd.length; }\n";
    files["packages/shared/src/project-name.ts"] = "export function isPortableProjectName(name: string): boolean { return name.length > Date.now() % 3; }\n";
    files["packages/server/src/lib/route-admission.ts"] =
      `import { admitCwd } from "${GUARD_IMPORT}";\nexport async function admitRouteCwd(cwd: string) { return admitCwd(cwd, () => ["/a"]); }\n`;
    files["packages/server/src/lib/sinks.ts"] = sinks;
    const repo = realRepo(files);
    const out = JSON.parse(realRun(repo, ["--json"]).stdout);
    const hits = new Set(
      out.newResults.filter((r) => r.ruleId === "js/path-injection" && r.file === "packages/server/src/lib/sinks.ts").map((r) => r.startLine),
    );
    const line = (needle) => lineOf(sinks, needle);
    const table = {
      "(a) rawGuarded": [line("rawGuarded\"") , false],
      "(a) rawTwin": [line("rawTwin\""), true],
      "(a) canonGuarded": [line("canonGuarded\""), false],
      "(b) tasksGuarded": [line("tasksGuarded.md"), false],
      "(b) tasksTwin": [line("tasksTwin.md"), true],
      "(c) helperGuarded": [line("helperGuarded\""), false],
      "(c) helperTwin": [line("helperTwin\""), true],
      "(c') admittedRawHelper": [line("admittedRawHelper\""), false],
    };
    // eslint-disable-next-line no-console
    console.log(`#E16 versions ${JSON.stringify(out.versions)}\n${Object.entries(table).map(([k, [l, reported]]) => `${k} L${l} reported=${hits.has(l)} (want ${reported})`).join("\n")}`);
    for (const [name, [l, want]] of Object.entries(table)) expect({ name, reported: hits.has(l) }).toEqual({ name, reported: want });
  }, 600_000);

  it("#E18 code inserted above a baselined result keeps its key", () => {
    const repo = realRepo({ "lib/a.js": `${FLAGGED}${FILLER}` });
    unlinkSync(join(repo.dir, "codeql-baseline.json")); // --write-baseline seeds its own
    expect(realRun(repo, ["--write-baseline"]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(repo.dir, "codeql-baseline.json"), "utf8")).entries).toHaveLength(1);
    write(repo.dir, "lib/a.js", `// inserted\nfunction added() { return 1; }\n${FLAGGED}${FILLER}`);
    const second = realRun(repo, []);
    expect(second.status, second.stderr).toBe(0);
  }, 600_000);

  const emptyRepo = () => realRepo({ "lib/a.js": "export const x = 1;\n" });
  const blackhole = { HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" };

  it("#X6 (a) cached packs analyse offline", () => {
    const r = realRun(emptyRepo(), [], blackhole);
    expect([0, 1], r.stderr).toContain(r.status);
    expect(r.stderr).not.toContain("CODEQL SKIPPED");
  }, 600_000);

  it("#X6 (b) uncached packs skip loudly within 150 s", () => {
    const started = Date.now();
    const r = realRun(emptyRepo(), [], { ...blackhole, HOME: mkdtempSync(join(tmpdir(), "codeql-home-")) });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^CODEQL SKIPPED:/m);
    expect(Date.now() - started).toBeLessThan(150_000);
  }, 200_000);
});
