/**
 * Contract guards for the dist-only plugin VM scripts (`qa/tests/47..51-*.sh`, shared lib
 * `qa/tests/dist-only-lib.sh`) and the packaged-Electron additions of `qa/tests/08-electron-real-launch.sh`.
 *
 * The scripts themselves need a clean VM (a real npm-global install, no monorepo root); what runs HERE is
 * everything that does not: shell syntax, runner registration, that every helper a script calls exists,
 * the SKIP-first contract, the lib's pure helpers (`jx`, `dist_digest`), and the static half of test-plan
 * #E103 (`BUNDLED_WORKSPACE_PKGS` ships `mcp-core`).
 *
 * See change: decouple-plugins-from-core (tasks 7.8, 8.103, 8.138, 8.140-8.143).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const T = (name) => join(REPO_ROOT, "qa/tests", name);
const LIB = T("dist-only-lib.sh");
const SCRIPTS = {
  "47-plugin-runtime-dist-only.sh": "E100",
  "48-plugin-serveapp-restart.sh": "E82",
  "49-plugin-global-install-dist-only.sh": "E101",
  "50-plugin-local-uninstall-dist-only.sh": "E102",
  "51-plugin-failing-server-entry-dist-only.sh": "X15",
};
const read = (p) => readFileSync(p, "utf8");

describe("dist-only plugin VM scripts: static contract", () => {
  it("every script and the lib pass `bash -n`", () => {
    for (const f of [LIB, T("08-electron-real-launch.sh"), ...Object.keys(SCRIPTS).map(T)]) {
      expect(existsSync(f), f).toBe(true);
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });

  it("run-all.sh registers every script, in numeric order", () => {
    const runAll = read(T("run-all.sh"));
    for (const name of Object.keys(SCRIPTS)) expect(runAll, name).toContain(`"${name}"`);
    const order = Object.keys(SCRIPTS).map((n) => runAll.indexOf(`"${n}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("each script sources the lib and only calls helpers the lib defines", () => {
    const lib = read(LIB);
    const defined = new Set([...lib.matchAll(/^([a-z_]+)\(\) \{/gm)].map((m) => m[1]));
    const helpers = [...defined].filter((n) => /^(do_|api|jx|health_field|plugin_row|wait_until|row_has|dist_digest)/.test(n));
    expect(helpers.length).toBeGreaterThan(10);
    for (const name of Object.keys(SCRIPTS)) {
      const src = read(T(name));
      expect(src, name).toContain('. "$HERE/dist-only-lib.sh"');
      const called = new Set([...src.matchAll(/\b(do_[a-z_]+|api_code|health_field|plugin_row|wait_until|row_has|dist_digest|jx)\b/g)].map((m) => m[1]));
      // Locally-defined helpers (e.g. `do_wait_health` in 48) are allowed.
      const local = new Set([...src.matchAll(/^([a-z_]+)\(\) \{/gm)].map((m) => m[1]));
      for (const c of called) expect(defined.has(c) || local.has(c), `${name} calls undefined ${c}`).toBe(true);
    }
  });

  it("each script names the scenario it covers (test-plan id)", () => {
    for (const [name, id] of Object.entries(SCRIPTS)) expect(read(T(name)), name).toContain(`(${id})`);
  });

  it("47 SKIPs first (exit 0) without a staged canary", () => {
    const env = { ...process.env };
    delete env.QA_CANARY_DIR;
    const r = spawnSync("bash", [T("47-plugin-runtime-dist-only.sh")], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toMatch(/^SKIP: /);
  });

  it("the fixture serveApp refusal probe is the marker, not a 404 (the SPA fallback answers 200 on a stock build)", () => {
    const src = read(T("48-plugin-serveapp-restart.sh"));
    expect(src).toContain("mount_serves()");
    expect(src).toMatch(/grep -q "\$MARKER"/);
  });
});

describe("dist-only-lib helpers", () => {
  const sh = (script, env = {}) =>
    execFileSync("bash", ["-c", `set -euo pipefail; . "${LIB}"; ${script}`], { encoding: "utf8", env: { ...process.env, ...env } });

  it("jx evaluates an expression over stdin JSON and prints '' for missing", () => {
    expect(sh(`printf '%s' '{"a":{"b":[1,2]}}' | jx 'j.a.b.length'`)).toBe("2");
    expect(sh(`printf '%s' '{"a":1}' | jx 'j.nope'`)).toBe("");
    expect(sh(`printf '%s' '{"a":{"x":1}}' | jx 'j.a'`)).toBe('{"x":1}');
  });

  it("dist_digest changes when a dist/ file's mtime changes and is stable otherwise", () => {
    const nm = mkdtempSync(join(tmpdir(), "qa-digest-"));
    const pkg = join(nm, "node_modules", "@blackbelt-technology", "pi-agent-dashboard");
    mkdirSync(join(pkg, "bin"), { recursive: true });
    mkdirSync(join(pkg, "packages", "client", "dist"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), "{}");
    writeFileSync(join(pkg, "bin", "pi-dashboard"), "#!/usr/bin/env node\n");
    const bin = join(nm, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    execFileSync("ln", ["-s", join(pkg, "bin", "pi-dashboard"), join(bin, "pi-dashboard")]);
    const asset = join(pkg, "packages", "client", "dist", "index.js");
    writeFileSync(asset, "x");
    utimesSync(asset, 1_000, 1_000);
    const a = sh("dist_digest", { BIN_DIR: bin }).trim();
    expect(sh("dist_digest", { BIN_DIR: bin }).trim()).toBe(a);
    expect(a).toMatch(/^1:[0-9a-f]{64}$/);
    utimesSync(asset, 2_000, 2_000);
    expect(sh("dist_digest", { BIN_DIR: bin }).trim()).not.toBe(a);
  });
});

describe("packaged Electron additions (test-plan #E103)", () => {
  const bundle = read(join(REPO_ROOT, "packages/electron/scripts/bundle-server.mjs"));
  const listSrc = bundle.match(/const BUNDLED_WORKSPACE_PKGS = \[([\s\S]*?)\];/)?.[1] ?? "";
  const pkgs = [...listSrc.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);

  it("BUNDLED_WORKSPACE_PKGS includes mcp-core and every entry is a real workspace package", () => {
    expect(pkgs).toContain("mcp-core");
    for (const p of pkgs) expect(existsSync(join(REPO_ROOT, "packages", p, "package.json")), p).toBe(true);
  });

  it("08-electron-real-launch.sh asserts mcp-core, the import map, /host/react.js and delivery bundled", () => {
    const src = read(T("08-electron-real-launch.sh"));
    for (const needle of ["pi-dashboard-mcp-core", '<script type="importmap"', "/host/react.js", "client.delivery:bundled"]) {
      expect(src, needle).toContain(needle);
    }
  });
});
