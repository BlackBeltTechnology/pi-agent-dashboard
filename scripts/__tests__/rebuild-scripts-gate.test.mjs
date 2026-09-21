/**
 * Rebuild-script coherence gate — folds test-plan scenario X5.
 *
 * Both rebuild entry points MUST run the served-client verification between the
 * build and the restart, so `set -euo pipefail` aborts BEFORE any server restart
 * or bridge reload. The sync's own refusal is simulated by a `node` stub (the
 * real checkout's served destination IS the workspace build output, so a real
 * run would no-op and then restart the live server — which this test must never
 * do).
 *
 * See change: add-served-build-coherence-and-hash-parity (design D5).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = ["scripts/rebuild-restart.sh", "scripts/rebuild-and-restart.sh"];

const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Install recording stubs for `npm` (no-op) and `pi-dashboard` (records), plus a
 * `node` stub that refuses when asked to run the sync step.
 */
function makeStubPath() {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebuild-gate-"));
  const recorder = path.join(stubDir, "calls.log");
  fs.writeFileSync(recorder, "", "utf-8");
  dirs.push(stubDir);

  const npmStub = path.join(stubDir, "npm");
  fs.writeFileSync(npmStub, `#!/usr/bin/env bash\necho "npm $*" >> "${recorder}"\nexit 0\n`, "utf-8");
  fs.chmodSync(npmStub, 0o755);

  const pdStub = path.join(stubDir, "pi-dashboard");
  fs.writeFileSync(
    pdStub,
    `#!/usr/bin/env bash\necho "pi-dashboard $*" >> "${recorder}"\nexit 0\n`,
    "utf-8",
  );
  fs.chmodSync(pdStub, 0o755);

  const nodeStub = path.join(stubDir, "node");
  fs.writeFileSync(
    nodeStub,
    `#!/usr/bin/env bash\n` +
      `case "$*" in\n` +
      `  *sync-served-client.mjs*) echo "[stub] served client is incoherent — refusing" >&2; exit 1 ;;\n` +
      `esac\n` +
      `exec "${process.execPath}" "$@"\n`,
    "utf-8",
  );
  fs.chmodSync(nodeStub, 0o755);

  return { stubDir, recorder };
}

describe("rebuild scripts abort before restart on an incoherent served client (X5)", () => {
  it.each(scripts)("%s exits non-zero without restarting or reloading", (script) => {
    const { stubDir, recorder } = makeStubPath();

    const result = spawnSync("bash", [script], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH}` },
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);

    const calls = fs.readFileSync(recorder, "utf-8");
    // The restart/reload steps were never reached.
    expect(calls).not.toContain("pi-dashboard");
    expect(calls).not.toMatch(/npm run (reload|restart)/);
    // The build ran before the gate (the gate is not skipped, it aborts after).
    expect(calls).toContain("npm run build");
  });
});
