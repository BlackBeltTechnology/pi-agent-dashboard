/**
 * L1 — mock-site pure modules: refs, discovery, decisions, adoption helpers;
 * environment inheritance, options, capture, clock, check, surroundings, host-agnostic text.
 * See change: add-live-component-mock-site (test-plan E1-E4, E14, E15, E21, E22, X4) and
 * add-mock-site-exact-env (test-plan E1, E2, E6-E10, E14, E16, X5, X6, X9; E13 + F6 in site/__tests__).
 *
 * @structural-pin host-agnostic-text: E16 greps the package's shipped text for host names; absence of text is the contract (the package must not name its host)
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseRef, refId, MOCK_ID_RE } from "../mock-site/refs.mjs";
import { discoverMocks, listAdoptable, moveMockDir } from "../mock-site/discover.mjs";
import { readDecisions, writeDecision } from "../mock-site/decisions.mjs";

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

// ---- add-mock-site-exact-env ----
import { parseRef as parse, isRingN } from "../mock-site/refs.mjs";
import { inheritAppConfig, resolveLauncher } from "../mock-site/env.mjs";
import { validateOptions } from "../mock-site/options.mjs";
import { frameworkProblem } from "../mock-site/frameworks.mjs";
import { REDACTED, redactHar, scanSecrets, run as captureRun } from "../mock-site/capture.mjs";
import { main as headlessMain, videoPath, DEFAULT_LOOPS } from "../mock-site/headless.mjs";
import { cachedChromiumBuilds, launchChromium, INSTALL_HINT } from "../mock-site/browser.mjs";
import { run as decideRun, findProjectRoot } from "../mock-site/cli.mjs";

const pkgRoot = path.resolve(__dirname, "../..");
const repo = path.resolve(pkgRoot, "../..");

describe("environment inheritance (E1, E2)", () => {
  it("keeps the build shape, drops server/build/root, resolves root-relative dirs (E1)", () => {
    const cfgFile = path.join(root, "app", "vite.config.ts");
    const { config, appRoot } = inheritAppConfig({ root: "src", publicDir: "../public", server: { port: 5173 }, build: { outDir: "dist" }, resolve: { alias: { "@x": "/abs/x" } }, define: { A: "1" } }, cfgFile);
    expect(appRoot).toBe(path.join(root, "app", "src"));
    expect(config.resolve.alias).toEqual({ "@x": "/abs/x" });
    expect(config.define).toEqual({ A: "1" });
    expect(config.publicDir).toBe(path.join(root, "app", "public"));
    expect(config.envDir).toBe(path.join(root, "app", "src"));
    for (const k of ["server", "build", "root"]) expect(k in config, k).toBe(false);
  });
  it("this repo's client config inherits publicDir = <repo>/public (E2)", () => {
    // Loading the client config regenerates this tracked file (its plugin does, as `npm run dev` does): put it back.
    const generated = path.join(repo, "packages/client/src/generated/plugin-registry.tsx");
    const before = fs.readFileSync(generated, "utf8");
    onTestFinished(() => { if (fs.readFileSync(generated, "utf8") !== before) fs.writeFileSync(generated, before); });
    const script = `import { importProjectVite, inheritAppConfig } from ${JSON.stringify(path.join(pkgRoot, "src/mock-site/env.mjs"))};
const vite = await importProjectVite(${JSON.stringify(repo)});
const file = ${JSON.stringify(path.join(repo, "packages/client/vite.config.ts"))};
const r = await vite.loadConfigFromFile({ command: "serve", mode: "development" }, file, ${JSON.stringify(path.join(repo, "packages/client"))}, "silent");
const { config } = inheritAppConfig(r.config, file);
console.log(JSON.stringify({ publicDir: config.publicDir, server: "server" in config, plugins: config.plugins.flat().length > 0, alias: Object.keys(config.resolve.alias) }));`;
    const out = execFileSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], { cwd: path.join(repo, "packages/client"), encoding: "utf8" });
    const r = JSON.parse(out.trim().split("\n").pop()!);
    expect(r.publicDir).toBe(path.join(repo, "public"));
    expect(r.server).toBe(false);
    expect(r.plugins).toBe(true);
    expect(r.alias).toContain("@blackbelt-technology/pi-dashboard-shared");
  }, 60_000);
});

describe("project root + discovery (1.5, E6)", () => {
  it("discovery never lists a mock under node_modules (E6)", () => {
    mk("node_modules/pkg/mockups/2026-01-01-x/mock.tsx");
    mk("mockups/2026-01-02-y/mock.tsx");
    expect(discoverMocks(root).mocks.map((m) => m.id)).toEqual(["2026-01-02-y"]);
    expect(discoverMocks(path.join(root, "node_modules", "pkg")).mocks).toEqual([]);
  });
  it("findProjectRoot: manifest mockSite, then a mockups/ dir, then git top level", () => {
    mk("a/package.json", JSON.stringify({ mockSite: { config: "vite.config.ts" } }));
    mk("a/b/mockups/2026-01-01-z/mock.tsx");
    mk("a/b/c/.keep", "");
    expect(findProjectRoot(path.join(root, "a/b/c"))).toBe(path.join(root, "a"));
    mk("m/mockups/2026-01-01-z/mock.tsx");
    mk("m/openspec/changes/x/mockups/2026-01-01-q/mock.tsx");
    expect(findProjectRoot(path.join(root, "m/openspec/changes/x"))).toBe(path.join(root, "m"));
    mk("g/deep/.keep", "");
    execFileSync("git", ["init", "-q"], { cwd: path.join(root, "g") });
    expect(fs.realpathSync(findProjectRoot(path.join(root, "g/deep")))).toBe(path.join(root, "g"));
  });
});

describe("reference grammar: step segment (E7, E8)", () => {
  it("parses step refs on either side; ring n in the step- space is invalid (E7)", () => {
    expect(parse("#2026-11-03-m/1/proposed/step-3")).toEqual({ id: "2026-11-03-m", frame: 1, side: "proposed", step: 3 });
    expect(parse("#2026-11-03-m/1/current/step-1")).toEqual({ id: "2026-11-03-m", frame: 1, side: "current", step: 1 });
    expect(parse("#2026-11-03-m/1/proposed/2")).toEqual({ id: "2026-11-03-m", frame: 1, side: "proposed", ring: "2" });
    expect(isRingN("step-1")).toBe(false);
    expect(isRingN("x-1")).toBe(true);
    expect(isRingN(2)).toBe(true);
  });
  it("rejects step-0 and step-x (E8)", () => {
    for (const b of ["#2026-11-03-m/1/proposed/step-0", "#2026-11-03-m/1/proposed/step-x"]) expect(() => parse(b), b).toThrow(/bad ref: step/);
  });
});

describe("mock-decide limits (E9, E10, 4.2, 4.3)", () => {
  const setup = () => { mk("mockups/2026-11-03-a/mock.tsx"); return path.join(root, "mockups/2026-11-03-a/decision.json"); };
  it("500-character note accepted, 501 refused with nothing written (E9)", () => {
    const file = setup();
    expect(decideRun(["accept", "2026-11-03-a", "n".repeat(500)], root).code).toBe(0);
    const before = fs.readFileSync(file, "utf8");
    const r = decideRun(["accept", "2026-11-03-a", "n".repeat(501)], root);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("500");
    expect(r.out.split("\n")).toHaveLength(1);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
  it("symlinked decision.json and unknown id: one-line non-zero exit, nothing written", () => {
    const file = setup();
    const outside = mk("outside.json", "X");
    fs.symlinkSync(outside, file);
    const r = decideRun(["reject", "2026-11-03-a", "why"], root);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^cannot write decision for 2026-11-03-a: refusing symlink/);
    expect(r.out.split("\n")).toHaveLength(1);
    expect(fs.readFileSync(outside, "utf8")).toBe("X");
    const u = decideRun(["accept", "2099-01-01-zz"], root);
    expect(u.code).not.toBe(0);
    expect(u.out).toContain("2099-01-01-zz");
  });
  it("legacy by:\"user\" decisions still read and count for adoption (E10)", () => {
    const file = setup();
    fs.writeFileSync(file, JSON.stringify({ status: "accepted", by: "user", at: "2026-11-01T00:00:00Z" }));
    expect(readDecisions(discoverMocks(root).mocks).decisions["2026-11-03-a"]).toMatchObject({ status: "accepted", by: "user" });
    mk("mockups/AGENTS.md", "| File | Purpose |\n|---|---|\n| `2026-11-03-a/` | x. Pending change: y |\n");
    expect(listAdoptable(root).options).toEqual([{ entry: "2026-11-03-a/", label: "2026-11-03-a/ — y (accepted)", status: "accepted" }]);
    expect(decideRun(["list"], root).out).toMatch(/^accepted 2026-11-03-a {2}by user/);
  });
});

describe("options + adapters (1.3, 1.4)", () => {
  it("rejects a plugins key: options are not a build config (E5 unit)", () => {
    expect(() => validateOptions({ plugins: [] }, "/p/mockups/mock-site.config.ts")).toThrow(/not a build config: \/p\/mockups\/mock-site.config.ts sets "plugins"/);
    expect(() => validateOptions({ nope: 1 }, "f")).toThrow(/unknown mock option "nope"/);
    expect(validateOptions({ title: "T", aliases: { "@a": "/x" }, redact: ["k"] }, "f")).toEqual({ title: "T", aliases: { "@a": "/x" }, redact: ["k"] });
    expect(validateOptions(undefined, "f")).toEqual({});
  });
  it("unknown framework names itself and the supported adapters", () => {
    expect(frameworkProblem(undefined)).toBeNull();
    expect(frameworkProblem("react")).toBeNull();
    expect(frameworkProblem("solid")).toBe('framework "solid" has no mock-site adapter (supported: react)');
  });
});

describe("mock-capture (X5, X6)", () => {
  const har = (extra: object = {}) => ({ log: { entries: [{
    _resourceType: "fetch",
    request: { method: "GET", url: "http://app.local/api/runs?token=abc123&page=2", headers: [{ name: "Authorization", value: "Bearer abcdefgh123" }, { name: "Accept", value: "*/*" }], cookies: [{ name: "session", value: "s1" }], queryString: [{ name: "token", value: "abc123" }, { name: "page", value: "2" }] },
    response: { status: 200, headers: [{ name: "set-cookie", value: "sid=1" }], cookies: [], content: { mimeType: "application/json", text: JSON.stringify({ runs: [{ id: 1, password: "x", apiSecret: "s", customField: "c" }], ...extra }) } },
  }] } });
  it("redacts headers, cookies, query, JSON keys + additions (X5)", () => {
    const out = redactHar(har(), ["customField"]);
    const e = out.log.entries[0];
    expect(e.request.headers.find((h: { name: string }) => h.name === "Authorization").value).toBe(REDACTED);
    expect(e.request.headers.find((h: { name: string }) => h.name === "Accept").value).toBe("*/*");
    expect(e.request.cookies[0].value).toBe(REDACTED);
    expect(e.request.queryString).toEqual([{ name: "token", value: REDACTED }, { name: "page", value: "2" }]);
    expect(e.request.url).not.toContain("abc123");
    expect(e.response.headers[0].value).toBe(REDACTED);
    expect(JSON.parse(e.response.content.text).runs[0]).toEqual({ id: 1, password: REDACTED, apiSecret: REDACTED, customField: REDACTED });
    expect(scanSecrets(out)).toBeNull();
  });
  it("refuses to write when a secret survives, naming the JSON path (X6)", async () => {
    const jwt = ["eyJhbGciOi", "eyJzdWIiOi", "c2lnbmF0dXJl"].join(".");
    const cases: [string, string][] = [["gh" + "p_" + "a".repeat(36), "GitHub token"], ["s" + "k-" + "b".repeat(24), "sk- key"], [jwt, "JWT"], ["AK" + "IA" + "C".repeat(16), "AWS access key"]];
    for (const [value, kind] of cases) {
      const dir = path.join(root, "m", kind.replace(/\W/g, ""));
      const r = await captureRun(["http://app.local/", dir], { cwd: root, record: async () => har({ meta: { note: value } }) });
      expect(r.code, kind).not.toBe(0);
      expect(r.out).toContain(kind);
      expect(r.out).toContain("$.meta.note");
      expect(r.out).toContain("GET http://app.local/api/runs");
      expect(fs.existsSync(path.join(dir, "fixtures.har.json")), kind).toBe(false);
    }
    // B1 (review r1): a secret under a cookie name or in the URL path the redaction list does not cover.
    for (const [where, mutate] of [
      ["request cookie prefs", (h: ReturnType<typeof har>) => { h.log.entries[0].request.cookies.push({ name: "prefs", value: jwt }); }],
      ["response cookie", (h: ReturnType<typeof har>) => { (h.log.entries[0].response.cookies as { name: string; value: string }[]).push({ name: "theme", value: jwt }); }],
      ["url", (h: ReturnType<typeof har>) => { h.log.entries[0].request.url = `http://app.local/api/${jwt}/runs`; }],
    ] as const) {
      const dir = path.join(root, "m", where.replace(/\W/g, ""));
      const h = har(); mutate(h);
      const r = await captureRun(["http://app.local/", dir], { cwd: root, record: async () => h });
      expect(r.code, where).not.toBe(0);
      expect(r.out, where).toContain(where);
      expect(fs.existsSync(path.join(dir, "fixtures.har.json")), where).toBe(false);
    }
    const bad = await captureRun(["http://app.local/", path.join(root, "bad")], { cwd: root, record: async () => ({ log: { entries: [{ _resourceType: "fetch", request: { method: "GET", url: "not a url" }, response: { status: 200, content: {} } }] } }) });
    expect(bad).toMatchObject({ code: 1, out: expect.stringMatching(/^malformed HAR: /) });
    const ok = await captureRun(["http://app.local/", path.join(root, "clean")], { cwd: root, record: async () => har() });
    expect(ok.code).toBe(0);
    const fx = JSON.parse(fs.readFileSync(path.join(root, "clean/fixtures.har.json"), "utf8"));
    expect(fx.entries[0]).toMatchObject({ method: "GET", path: "/api/runs", status: 200 });
    expect(JSON.stringify(fx)).not.toContain("abcdefgh123");
  });
});

