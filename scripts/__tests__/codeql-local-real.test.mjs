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
