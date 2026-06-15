/**
 * Faux-model server-side integration test.
 *
 * Spawns a REAL `pi` subprocess driven by the faux fixture
 * (`qa/fixtures/faux-provider.ext.ts`) with the dashboard bridge extension
 * loaded, connects it to a real in-process dashboard server, drives prompts
 * through the same REST API the browser uses, and asserts the streamed events
 * arriving on the browser `/ws` gateway.
 *
 * This closes the prompt → model → event → bridge → server → `/ws` round-trip
 * that no other test exercises. It is deterministic and key-free: the faux
 * provider streams scripted `text_*` / `done` / `error` / `aborted` events
 * through pi's normal pipeline.
 *
 * Guarded behind a `pi`-on-PATH probe → the whole suite `describe.skip`s with a
 * clear message when pi is absent, so `npm test` on a bare box does not red-fail.
 *
 * See change: add-faux-model-integration-tests.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PI_BIN = path.join(REPO_ROOT, "node_modules/.bin/pi");
const BRIDGE_EXT = path.join(REPO_ROOT, "packages/extension/src/bridge.ts");
const FAUX_FIXTURE = path.join(REPO_ROOT, "qa/fixtures/faux-provider.ext.ts");

const piAvailable = fs.existsSync(PI_BIN);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws open timeout")), 5000);
  });
}

/** Poll `predicate` against the live message buffer until true or timeout. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 25000,
  stepMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(stepMs);
  }
  return predicate();
}

interface FauxSession {
  child: ChildProcess;
  browser: WebSocket;
  sessionId: string;
  messages: any[];
  events: () => any[];
  eventTypes: () => string[];
  statuses: () => (string | undefined)[];
  /** Stringified buffer — handy for substring assertions on streamed text. */
  dump: () => string;
  stop: () => void;
}

/**
 * Boot a faux-backed pi session: spawn `pi --mode rpc` with the bridge + faux
 * fixture pointed at the test server, await registration on the browser
 * gateway, and subscribe to the session's event stream.
 */
async function startFauxSession(
  handle: TestServerHandle,
  opts: { scenario: string; tps?: number },
): Promise<FauxSession> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "faux-home-"));
  const browser = new WebSocket(`ws://localhost:${handle.httpPort}/ws`);
  await waitForOpen(browser);

  const messages: any[] = [];
  // Sessions already registered when this browser connected (snapshot replay).
  // The newly-spawned pi's id is whichever `session_added` is NOT in this set.
  const preExisting = new Set<string>();
  let sessionId: string | undefined;
  browser.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    messages.push(msg);
    if (msg.type === "session_added" && msg.session?.id && !preExisting.has(msg.session.id)) {
      sessionId ??= msg.session.id;
    }
  });
  // Drain the connect-time snapshot of pre-existing sessions before spawning.
  await delay(300);
  for (const m of messages) {
    if (m.type === "session_added" && m.session?.id) preExisting.add(m.session.id);
  }

  const child = spawn(
    PI_BIN,
    ["--mode", "rpc", "-ne", "-e", BRIDGE_EXT, "-e", FAUX_FIXTURE, "--model", "faux/faux-1"],
    {
      cwd: tmpHome,
      env: {
        ...process.env,
        HOME: tmpHome,
        PI_DASHBOARD_URL: `ws://localhost:${handle.piPort}`,
        PI_DASHBOARD_NO_MDNS: "1",
        FAUX_SCRIPT: opts.scenario,
        FAUX_TPS: String(opts.tps ?? 50),
      },
      stdio: ["pipe", "ignore", "ignore"],
    },
  );

  const registered = await waitFor(() => sessionId != null, 20000);
  if (!registered || !sessionId) {
    try {
      browser.close();
    } catch {
      /* ignore */
    }
    child.kill("SIGKILL");
    fs.rmSync(tmpHome, { recursive: true, force: true });
    throw new Error("faux session did not register within timeout");
  }

  browser.send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 }));
  await delay(150);

  const events = () => messages.filter((m) => m.type === "event");
  return {
    child,
    browser,
    sessionId,
    messages,
    events,
    eventTypes: () => events().map((m) => m.event?.eventType),
    statuses: () =>
      messages
        .filter((m) => m.type === "session_updated" && m.sessionId === sessionId)
        .map((m) => (m.updates?.status ?? m.session?.status) as string | undefined)
        .filter((s): s is string => typeof s === "string"),
    dump: () => JSON.stringify(messages),
    stop: () => {
      try {
        browser.close();
      } catch {
        /* ignore */
      }
      if (!child.killed) child.kill("SIGKILL");
      fs.rmSync(tmpHome, { recursive: true, force: true });
    },
  };
}

async function postPrompt(handle: TestServerHandle, sessionId: string, text: string) {
  return fetch(`http://localhost:${handle.httpPort}/api/session/${sessionId}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function postAbort(handle: TestServerHandle, sessionId: string) {
  return fetch(`http://localhost:${handle.httpPort}/api/session/${sessionId}/abort`, {
    method: "POST",
  });
}

