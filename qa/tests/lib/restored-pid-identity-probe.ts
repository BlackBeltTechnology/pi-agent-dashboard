/**
 * L2 probe for guard-restored-headless-identity: runs the REAL headless PID
 * registry (`cleanupOrphans`, `killAll`) with the REAL start-time probe against
 * a REAL decoy process seeded into a throwaway `headless-pids.json`.
 *
 * Input (env): QA_CASE = "recycled" | "genuine"
 *   recycled — the decoy starts NOW, the entry claims it was spawned 8 days ago
 *              (a pid recycled while the server was down).
 *   genuine  — the entry's `spawnedAt` is after the decoy's start (a real orphan).
 * The decoy is spawned detached (its own process group on POSIX, like a
 * headless spawn) and always killed on exit.
 * Output: one JSON line { case, decoy, platform, afterCleanup: { size, filePids },
 *   aliveAfterCleanup, aliveAfterKillAll, logs }.
 *
 * Driven by qa/tests/57-restored-pid-identity.sh and .ps1.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeadlessPidRegistry } from "../../../packages/server/src/spawn-process/headless-pid-registry.ts";
import { signalZero } from "../../../packages/shared/src/platform/process.ts";

const kase = process.env.QA_CASE ?? "recycled";
const isWin = process.platform === "win32"; // platform-branch-ok
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => signalZero(pid) !== "esrch";

const decoy = isWin
  ? spawn(process.execPath, ["-e", "setInterval(()=>{},60000)"], { detached: true, stdio: "ignore", windowsHide: true })
  : spawn("sleep", ["600"], { detached: true, stdio: "ignore" });
decoy.unref();
const pid = decoy.pid as number;
const logs: string[] = [];
const origWarn = console.warn;
console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); origWarn(...a); };

try {
  await sleep(1500); // lstart has 1 s granularity
  const spawnedAt = kase === "genuine" ? Date.now() : Date.now() - 8 * 24 * 60 * 60 * 1000;
  const pidFile = join(mkdtempSync(join(tmpdir(), "qa-restored-")), "headless-pids.json");
  writeFileSync(pidFile, JSON.stringify({ entries: [{ pid, cwd: process.cwd(), spawnedAt: new Date(spawnedAt).toISOString() }] }));

  const reg = createHeadlessPidRegistry({ pidFilePath: pidFile });
  await reg.cleanupOrphans();
  const filePids = (JSON.parse(readFileSync(pidFile, "utf8")).entries as Array<{ pid: number }>).map((e) => e.pid);
  const afterCleanup = { size: reg.size(), filePids };
  await sleep(500);
  const aliveAfterCleanup = alive(pid);

  // An unattended stop (`signal` = SIGTERM to the server): a verified pid is
  // signalled for every intent, an unverifiable / mismatched one never.
  await reg.killAll({ exitIntent: "signal" });
  await sleep(2500);
  const aliveAfterKillAll = alive(pid);
  console.log(JSON.stringify({ case: kase, decoy: pid, platform: process.platform, afterCleanup, aliveAfterCleanup, aliveAfterKillAll, logs }));
} finally {
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}
