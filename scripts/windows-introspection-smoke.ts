/**
 * Windows introspection smoke (CI: _smoke.yml standalone-install-smoke-windows).
 *
 * Proves the PowerShell Get-CimInstance introspection paths work end-to-end on
 * a REAL Windows host (the stub unit tests can't), and that NO wmic /
 * "not recognized" message leaks to the probe's stderr.
 *
 * Runs the probe (`_windows-introspection-probe.ts`) in a subprocess via tsx,
 * captures its stdio, and asserts:
 *   - probe exits 0,
 *   - probe stderr carries no `wmic` / `is not recognized` signature
 *     (the exact regression a return to execSync-default-stdio would produce),
 *   - `isVirtualMachine()` returns a boolean (PowerShell Get-CimInstance path
 *     actually resolved on win32).
 *
 * Cross-platform (also passes on Linux/macOS via the /proc / ps branches). The
 * no-wmic-leak assertion is the load-bearing check. Exit 0 = pass.
 *
 * See change: replace-wmic-with-powershell.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSafeArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const probe = path.join(here, "_windows-introspection-probe.ts");

const { argv, spawnOptions } = buildSafeArgv("npx", ["tsx", probe]);
const r = spawnSync(argv[0], argv.slice(1), {
  cwd: repoRoot,
  encoding: "utf-8",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
  ...spawnOptions,
});

const out = r.stdout ?? "";
const err = r.stderr ?? "";

function fail(msg: string): never {
  console.error(`[win-introspection-smoke] FAIL: ${msg}`);
  console.error(`---- probe stdout ----\n${out}`);
  console.error(`---- probe stderr ----\n${err}`);
  process.exit(1);
}

if (r.error) fail(`could not launch probe: ${r.error.message}`);
if (r.status !== 0) fail(`probe exited ${r.status}`);
// Precise regression signature: a wmic shell-out with inherited stderr.
if (/is not recognized|\bwmic\b/i.test(err)) fail("wmic / 'not recognized' leaked into probe stderr");

const m = out.match(/RESULT=(\{.*\})/);
if (!m) fail("probe did not emit RESULT=<json>");

const res = JSON.parse(m[1]) as { platform: string; vm: unknown };
if (typeof res.vm !== "boolean") fail(`isVirtualMachine returned non-boolean: ${JSON.stringify(res.vm)}`);

console.log(
  `[win-introspection-smoke] OK — platform=${res.platform} vm=${res.vm} (no wmic leak)`,
);
