/**
 * L2 driver for add-windows-process-identity: runs the REAL platform helpers
 * (`probeProcessStart`, `verifyAndKillWindows`, `wslLiveness`, `verifyAndKillWsl`)
 * and the REAL session terminator against REAL Windows processes (and, when
 * `QA_WSL_DISTRO` is set, a real WSL distribution).
 *
 * Output: one JSON line per case `{ "case": "<id>", "ok": boolean, "detail": string }`.
 * The process exits 1 when any case is not ok. Driven by
 * qa/tests/53-windows-process-identity.ps1 (workflow ci-windows-process-identity.yml).
 *
 * Case ids are test-plan ids: E19 E20 E49 E50 E51 E52 E53 P1 P6 and, with WSL,
 * E55 E56 E57 E58 E59 P5.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionTerminator } from "../../../packages/server/src/spawn-process/session-terminator.ts";
import {
  probeProcessStart,
  signalZero,
  verifyAndKillWindows,
  verifyAndKillWsl,
  wslLiveness,
} from "../../../packages/shared/src/platform/process.ts";

const SYSTEM_ROOT = process.env.SystemRoot ?? "C:\\Windows";
const PS = `${SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const WSL_EXE = `${SYSTEM_ROOT}\\System32\\wsl.exe`;
const DISTRO = process.env.QA_WSL_DISTRO ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Every synchronous child call is bounded: a hung wsl.exe/powershell.exe must not freeze the watchdog. */
const SYNC_TIMEOUT_MS = 90_000;
const alive = (pid: number) => signalZero(pid) !== "esrch";

let failed = false;
function emit(id: string, ok: boolean, detail: string): void {
  if (!ok) failed = true;
  console.log(JSON.stringify({ case: id, ok, detail }));
}

/** Resolves with the first `n` whitespace-separated tokens of `child.stdout`, or rejects after `ms`. */
function tokens(child: ChildProcess, n: number, ms = 30_000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let err = "";
    child.stderr?.on("data", (d) => (err += String(d)));
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${n} token(s); got ${JSON.stringify(buf)}`)), ms);
    child.stdout?.on("data", (d) => {
      buf += String(d);
      const t = buf.trim().split(/\s+/).filter(Boolean);
      // The last token is complete only once a trailing delimiter has arrived (a pid may span chunks).
      if (/\s$/.test(buf) && t.length >= n) {
        clearTimeout(timer);
        resolve(t.slice(0, n));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited (code ${code}) before ${n} token(s); got ${JSON.stringify(buf)} stderr=${JSON.stringify(err.slice(0, 400))}`));
    });
  });
}

const kids: ChildProcess[] = [];
const NODE_IDLE = ["-e", "setInterval(()=>{},60000)"];
async function startNode(args: string[] = NODE_IDLE): Promise<ChildProcess> {
  const c = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  kids.push(c);
  await sleep(700);
  return c;
}
function ps(script: string): string {
  return execFileSync(PS, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: SYNC_TIMEOUT_MS }).trim();
}
function cimStartMs(pid: number): number {
  return Number(
    ps(`$d = (Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CreationDate; [DateTimeOffset]::new($d.ToUniversalTime()).ToUnixTimeMilliseconds()`),
  );
}
const wsl = (...a: string[]) => execFileSync(WSL_EXE, ["-d", DISTRO, "--exec", ...a], { encoding: "utf8", windowsHide: true, timeout: SYNC_TIMEOUT_MS }).trim();
const wslTry = (...a: string[]): boolean => {
  try {
    wsl(...a);
    return true;
  } catch {
    return false;
  }
};

