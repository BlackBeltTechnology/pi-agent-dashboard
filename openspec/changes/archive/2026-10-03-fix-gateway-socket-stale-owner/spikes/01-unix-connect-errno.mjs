// Spike #744: what errno does a Node AF_UNIX connect() see for
//   (1) stale socket file, no listener
//   (2) LIVE listener whose accept backlog is full (listener SIGSTOPped)
//   (3) LIVE listener, healthy
import net from "node:net";
import fs from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s744-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probe(p, timeoutMs = 500) {
  return new Promise((resolve) => {
    const s = net.connect(p);
    let done = false;
    const fin = (r) => { if (!done) { done = true; resolve(r); } };
    s.setTimeout(timeoutMs, () => { fin("TIMEOUT"); });
    s.on("connect", () => fin("CONNECTED"));
    s.on("error", (e) => fin(e.code));
  });
}

async function startListener(p, backlog) {
  const child = spawn(process.execPath, ["-e", `
    const net=require('net');
    net.createServer(()=>{}).listen({path:${JSON.stringify(p)},backlog:${backlog}},()=>console.log('up'));
  `], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => child.stdout.once("data", r));
  return child;
}

const out = { platform: `${process.platform} ${os.release()} node ${process.version}` };

// (1) stale: listener SIGKILLed leaves the file behind
{
  const p = path.join(dir, "stale.sock");
  const c = await startListener(p, 511);
  c.kill("SIGKILL"); await sleep(200);
  out.stale = { fileExists: fs.existsSync(p), probe: await probe(p) };
}

// (2) live but saturated: stop the listener, then flood
{
  const p = path.join(dir, "full.sock");
  const c = await startListener(p, 1);
  process.kill(c.pid, "SIGSTOP");
  const held = [];
  const results = {};
  for (let i = 0; i < 20; i++) {
    const s = net.connect(p); held.push(s);
    const r = await new Promise((res) => {
      s.setTimeout(300, () => res("TIMEOUT"));
      s.on("connect", () => res("CONNECTED"));
      s.on("error", (e) => res(e.code));
    });
    results[r] = (results[r] ?? 0) + 1;
  }
  out.saturated = { floodOutcomes: results, probeAfterFlood: await probe(p) };
  held.forEach((s) => s.destroy());
  process.kill(c.pid, "SIGCONT"); c.kill("SIGKILL");
}

// (3) healthy
{
  const p = path.join(dir, "ok.sock");
  const c = await startListener(p, 511);
  out.healthy = { probe: await probe(p) };
  c.kill("SIGKILL");
}

// Option-B feasibility: process start time without `ps`
try {
  const stat = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const starttimeTicks = Number(fields[19]); // field 22 overall
  const btime = Number(/^btime (\d+)/m.exec(fs.readFileSync("/proc/stat", "utf8"))[1]);
  const startedAtMs = (btime + starttimeTicks / 100) * 1000;
  out.procStartTime = { startedAtMs, driftVsNowMs: Date.now() - startedAtMs, bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() };
} catch (e) { out.procStartTime = `n/a (${e.code ?? e.message})`; }
try {
  const { execFileSync } = await import("node:child_process");
  out.ps = execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim();
} catch (e) { out.ps = `n/a (${e.code})`; }

console.log(JSON.stringify(out, null, 2));
fs.rmSync(dir, { recursive: true, force: true });
