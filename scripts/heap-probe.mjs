#!/usr/bin/env node
/**
 * CDP heap probe for a RUNNING pi-dashboard server.
 *
 * Ranks the live `{seq, event}` event-store buffers by estimated bytes and
 * breaks each one down per `eventType`, so the memory question ("which event
 * type is the buffer actually made of") is answered from the live heap rather
 * than inferred.
 *
 * WHY IT WORKS THE WAY IT DOES
 *  - It `SIGUSR1`s the target pid to open the V8 inspector, then attaches over
 *    CDP and uses `Runtime.queryObjects` on `Array.prototype` to enumerate live
 *    arrays. No agent, no instrumentation, no restart.
 *  - NEVER restart the server to investigate a memory question: a restart
 *    destroys exactly the evidence you came for. This script exists so the
 *    investigation is non-destructive.
 *
 * SIDE EFFECT — READ THIS: `SIGUSR1` opens the inspector on 127.0.0.1:9229 and
 * it STAYS OPEN until the next restart of that process. It is loopback-only,
 * but it is a live debug port on a long-running server. Restart the server when
 * the investigation is done.
 *
 * Usage:
 *   node scripts/heap-probe.mjs [--pid <pid>] [--port 9229] [--top 10]
 *
 * With no --pid the pid is read from `/api/health` on DASHBOARD_PORT (8000).
 *
 * See change: collapse-superseded-tool-execution-updates (task 1.2).
 */
import { setTimeout as sleep } from "node:timers/promises";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function resolvePid() {
  const explicit = arg("pid");
  if (explicit) return Number(explicit);
  const port = arg("dashboard-port", process.env.DASHBOARD_PORT ?? "8000");
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  const body = await res.json();
  if (typeof body.pid !== "number") throw new Error("/api/health returned no pid");
  return body.pid;
}

/** Resolve the inspector's WebSocket debugger URL, retrying while it opens. */
async function debuggerUrl(port) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const url = list?.[0]?.webSocketDebuggerUrl;
      if (url) return url;
    } catch {
      /* inspector not up yet */
    }
    await sleep(250);
  }
  throw new Error(`no inspector on 127.0.0.1:${port} — is the pid right?`);
}

/**
 * The expression evaluated INSIDE the target process against the queryObjects
 * result. Kept as a string (it does not close over anything here) and written
 * defensively: a probe that throws inside the target teaches nothing.
 */
const ANALYZE = `(function (arrays) {
  const out = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length < 50) continue;
    const first = arr[0];
    // Event-store buffer shape: { seq: number, event: { eventType, ... } }.
    if (!first || typeof first !== "object") continue;
    if (typeof first.seq !== "number" || !first.event) continue;
    const byType = {};
    let bytes = 0;
    // Sample rather than stringify every event: a full serialization of a fat
    // buffer is itself an OOM risk on the process under investigation.
    const step = Math.max(1, Math.floor(arr.length / 200));
    let sampled = 0;
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i]?.event?.eventType ?? "unknown";
      byType[t] = (byType[t] ?? 0) + 1;
      if (i % step === 0) {
        try { bytes += JSON.stringify(arr[i]).length; sampled++; } catch { /* cyclic */ }
      }
    }
    const avg = sampled ? bytes / sampled : 0;
    out.push({
      length: arr.length,
      avgBytesPerEvent: Math.round(avg),
      estBytes: Math.round(avg * arr.length),
      updateShare: (byType.tool_execution_update ?? 0) / arr.length,
      byType,
    });
  }
  out.sort((a, b) => b.estBytes - a.estBytes);
  return JSON.stringify(out.slice(0, ${Number(arg("top", "10"))}));
})`;

async function main() {
  const pid = await resolvePid();
  const port = Number(arg("port", "9229"));
  process.kill(pid, "SIGUSR1");
  console.error(
    `[heap-probe] SIGUSR1 → pid ${pid}; inspector 127.0.0.1:${port} stays OPEN until that process restarts.`,
  );

  const ws = new WebSocket(await debuggerUrl(port));
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send("Runtime.enable");
  const proto = await send("Runtime.evaluate", { expression: "Array.prototype" });
  const objects = await send("Runtime.queryObjects", {
    prototypeObjectId: proto.result.objectId,
  });
  const analyzed = await send("Runtime.callFunctionOn", {
    functionDeclaration: ANALYZE,
    objectId: objects.objects.objectId,
    arguments: [{ objectId: objects.objects.objectId }],
    returnByValue: true,
  });

  const report = JSON.parse(analyzed.result.value);
  for (const b of report) {
    console.log(
      `buffer len=${b.length} est=${(b.estBytes / 1e6).toFixed(1)}MB ` +
        `avg=${b.avgBytesPerEvent}B update_share=${(b.updateShare * 100).toFixed(1)}%`,
    );
    const top = Object.entries(b.byType).sort((a, c) => c[1] - a[1]).slice(0, 8);
    for (const [t, n] of top) console.log(`    ${String(n).padStart(7)}  ${t}`);
  }
  if (report.length === 0) console.log("no event-store-shaped buffers found (len ≥ 50)");
  ws.close();
}

main().catch((err) => {
  console.error(`[heap-probe] ${err.message}`);
  process.exit(1);
});