describe("mock-check / mock-video (E14, X9)", () => {
  it("runs 3 loops by default, N when given, prints counts, exits 1 on a failed loop (E14)", async () => {
    const urls: string[] = [];
    const open = (h: { completed: number; failed: number; errors?: string[] }) => async (u: string) => { urls.push(u); return { health: h, close: async () => {} }; };
    const a = await headlessMain("check", ["#2026-11-03-a/2"], root, { open: open({ completed: 3, failed: 0 }) });
    expect(DEFAULT_LOOPS).toBe(3);
    expect(urls[0]).toContain(`?pane=${encodeURIComponent("2026-11-03-a/2/proposed")}&mkLoops=3`);
    expect(a).toEqual({ code: 0, out: "2026-11-03-a/2/proposed: completed 3, failed 0" });
    const b = await headlessMain("check", ["#2026-11-03-a/2/current", "--loops", "10"], root, { open: open({ completed: 9, failed: 1, errors: ["loop 4: Step 1/2 \"x\" failed"] }) });
    expect(urls[1]).toContain("mkLoops=10");
    expect(b.code).toBe(1);
    expect(b.out).toContain("completed 9, failed 1");
    expect((await headlessMain("check", ["#2026-11-03-a"], root)).code).toBe(2);
  });
  it("default video path is the project build cache, never a mock dir (X9)", () => {
    const p = videoPath(root, "2026-11-03-a/2/proposed");
    expect(p).toBe(path.join(root, "node_modules/.vite-mock-site/videos/2026-11-03-a-2-proposed.webm"));
    expect(p.endsWith(".webm")).toBe(true);
    expect(p).not.toContain(`${path.sep}mockups${path.sep}`);
    expect(videoPath(root, "x/1/proposed", "/tmp/o.webm")).toBe("/tmp/o.webm");
  });
});

