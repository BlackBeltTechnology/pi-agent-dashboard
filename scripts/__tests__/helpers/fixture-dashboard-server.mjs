#!/usr/bin/env node
/**
 * Standalone fixture HTTP server for the ensure-dashboard.sh tests. Runs as its
 * own process so the test (which waits on a child via async spawn) and the stub
 * launchers (which background it) share one implementation.
 *
 *   --mode dashboard|wrong-pid|no-pid|recovery|foreign-html|hung
 *   --port N            (default 0 = ephemeral)
 *   --delay-ms N        wait before binding (a refused port until then)
 *   --pid N             pid reported by /api/health (default: this process)
 *   --write-meta FILE   write lock metadata (pid = reported pid) just before listening
 *   --write-pidfile FILE  write server.pid just before listening
 *   --track DIR         write <pid>.pid there so the test can reap this process
 *
 * Prints one JSON line `{"port":N,"pid":N}` once listening. Exits after 5 min.
 *
 * See change: add-claude-code-plugin (test-plan "Harness conventions").
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : fallback;
};

const mode = opt("--mode", "dashboard");
const wantedPort = Number(opt("--port", "0"));
const delayMs = Number(opt("--delay-ms", "0"));
const reportedPid = Number(opt("--pid", String(process.pid)));
const metaFile = opt("--write-meta");
const pidFile = opt("--write-pidfile");
const trackDir = opt("--track");

if (trackDir) {
  fs.mkdirSync(trackDir, { recursive: true });
  fs.writeFileSync(path.join(trackDir, `${process.pid}.pid`), String(process.pid));
}
setTimeout(() => process.exit(0), 5 * 60 * 1000).unref();

const WRONG_PID = 4242424;

function handler(req, res) {
  if (!req.url.startsWith("/api/health")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
    return;
  }
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(body);
  };
  switch (mode) {
    case "dashboard":
      return json(200, JSON.stringify({ ok: true, pid: reportedPid, uptime: 1 }));
    case "wrong-pid":
      return json(200, JSON.stringify({ ok: true, pid: WRONG_PID, uptime: 1 }));
    case "no-pid":
      return json(200, '{"ok":true}');
    case "recovery":
      return json(503, '{"ok":false,"mode":"recovery","reason":"fixture"}');
    case "foreign-html":
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><body>hello</body></html>");
    default:
      return json(500, "{}");
  }
}

function listen() {
  const server =
    mode === "hung"
      ? net.createServer(() => {
          /* accept, never reply */
        })
      : http.createServer(handler);
  server.listen(wantedPort, "127.0.0.1", () => {
    const port = server.address().port;
    console.log(JSON.stringify({ port, pid: process.pid }));
  });
}

setTimeout(() => {
  if (metaFile) {
    fs.mkdirSync(path.dirname(metaFile), { recursive: true });
    fs.writeFileSync(
      metaFile,
      JSON.stringify({
        pid: reportedPid,
        ppid: 1,
        httpPort: wantedPort,
        piPort: wantedPort + 1,
        startedAt: Date.now(),
        identity: "fixture",
        version: "0.0.0",
        url: `http://localhost:${wantedPort}`,
        hostname: "fixture",
      }),
    );
  }
  if (pidFile) fs.writeFileSync(pidFile, `${reportedPid}\n`);
  listen();
}, delayMs);
