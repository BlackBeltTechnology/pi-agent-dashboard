/**
 * Windows Job Object kill-on-close smoke (task 7.4a).
 *
 * Confirms the first-line Windows guarantee: a server Electron spawns via
 * `spawnDetached({ detach: false })` lives inside Electron's Job Object
 * (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), so a FORCED kill of the Electron
 * parent (`taskkill /F`, the abnormal-termination path) cascades to the server
 * — no zombie forms on the common crash path.
 *
 * Emulates the crash by firing `taskkill /F /PID <electron-pid>` (NO `/T`, so
 * we kill ONLY the parent and prove the OS cascades to the child via the job,
 * rather than killing the tree ourselves).
 *
 * Flow (win32 only; skips elsewhere):
 *   1. require :8000 free → launch the packaged app with a throwaway HOME so it
 *      takes the launch-server arm and SPAWNS a real server (no fake attach).
 *   2. poll /api/health → read the spawned server pid.
 *   3. taskkill /F /PID <electron-pid> (no /T).
 *   4. assert the server pid dies AND :8000 frees within the timeout.
 *
 * Runs on windows-latest in ci-e2e-electron.yml (job `job-object-windows`).
 * Environment note: needs the app to boot a server on the runner; with the
 * lightweight `electron-forge package` (no bundled Node) the server runs via
 * the execpath fallback (ELECTRON_RUN_AS_NODE). A clear infra-vs-invariant
 * failure message distinguishes "server never booted" from "job cascade broke".
 *
 * See change: electron-attach-ownership-fixes.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const PORT = 8000;

function ok(msg: string): never {
  console.log(`[job-object-smoke] ${msg}`);
  process.exit(0);
}
function fail(msg: string): never {
  console.error(`[job-object-smoke] FAIL: ${msg}`);
  process.exit(1);
}
function infra(msg: string): never {
  // Distinct signal: the test could not set up (not an invariant violation).
  console.error(`[job-object-smoke] INFRA: ${msg}`);
  process.exit(1);
}

if (process.platform !== "win32") ok(`skip — win32-only (platform=${process.platform})`);

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function health(): Promise<{ pid?: number } | null> {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    return (await r.json()) as { pid?: number };
  } catch { return null; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resolveWinBinary(): string {
  const outDir = path.join(REPO_ROOT, "packages", "electron", "out");
  if (!fs.existsSync(outDir)) infra(`no packaged app at ${outDir} — run \`npm run -w packages/electron package\``);
  const appDir = fs.readdirSync(outDir).map((d) => path.join(outDir, d)).find((p) => fs.statSync(p).isDirectory());
  if (!appDir) infra(`no app dir under ${outDir}`);
  const exe = fs.readdirSync(appDir).find((d) => d.endsWith(".exe"));
  if (!exe) infra(`no .exe under ${appDir}`);
  return path.join(appDir, exe);
}

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jobobj-"));
  const dashDir = path.join(home, ".pi", "dashboard");
  fs.mkdirSync(dashDir, { recursive: true });
  fs.writeFileSync(path.join(dashDir, "config.json"), JSON.stringify({ port: PORT, piPort: PORT + 999, knownServers: [] }));
  fs.writeFileSync(path.join(dashDir, "first-run-done"), new Date().toISOString());
  return home;
}

async function main(): Promise<void> {
  if (await health()) infra(`:${PORT} already serving /api/health — need a clean port to force a spawn`);

  const binary = resolveWinBinary();
  const home = makeHome();
  const child = spawn(binary, ["--no-zombie-prompt"], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: "ignore",
    windowsHide: true,
  });
  const electronPid = child.pid;
  if (!electronPid) infra("failed to spawn the packaged app");

  // Wait for the app to spawn a server (execpath-fallback boot can be slow).
  let serverPid: number | undefined;
  const bootDeadline = Date.now() + 90_000;
  while (Date.now() < bootDeadline) {
    const h = await health();
    if (h?.pid) { serverPid = h.pid; break; }
    if (!isAlive(electronPid)) infra("app process exited before a server became healthy");
    await sleep(1000);
  }
  if (!serverPid) { try { child.kill(); } catch {} infra(`app never brought a server up on :${PORT}`); }
  console.log(`[job-object-smoke] app pid=${electronPid} spawned server pid=${serverPid}`);

  // Emulate the crash: force-kill ONLY the Electron parent. The Job Object must
  // cascade the kill to the server.
  spawnSync("taskkill", ["/F", "/PID", String(electronPid)], { encoding: "utf-8", windowsHide: true });

  const killDeadline = Date.now() + 15_000;
  while (Date.now() < killDeadline) {
    const alive = isAlive(serverPid);
    const stillServing = (await health()) !== null;
    if (!alive && !stillServing) {
      try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
      ok(`OK — taskkill /F of parent ${electronPid} cascaded to server ${serverPid} (Job Object kill-on-close fired)`);
    }
    await sleep(500);
  }

  // Cleanup + fail: the server outlived a forced parent kill → job cascade broke.
  try { spawnSync("taskkill", ["/F", "/PID", String(serverPid)], { windowsHide: true }); } catch {}
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  fail(`server ${serverPid} survived taskkill /F of parent ${electronPid} — Job Object KILL_ON_JOB_CLOSE did not fire (zombie would form)`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
