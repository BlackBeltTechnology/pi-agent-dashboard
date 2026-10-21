/**
 * L1 coverage for the e2e harness's runtime-canary seeding (change: decouple-plugins-from-core, tasks 7.5 / 8.2).
 *
 * Two halves, both without Docker: (1) `stageRuntimeCanary` lays the plugin dirs + `auth-trust.json` out and pins the
 * hash of the STAGED copy (the server's content hasher — same bytes, same hash, never rebuilt after seeding);
 * (2) the `node -e` trust-merge program is extracted VERBATIM from `docker/test-entrypoint.sh` (same technique as
 * `e2e-trust-seed.test.mjs`) and run against the staged `auth-trust.json`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHashOf, stageRuntimeCanary } from "../stage-runtime-canary.mjs";

const ENTRYPOINT = resolve(import.meta.dirname, "..", "..", "docker", "test-entrypoint.sh");
const lines = readFileSync(ENTRYPOINT, "utf8").split("\n");
const markerLine = lines.findIndex((l) => l.includes("# canary-trust-seed"));
const openLine = lines.findIndex((l, i) => i > markerLine && /^\s*node -e '\s*$/.test(l));
const closeLine = lines.findIndex((l, i) => i > openLine && /^\s*' "\$\{PI_DIR\}\/dashboard\/config\.json" "\$\{CANARY_STAGE\}\/auth-trust\.json"/.test(l));
const program = lines.slice(openLine + 1, closeLine).join("\n");

function plugin(root, id, { server = false } = {}) {
  mkdirSync(join(root, "dist/client"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: `fx-${id}`, "pi-dashboard-plugin": { id, clientBundle: "./dist/client/index.js" } }));
  writeFileSync(join(root, "dist/client/index.js"), `export const id = ${JSON.stringify(id)};\n`);
  writeFileSync(join(root, "dist/client/lazy.js"), "export const lazy = 1;\n");
  if (server) {
    mkdirSync(join(root, "src/server"), { recursive: true });
    writeFileSync(join(root, "src/server/index.ts"), "export default async () => {};\n");
  }
}

function fixtureCanary() {
  const root = mkdtempSync(join(tmpdir(), "pi-canary-src-"));
  plugin(root, "runtime-canary", { server: true });
  for (const v of ["missing-export", "throws-in-render"]) plugin(join(root, "variants", v), `runtime-canary-${v}`);
  return root;
}

const stage = () => join(mkdtempSync(join(tmpdir(), "pi-canary-stage-")), "stage");

describe("stageRuntimeCanary", () => {
  it("trusted: stages the base canary only and pins the staged content hash", async () => {
    const canaryRoot = fixtureCanary();
    const outDir = stage();
    const res = await stageRuntimeCanary({ outDir, mode: "trusted", canaryRoot, variants: ["missing-export", "throws-in-render"] });
    expect(Object.keys(res.plugins)).toEqual(["runtime-canary"]);
    const trust = JSON.parse(readFileSync(join(outDir, "auth-trust.json"), "utf8"));
    expect(trust).toEqual([{ id: "runtime-canary", clientSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    // Same bytes in the staged copy as in the source → same hash (nothing rebuilt after hashing).
    expect(trust[0].clientSha256).toBe(await contentHashOf(join(canaryRoot, "dist/client")));
    expect(readFileSync(join(outDir, "plugins/runtime-canary/src/server/index.ts"), "utf8")).toContain("export default");
    expect(existsSync(join(outDir, "plugins/runtime-canary/intent.flag"))).toBe(false);
  });

  it("untrusted: base canary + variants copied, NO trust entry", async () => {
    const outDir = stage();
    const res = await stageRuntimeCanary({ outDir, mode: "untrusted", canaryRoot: fixtureCanary(), variants: ["missing-export", "throws-in-render"] });
    expect(Object.keys(res.plugins).sort()).toEqual(["runtime-canary", "runtime-canary-missing-export", "runtime-canary-throws-in-render"]);
    expect(JSON.parse(readFileSync(join(outDir, "auth-trust.json"), "utf8"))).toEqual([]);
    expect(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")).mode).toBe("untrusted");
    // The canary server entry's intent broadcast is armed in this mode only (F16).
    expect(existsSync(join(outDir, "plugins/runtime-canary/intent.flag"))).toBe(true);
  });

  it("refuses an unknown mode and a canary with no built client", async () => {
    await expect(stageRuntimeCanary({ outDir: stage(), mode: "wild", canaryRoot: fixtureCanary() })).rejects.toThrow(/unknown mode/);
    const empty = mkdtempSync(join(tmpdir(), "pi-canary-empty-"));
    writeFileSync(join(empty, "package.json"), JSON.stringify({ "pi-dashboard-plugin": { id: "runtime-canary" } }));
    await expect(stageRuntimeCanary({ outDir: stage(), canaryRoot: empty })).rejects.toThrow(/no content hash/);
  });
});

describe("entrypoint trust-merge program", () => {
  const run = (config, staged) => {
    const dir = mkdtempSync(join(tmpdir(), "pi-canary-cfg-"));
    const out = join(dir, "dashboard/config.json");
    const trustFile = join(dir, "auth-trust.json");
    if (config) {
      mkdirSync(join(dir, "dashboard"), { recursive: true });
      writeFileSync(out, JSON.stringify(config));
    }
    writeFileSync(trustFile, JSON.stringify(staged));
    execFileSync("node", ["-e", program, out, trustFile], { encoding: "utf8" });
    try {
      return JSON.parse(readFileSync(out, "utf8"));
    } catch {
      return null;
    }
  };
  const sha = "a".repeat(64);

  it("finds the program inside the PI_E2E_SEED block", () => {
    expect(markerLine).toBeGreaterThan(0);
    expect(program).toContain("trustedPlugins");
    const seedIf = lines.findIndex((l) => /^if \[ "\$\{PI_E2E_SEED:-\}" = "1" \]; then/.test(l));
    expect(markerLine).toBeGreaterThan(seedIf);
  });

  it("merges the pin, keeping other auth keys and other plugins' entries", () => {
    const cfg = run({ auth: { bypassUrls: ["/"], trustedPlugins: [{ id: "other", clientSha256: "b".repeat(64) }] } }, [{ id: "runtime-canary", clientSha256: sha }]);
    expect(cfg.auth.bypassUrls).toEqual(["/"]);
    expect(cfg.auth.trustedPlugins).toEqual([
      { id: "other", clientSha256: "b".repeat(64) },
      { id: "runtime-canary", clientSha256: sha },
    ]);
  });

  it("replaces a stale entry for the same id (no duplicate)", () => {
    const cfg = run({ auth: { trustedPlugins: [{ id: "runtime-canary", clientSha256: "c".repeat(64) }] } }, [{ id: "runtime-canary", clientSha256: sha }]);
    expect(cfg.auth.trustedPlugins).toEqual([{ id: "runtime-canary", clientSha256: sha }]);
  });

  it("creates config.json when absent; untrusted (empty list) writes nothing", () => {
    expect(run(null, [{ id: "runtime-canary", clientSha256: sha }]).auth.trustedPlugins).toHaveLength(1);
    expect(run({ x: 1 }, [])).toEqual({ x: 1 });
    expect(run(null, [])).toBeNull();
  });
});