async function windowsCases(): Promise<void> {
  // E19 / E20: the probe equals .StartTime/CIM to the ms; the creation-time boundary on a real process.
  const a = await startNode();
  const pid = a.pid as number;
  const s0 = (await probeProcessStart(pid, { kind: "host" })) as number;
  const cim = cimStartMs(pid);
  emit("E20", s0 === cim, `probe=${s0} cim=${cim}`);
  const below = await verifyAndKillWindows(pid, { maxStartMs: s0 - 1, timeoutMs: 2000 });
  emit("E19a", below === "mismatch" && alive(pid), `maxStartMs=S0-1 -> ${below}`);
  const at = await verifyAndKillWindows(pid, { maxStartMs: s0, timeoutMs: 2000 });
  await sleep(300);
  emit("E19b", at === "killed" && !alive(pid), `maxStartMs=S0 -> ${at}`);

  // E49: real tree kill (parent + child node).
  const parent = await startNode([
    "-e",
    "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},60000)",
  ]);
  const childPid = Number((await tokens(parent, 1))[0]);
  const pStart = (await probeProcessStart(parent.pid as number, { kind: "host" })) as number;
  const tree = await verifyAndKillWindows(parent.pid as number, { maxStartMs: pStart + 2000, timeoutMs: 2000 });
  await sleep(500);
  emit("E49", tree === "killed" && !alive(parent.pid as number) && !alive(childPid), `result=${tree} childPid=${childPid} childAlive=${alive(childPid)}`);

  // E50: a dead pid is `absent` by the explicit marker, and the probe is null.
  const dead = await startNode(["-e", "0"]);
  await new Promise((r) => (dead.exitCode !== null ? r(null) : dead.once("exit", r)));
  const gone = dead.pid as number;
  emit("E50", (await verifyAndKillWindows(gone, { maxStartMs: Date.now() + 2000, timeoutMs: 2000 })) === "absent" && (await probeProcessStart(gone, { kind: "host" })) === null, `pid=${gone}`);

  // E51: system / idle pids are never killed.
  const r4 = await verifyAndKillWindows(4, { maxStartMs: 0, timeoutMs: 2000 });
  const r0 = await verifyAndKillWindows(0, { maxStartMs: 0, timeoutMs: 2000 });
  const sysAlive = ps("(Get-Process -Id 4 -ErrorAction SilentlyContinue) -ne $null") === "True";
  emit("E51", ["mismatch", "error"].includes(r4) && ["mismatch", "error"].includes(r0) && sysAlive, `pid4=${r4} pid0=${r0} systemAlive=${sysAlive}`);

  // E52: a poisoned PATH / cwd cannot redirect powershell.exe — the real one still answers.
  const evil = mkdtempSync(join(tmpdir(), "evil-"));
  const target = await startNode();
  try {
    copyFileSync(process.execPath, join(evil, "powershell.exe"));
    const saved = { cwd: process.cwd(), path: process.env.PATH };
    process.chdir(evil);
    process.env.PATH = `${evil};${saved.path}`;
    const got = await probeProcessStart(target.pid as number, { kind: "host" });
    const kill = await verifyAndKillWindows(target.pid as number, { maxStartMs: 0, timeoutMs: 2000 }); // mismatch, never a kill
    process.chdir(saved.cwd);
    process.env.PATH = saved.path;
    emit("E52", got === cimStartMs(target.pid as number) && kill === "mismatch" && !existsSync(join(evil, "HIJACK.txt")), `probe=${got} kill=${kill}`);
  } finally {
    rmSync(evil, { recursive: true, force: true });
  }

  // E53 / X17: a pid whose recorded identity is OLDER than the live process is never killed.
  const victim = await startNode();
  const vStart = (await probeProcessStart(victim.pid as number, { kind: "host" })) as number;
  const record: Record<string, unknown> = { id: "s1", status: "idle", pid: victim.pid, pidRecordedAt: vStart - 60_000, pidNamespace: { platform: "win32", kind: "host", hostId: process.env.COMPUTERNAME ?? "" } };
  let helperResult = "(not called)";
  const { terminate } = createSessionTerminator({
    verifyAndKillWindows: async (p, o) => (helperResult = await verifyAndKillWindows(p, o)),
    sessionManager: { get: () => record as never, update: (_id: string, u: object) => Object.assign(record, u) },
    headlessPidRegistry: { getPid: () => undefined, killBySessionId: async () => false },
    pidContext: { platform: "win32", hostId: process.env.COMPUTERNAME ?? "" } as never,
    warn: () => {},
  });
  const res = await terminate("s1", { graceMs: 0, verifyIdentity: true });
  emit("E53", res.outcome === "refused-identity" && helperResult === "mismatch" && alive(victim.pid as number), `outcome=${res.outcome} helper=${helperResult}`);

  // P1: cold + 20 warm probes are bounded by the 10 s timeout.
  const t0 = Date.now();
  await probeProcessStart(victim.pid as number, { kind: "host" });
  const cold = Date.now() - t0;
  const warm: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = Date.now();
    await probeProcessStart(victim.pid as number, { kind: "host" });
    warm.push(Date.now() - t);
  }
  emit("P1", cold < 10_500 && Math.max(...warm) < 10_500, `cold=${cold}ms warmMax=${Math.max(...warm)}ms warmMedian=${warm.sort((x, y) => x - y)[10]}ms`);

  // P6 / W11: with the handle pinned the pid is not reused across 500 spawns after the target died.
  const arm = (pin: boolean) =>
    Number(
      ps(
        [
          "$t = Start-Process node -ArgumentList @('-e','setInterval(()=>{},60000)') -PassThru -WindowStyle Hidden",
          "$id = $t.Id; Start-Sleep -Milliseconds 500",
          "$p = Get-Process -Id $id",
          pin ? "$null = $p.Handle" : "",
          "$p.Kill(); $p.WaitForExit()",
          "$n = 0",
          "1..500 | ForEach-Object { $psi = New-Object Diagnostics.ProcessStartInfo 'cmd.exe','/c exit'; $psi.CreateNoWindow = $true; $psi.UseShellExecute = $false; $c = [Diagnostics.Process]::Start($psi); if ($c.Id -eq $id) { $n++ }; $c.WaitForExit() }",
          "$n",
        ].join("; "),
      ),
    );
  const pinned = arm(true);
  const control = arm(false);
  emit("P6", pinned === 0, `pinned reuse=${pinned} (gating); unpinned control reuse=${control} (logged, non-gating)`);
}