const suite = piAvailable ? describe : describe.skip;
if (!piAvailable) {
  // eslint-disable-next-line no-console
  console.warn(`[faux-session] skipping: pi binary not found at ${PI_BIN}`);
}

suite("faux-session integration (real pi subprocess)", () => {
  let handle: TestServerHandle;
  const open: FauxSession[] = [];

  beforeAll(async () => {
    handle = await createTestServer();
  });

  afterEach(() => {
    for (const s of open.splice(0)) s.stop();
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  it("2.4 streams assistant text, transitions status, surfaces usage + run lifecycle", async () => {
    const session = await startFauxSession(handle, { scenario: "plain-text" });
    open.push(session);

    const res = await postPrompt(handle, session.sessionId, "hello faux");
    expect(res.status).toBe(200);

    // Assistant text streams back.
    const gotText = await waitFor(() =>
      session.dump().includes("The quick brown faux jumps over the lazy dog."),
    );
    expect(gotText).toBe(true);

    // Run lifecycle fires (start + end).
    await waitFor(() => session.eventTypes().includes("agent_end"));
    expect(session.eventTypes()).toContain("agent_start");
    expect(session.eventTypes()).toContain("agent_end");

    // Status went to a busy state then back to idle.
    await waitFor(() => session.statuses().includes("idle"));
    const statuses = session.statuses();
    expect(statuses.some((s) => s === "streaming" || s === "active")).toBe(true);
    expect(statuses).toContain("idle");

    // Usage/cost surfaces.
    expect(session.eventTypes()).toContain("stats_update");
  }, 45000);

  it("2.5 abort mid-stream emits an aborted signal and clears the run", async () => {
    const session = await startFauxSession(handle, { scenario: "slow-stream", tps: 2 });
    open.push(session);

    await postPrompt(handle, session.sessionId, "stream slowly");
    // Wait until streaming actually begins (first scripted chunk).
    await waitFor(() => session.dump().includes("slow-chunk-0"), 15000);

    await postAbort(handle, session.sessionId);

    // Run clears: status returns to idle and the full body never arrives.
    const idle = await waitFor(() => session.statuses().includes("idle"), 15000);
    expect(idle).toBe(true);
    expect(session.dump()).not.toContain("slow-chunk-39");
  }, 45000);

  it("2.6 model error surfaces and the session does not hang", async () => {
    const session = await startFauxSession(handle, { scenario: "model-error" });
    open.push(session);

    await postPrompt(handle, session.sessionId, "trigger error");

    const surfaced = await waitFor(() => session.dump().includes("faux model error"), 20000);
    expect(surfaced).toBe(true);

    // Not stuck busy — status returns to idle.
    const idle = await waitFor(() => session.statuses().includes("idle"), 15000);
    expect(idle).toBe(true);
  }, 45000);

  it("ask_user answer round-trips back into the next faux response", async () => {
    // The answer-submit path (`prompt_response` over `/ws`) is server-mediated,
    // so this round-trip lives in the server suite per task 3.4's guidance.
    const session = await startFauxSession(handle, { scenario: "ask-select-roundtrip" });
    open.push(session);

    await postPrompt(handle, session.sessionId, "ask me to pick");

    // Faux emits ask_user → bridge surfaces a prompt_request to the browser.
    await waitFor(() =>
      session.messages.some(
        (m) => m.type === "prompt_request" && m.sessionId === session.sessionId,
      ),
    );
    const req = session.messages.find(
      (m) => m.type === "prompt_request" && m.sessionId === session.sessionId,
    );
    expect(req?.promptId).toBeTruthy();

    // Submit the answer the same way the browser does.
    session.browser.send(
      JSON.stringify({
        type: "prompt_response",
        sessionId: session.sessionId,
        promptId: req.promptId,
        answer: "a",
        source: "test",
      }),
    );

    // The factory step reads the answer from the toolResult context and echoes
    // it back. The bridge's ask_user tool wraps the choice as `User responded:
    // "a"`, so the follow-up reads `you picked User responded: "a"`.
    const echoed = await waitFor(
      () => /you picked[\s\S]*"a"/.test(session.dump()),
      20000,
    );
    expect(echoed).toBe(true);
  }, 45000);

  it("2.7 concurrent faux sessions stay isolated", async () => {
    const a = await startFauxSession(handle, { scenario: "isolation-a" });
    const b = await startFauxSession(handle, { scenario: "isolation-b" });
    open.push(a, b);
    expect(a.sessionId).not.toBe(b.sessionId);

    await postPrompt(handle, a.sessionId, "prompt a");
    await postPrompt(handle, b.sessionId, "prompt b");

    await waitFor(() => a.dump().includes("ISOLATION_MARKER_AAA"));
    await waitFor(() => b.dump().includes("ISOLATION_MARKER_BBB"));

    // Each stream contains only its own scripted marker.
    expect(a.dump()).toContain("ISOLATION_MARKER_AAA");
    expect(a.dump()).not.toContain("ISOLATION_MARKER_BBB");
    expect(b.dump()).toContain("ISOLATION_MARKER_BBB");
    expect(b.dump()).not.toContain("ISOLATION_MARKER_AAA");
  }, 60000);
});
