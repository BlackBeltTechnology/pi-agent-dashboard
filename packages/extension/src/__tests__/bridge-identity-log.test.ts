/**
 * A marked bridge aborts on a server that cannot prove the credential, records
 * it off-channel (owner-only log), and never registers (test-plan X2, X3, X5, X6).
 *
 * Uses a REAL `ws` server and the REAL ConnectionManager + `localCredentialPlan`.
 *
 * See change: loopback-credential-proof (tasks 5.11-5.15).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { LOCAL_PROOF_SERVER_HEADER } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { appendIdentityLog, IDENTITY_LOG_MAX_BYTES, IDENTITY_LOG_NAME } from "../bridge-identity-log.js";
import { ConnectionManager, type IdentityFailureReport } from "../connection.js";
import { localCredentialPlan } from "../local-token-header.js";

let home: string;
let server: http.Server;
let wss: WebSocketServer;
let cm: ConnectionManager | undefined;
const TOKEN = "identity-log-token";

const logFile = () => path.join(home, ".pi", "dashboard", "local", IDENTITY_LOG_NAME);
const readLines = () =>
  fs.existsSync(logFile())
    ? fs.readFileSync(logFile(), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-identity-"));
  const dir = path.join(home, ".pi", "dashboard", "local");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "token"), TOKEN);
});
afterEach(async () => {
  cm?.disconnect();
  cm = undefined;
  wss?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  fs.chmodSync(path.join(home, ".pi", "dashboard", "local"), 0o700);
});

async function startServer(opts: { counter?: string; refuse?: boolean; onMessage?: () => void } = {}): Promise<number> {
  server = http.createServer();
  wss = new WebSocketServer({
    server,
    verifyClient: opts.refuse ? (_i, done) => done(false, 401, "no") : undefined,
  });
  wss.on("headers", (h) => {
    if (opts.counter) h.push(`${LOCAL_PROOF_SERVER_HEADER}: ${opts.counter}`);
  });
  wss.on("connection", (ws) => ws.on("message", () => opts.onMessage?.()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

function bridge(port: number, marked: boolean, optOut = false) {
  const reports: IdentityFailureReport[] = [];
  let opens = 0;
  const url = `ws://127.0.0.1:${port}`;
  cm = new ConnectionManager({
    url,
    watchdogTimeout: 0,
    getSessionId: () => "sess-x",
    onOpen: () => {
      opens += 1;
    },
    planDial: (base) =>
      localCredentialPlan(base, {
        env: { homedir: home },
        marker: marked ? url : undefined,
        // Pinned explicitly: the real env must never decide a test. A token holder requires the
        // counter-proof unless it opts out. See change: harden-bridge-inbound-and-discovery (D19).
        allowUnproven: optOut ? "1" : undefined,
        log: () => {},
      }),
    onIdentityFailure: (r) => {
      reports.push(r);
      appendIdentityLog(r, { homedir: home });
    },
  });
  return { cm, reports, opens: () => opens, url };
}

describe("X2 squatter detected and logged off-channel", () => {
  it("aborts, and writes {ts,pid,endpoint,cause:'server-proof-missing'} to a 0600 log", async () => {
    let received = 0;
    const port = await startServer({ onMessage: () => received++ });
    const b = bridge(port, true);
    b.cm.connect();
    await sleep(500);
    expect(b.opens()).toBe(0);
    // the squatter never received a frame (no buffered session_register)
    expect(received).toBe(0);
    expect(b.reports).toHaveLength(1);
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ pid: process.pid, endpoint: b.url, cause: "server-proof-missing" });
    expect(typeof lines[0].ts).toBe("number");
    if (process.platform !== "win32") expect(fs.statSync(logFile()).mode & 0o777).toBe(0o600);
  });
});

describe("X3 forged counter-proof", () => {
  it("aborts with server-proof-invalid", async () => {
    const port = await startServer({ counter: `v1.${"A".repeat(43)}` });
    const b = bridge(port, true);
    b.cm.connect();
    await sleep(500);
    expect(b.opens()).toBe(0);
    expect(readLines().map((l) => l.cause)).toEqual(["server-proof-invalid"]);
  });
});

describe("X5 a proof-ignorant server", () => {
  it("(a) only the explicit opt-out registers with a proof-ignorant server; a token holder — marked or not — aborts and quarantines", async () => {
    const port = await startServer();
    const optedOut = bridge(port, false, true);
    optedOut.cm.connect();
    await sleep(400);
    expect(optedOut.opens()).toBe(1);
    expect(optedOut.reports).toHaveLength(0);
    optedOut.cm.disconnect();

    // Unmarked but holding the token: no longer a grace accept (D19).
    const unmarked = bridge(port, false);
    unmarked.cm.connect();
    await sleep(400);
    expect(unmarked.opens()).toBe(0);
    expect(unmarked.reports).toHaveLength(1);
    unmarked.cm.disconnect();

    const marked = bridge(port, true);
    marked.cm.connect();
    await sleep(400);
    expect(marked.opens()).toBe(0);
    expect(marked.reports).toHaveLength(1);
  });

  it("(b) a 401 refusal: both retry transiently with no identity line", async () => {
    const port = await startServer({ refuse: true });
    for (const markedFlag of [false, true]) {
      const b = bridge(port, markedFlag);
      b.cm.connect();
      // normal backoff (1 s) — a quarantine would still be waiting out its 5 s floor
      await sleep(1600);
      expect(b.opens()).toBe(0);
      expect(b.reports).toHaveLength(0);
      b.cm.disconnect();
    }
    expect(readLines()).toHaveLength(0);
  }, 10_000);
});

describe("X6 identity log writer faults", () => {
  const report: IdentityFailureReport = { ts: 1, pid: 2, endpoint: "ws://127.0.0.1:1", cause: "server-proof-missing" };

  it("an unwritable directory does not throw", () => {
    if (process.platform === "win32") return;
    fs.chmodSync(path.join(home, ".pi", "dashboard", "local"), 0o500);
    expect(() => appendIdentityLog(report, { homedir: home })).not.toThrow();
  });

  it("rotates at 256 KiB to .1 and starts a fresh 0600 file", () => {
    fs.writeFileSync(logFile(), "x".repeat(IDENTITY_LOG_MAX_BYTES));
    appendIdentityLog(report, { homedir: home });
    expect(fs.existsSync(`${logFile()}.1`)).toBe(true);
    expect(fs.statSync(`${logFile()}.1`).size).toBe(IDENTITY_LOG_MAX_BYTES);
    expect(readLines()).toEqual([report]);
    if (process.platform !== "win32") expect(fs.statSync(logFile()).mode & 0o777).toBe(0o600);
  });
});
