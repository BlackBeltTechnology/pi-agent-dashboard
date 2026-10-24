/**
 * Behaviour tests for the Claude plugin's watcher `watch-events.sh`: the real
 * script (`sh`) against an in-process SSE fixture server.
 *
 * See change: add-agent-event-stream.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(REPO_ROOT, "packages/claude-plugin/skills/pi-dashboard-watch/scripts/watch-events.sh");

const servers = [];
const children = [];
const tmpDirs = [];
afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Fixture server; `handler(req, res, n)` gets the 1-based connection number. Returns `{base, requests}`. */
async function fixture(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    handler(req, res, requests.length);
  });
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, requests };
}

const sseHead = (res) => res.writeHead(200, { "Content-Type": "text/event-stream" });
const frame = (event, data, id) => `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Run the script; resolves `{code, lines}` on exit, or kills it once `until(lines)` holds. */
function run(args, until) {
  return new Promise((resolve) => {
    const child = spawn("sh", [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let out = "";
    const lines = () => out.split("\n").filter(Boolean);
    child.stdout.on("data", (d) => {
      out += d;
      if (until?.(lines())) child.kill("SIGTERM");
    });
    child.on("exit", (code) => resolve({ code, lines: lines() }));
  });
}

describe("watch-events.sh", () => {
  it("prints ready, then the first event, and exits 0 with --once while the stream stays open", async () => {
    const { base } = await fixture((_req, res) => {
      sseHead(res);
      res.write(`retry: 3000\n${frame("ready", {})}`);
      res.write(": ping\n\n");
      res.write(frame("status", { type: "status", sessionId: "s1", from: "streaming", to: "idle" }, 1));
      // never ends: --once must stop curl itself
    });
    const started = Date.now();
    const r = await run([base, "--once"]);
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["PI-EVENT ready", 'PI-EVENT status {"type":"status","sessionId":"s1","from":"streaming","to":"idle"}']);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("sends the session and type filters and the header file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-hdr-"));
    tmpDirs.push(dir);
    const headerFile = path.join(dir, "h");
    fs.writeFileSync(headerFile, "Authorization: Bearer test-token\n", { mode: 0o600 });
    const { base, requests } = await fixture((_req, res) => {
      sseHead(res);
      res.write(frame("ready", {}));
      res.write(frame("session_removed", { type: "session_removed", sessionId: "s1" }, 1));
    });
    const r = await run([base, "--session", "s1,s2", "--types", "status,session_removed", "--header-file", headerFile, "--once"]);
    expect(r.code).toBe(0);
    expect(requests[0]).toEqual({ url: "/api/events/stream?session=s1,s2&types=status,session_removed", auth: "Bearer test-token" });
    expect(r.lines.join("\n")).not.toContain("test-token");
  });

  it("treats an HTTP error as fatal", async () => {
    const { base, requests } = await fixture((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"success":false}');
    });
    const r = await run([base]);
    expect(r.code).toBe(1);
    expect(r.lines).toEqual(["PI-EVENT error http (400 = bad --session/--types, 401/403 = token needed)"]);
    expect(requests).toHaveLength(1);
  });

  it("reconnects when the server closes the stream", async () => {
    const { base, requests } = await fixture((_req, res, n) => {
      sseHead(res);
      res.write(frame("ready", {}));
      if (n === 1) res.end(frame("question_opened", { type: "question_opened", sessionId: "s1", questionId: "q1" }, 1));
    });
    const r = await run([base], (lines) => lines.filter((l) => l === "PI-EVENT ready").length === 2);
    expect(r.lines).toEqual(["PI-EVENT ready", 'PI-EVENT question_opened {"type":"question_opened","sessionId":"s1","questionId":"q1"}', "PI-EVENT ready"]);
    expect(requests).toHaveLength(2);
  }, 15_000);

  it("refuses to start without BASE", async () => {
    const r = await run([]);
    expect(r).toEqual({ code: 1, lines: ["PI-EVENT error missing-base"] });
  });
});