async function wslCases(): Promise<void> {
  // E55: probe against a real distro lands within a second of the spawn.
  const A = Date.now();
  const holder = spawn(WSL_EXE, ["-d", DISTRO, "--exec", "setsid", "-w", "sh", "-c", "echo $$; exec sleep 600"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  kids.push(holder);
  const pid = Number((await tokens(holder, 1))[0]);
  const B = Date.now();
  const probe = await probeProcessStart(pid, { kind: "wsl", distro: DISTRO });
  emit("E55", probe !== null && probe >= A - 1000 && probe <= B + 1000, `probe=${probe} A=${A} B=${B}`);

  // E58: tri-state liveness against real states.
  const live1 = await wslLiveness(pid, DISTRO);
  wslTry("kill", "-9", String(pid));
  await sleep(500);
  const live2 = await wslLiveness(pid, DISTRO);
  const live3 = await wslLiveness(pid, "NoSuchDistro");
  emit("E58", live1 === "alive" && live2 === "absent" && live3 === "unknown", `${live1}/${live2}/${live3}`);

  // E56: group-aware kill of a leader + a SIGTERM-ignoring worker (needs SIGKILL, so >= 2000 ms).
  execFileSync(WSL_EXE, ["-d", DISTRO, "--exec", "sh", "-c", "printf 'trap \"\" TERM\\nwhile :; do sleep 1; done\\n' > /tmp/qa-w.sh; printf 'echo $$\\nsh /tmp/qa-w.sh &\\necho $!\\nwait\\n' > /tmp/qa-l.sh"], { windowsHide: true, timeout: SYNC_TIMEOUT_MS });
  const lead = spawn(WSL_EXE, ["-d", DISTRO, "--exec", "setsid", "-w", "sh", "/tmp/qa-l.sh"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  kids.push(lead);
  const [L, W] = (await tokens(lead, 2)).map(Number);
  const t0 = Date.now();
  const k = await verifyAndKillWsl(L, DISTRO, { timeoutMs: 2000 });
  const elapsed = Date.now() - t0;
  const goneL = !wslTry("kill", "-0", String(L));
  const goneW = !wslTry("kill", "-0", String(W));
  emit("E56", k === "killed" && goneL && goneW && elapsed >= 2000, `result=${k} elapsed=${elapsed}ms leaderGone=${goneL} workerGone=${goneW}`);

  // E57: a WSL kill is confined to D. The kill target is a process THIS test created in D (never a
  // Windows pid number reused as a WSL pid): an age guard far above its age yields `mismatch` and
  // signals nothing; a Windows sentinel is only ever the subject of a read-only liveness call.
  const sentinel = await startNode();
  const sp = sentinel.pid as number;
  const h57 = spawn(WSL_EXE, ["-d", DISTRO, "--exec", "setsid", "-w", "sh", "-c", "echo $$; exec sleep 600"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  kids.push(h57);
  const p57 = Number((await tokens(h57, 1))[0]);
  const kr = await verifyAndKillWsl(p57, DISTRO, { minAgeMs: 3_600_000, timeoutMs: 2000 });
  const stillThere = wslTry("kill", "-0", String(p57));
  const lr = await wslLiveness(sp, DISTRO); // read-only
  wslTry("kill", "-9", String(p57));
  emit("E57", kr === "mismatch" && stillThere && ["absent", "alive"].includes(lr) && alive(sp), `kill=${kr} wslProcessSurvived=${stillThere} liveness=${lr} sentinelAlive=${alive(sp)}`);

  // E59: a restarted distro (pid gone) reads absent; nothing on Windows is signalled.
  const h2 = spawn(WSL_EXE, ["-d", DISTRO, "--exec", "setsid", "-w", "sh", "-c", "echo $$; exec sleep 600"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  kids.push(h2);
  const p2 = Number((await tokens(h2, 1))[0]);
  execFileSync(WSL_EXE, ["--terminate", DISTRO], { windowsHide: true, timeout: SYNC_TIMEOUT_MS });
  const after = await wslLiveness(p2, DISTRO);
  const killAfter = await verifyAndKillWsl(p2, DISTRO, { minAgeMs: 0, timeoutMs: 2000 });
  emit("E59", after === "absent" && killAfter === "absent", `liveness=${after} kill=${killAfter}`);

  // P5: sequential liveness calls stay under the 10 s timeout.
  const lat: number[] = [];
  const live = spawn(WSL_EXE, ["-d", DISTRO, "--exec", "setsid", "-w", "sh", "-c", "echo $$; exec sleep 600"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  kids.push(live);
  const lp = Number((await tokens(live, 1))[0]);
  for (let i = 0; i < 20; i++) {
    const t = Date.now();
    await wslLiveness(lp, DISTRO);
    lat.push(Date.now() - t);
  }
  emit("P5", Math.max(...lat) < 10_000, `max=${Math.max(...lat)}ms median=${lat.sort((x, y) => x - y)[10]}ms`);
}

// Hard watchdog: a hung case must fail the run with a verdict, never hang the CI job.
const watchdog = setTimeout(() => {
  emit("watchdog", false, "driver exceeded 15 minutes");
  process.exit(1);
}, 15 * 60_000);

async function group(id: string, run: () => Promise<void>): Promise<void> {
  console.error(`[53] ${id} group start`);
  try {
    await run();
  } catch (err) {
    emit(id, false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
  console.error(`[53] ${id} group done`);
}

try {
  if (process.platform !== "win32") throw new Error("windows-process-identity-probe runs on win32 only"); // platform-branch-ok
  await group("windows", windowsCases);
  if (DISTRO) await group("wsl", wslCases);
  else console.log(JSON.stringify({ case: "WSL", ok: true, detail: "QA_WSL_DISTRO unset: WSL cases skipped" }));
} catch (err) {
  emit("driver", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
} finally {
  for (const c of kids) {
    try {
      c.kill();
    } catch {
      /* gone */
    }
  }
}
clearTimeout(watchdog);
process.exit(failed ? 1 : 0);