describe("browser resolution (5.1, X7)", () => {
  const missing = Object.assign(new Error("browserType.launch: Executable doesn't exist at /c/chromium-1234/chrome"), {});
  it("falls back to cached builds newest first, naming the one used", async () => {
    const tried: string[] = [];
    const chromium = { launch: async (o: { executablePath?: string }) => { tried.push(o.executablePath ?? "pinned"); if (!o.executablePath || o.executablePath.includes("1243")) throw missing; return { b: o.executablePath }; } };
    const r = await launchChromium(chromium, {}, { builds: [{ name: "chromium-1243", exe: "/c/chromium-1243/x" }, { name: "chromium-1228", exe: "/c/chromium-1228/x" }] });
    expect(tried).toEqual(["pinned", "/c/chromium-1243/x", "/c/chromium-1228/x"]);
    expect(r.build).toBe("chromium-1228");
  });
  it("all fail: guidance names the builds tried and the generic install command (X7)", async () => {
    const chromium = { launch: async () => { throw missing; } };
    const e = await launchChromium(chromium, {}, { builds: [{ name: "chromium-1243", exe: "/x" }] }).catch((x: Error) => x);
    expect(String(e)).toContain("tried: chromium-1243");
    expect(String(e)).toContain(INSTALL_HINT);
    expect(INSTALL_HINT).toBe("npx playwright install chromium");
    expect(String(e)).not.toMatch(/dashboard/i);
  });
  it("lists only chromium-<n> dirs holding an executable, newest first", () => {
    mk("cache/chromium-1228/chrome-linux/chrome", "x");
    mk("cache/chromium-1243/chrome-linux/chrome", "x");
    mk("cache/chromium-1300/README", "x");
    mk("cache/chromium_headless_shell-1250/chrome-linux/chrome", "x");
    expect(cachedChromiumBuilds(path.join(root, "cache")).map((b) => b.name)).toEqual(["chromium-1243", "chromium-1228"]);
  });
});

describe("host-agnostic package text (E16)", () => {
  it("names no host product, host tool or host helper outside the allowed spots", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!["node_modules", "__tests__"].includes(e.name)) walk(p); continue; }
        let text = fs.readFileSync(p, "utf8");
        if (e.name === "mock-site-serve.ts") text = text.replace(/\/\*\* Ports the mock site must never take[\s\S]*?\n}\n/, ""); // forbiddenPorts(): the allowed port guard
        if (e.name === "package.json") text = text.replace(/"url": "https:\/\/github\.com\/[^"]+"/, "");
        text.split("\n").forEach((l, i) => { if (/dashboard|canvas\(|pi-dashboard-ensure/i.test(l.replace(/mk-canvas/g, ""))) hits.push(`${path.relative(pkgRoot, p)}:${i + 1}: ${l.trim().slice(0, 100)}`); });
      }
    };
    walk(pkgRoot);
    expect(hits).toEqual([]);
  });
});
