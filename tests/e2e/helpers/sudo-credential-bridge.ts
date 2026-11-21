/**
 * Synthetic-bridge glue for the sudo credential prompt L3 specs
 * (`add-sudo-credential-prompt`, test-plan #S58–#S64).
 *
 * Two jobs:
 *  - a fake pi session that emits `sudo_credential_{request,cache,dismiss}` and
 *    captures the frames the server forwards to it (`_response`, `_cancel`,
 *    `_forget`), each with a receive timestamp;
 *  - capture of the browser's own `sudo_credential_*` frames (`_shown`, which the
 *    relay consumes and never forwards to the bridge) and a toggleable drop of
 *    server → browser `sudo_credential_request` frames (old-client simulation).
 *
 * WHY the bridge runs INSIDE the container: the relay refuses at once
 * (`_cancel {reason:"unanswerable"}`) for any bridge `decideVaultTrust` rejects,
 * and a host-side ticketed bridge (`composer-bridge.ts`) arrives over plain
 * transport as a remote device — `plain-transport`, never trusted. A bridge that
 * dials the container's gateway unix socket as the `pi` user is locally admitted,
 * exactly like a real pi session. The `ws` package from `/app/node_modules` is the
 * same transport the real bridge uses; frames cross `docker exec` as JSON lines.
 * Precedent: `gateway-origin-surfaces.spec.ts` registers a local session via
 * `docker exec ... node -e`.
 *
 * Passwords only ever appear in test-supplied values; nothing here logs a frame.
 * See change: add-sudo-credential-prompt.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Page } from "@playwright/test";
import { expect } from "../fixtures.js";
import { FIXTURE_GIT } from "./index.js";
import { resolveContainer } from "./container-proc.js";

/** Frame as the server forwarded it to the bridge, stamped on arrival (host clock). */
export interface BridgeFrame {
  type: string;
  at: number;
  [key: string]: unknown;
}

export interface SudoBridge {
  sessionId: string;
  /** Emit `sudo_credential_request`; returns the callId. Stamps `lastRequestAt`. */
  emitRequest: (opts: { commands: string[]; prompt: string; callId?: string }) => string;
  /** Emit `sudo_credential_cache` (`null` = cache cleared / Forget chip gone). */
  emitCache: (expiresAt: number | null) => void;
  /** Emit `sudo_credential_dismiss` for a pending callId (helper closed, tool call ended). */
  emitDismiss: (callId: string) => void;
  /** Wall-clock (host) ms of the most recent `emitRequest` write. */
  lastRequestAt: () => number;
  /** Every frame the server forwarded to this bridge, oldest first. */
  received: () => BridgeFrame[];
  /** Forwarded frames of one `sudo_credential_*` type (`"response" | "cancel" | "forget"`). */
  frames: (kind: "response" | "cancel" | "forget") => BridgeFrame[];
  /** Orderly close: unregister then end the socket. */
  close: () => void;
  /** Abrupt loss: the socket dies without `session_unregister` (the bridge-loss road). */
  drop: () => void;
}

// Runs in the container: bridge JSON lines on stdin → gateway socket; server frames → stdout lines.
const CONTAINER_SCRIPT = `
const { createRequire } = require("node:module");
const fs = require("node:fs");
const WebSocket = createRequire("/app/package.json")("ws");
const [sessionId, cwd, portHint] = process.argv.slice(1);
const dir = "/home/pi/.pi/dashboard";
const socks = fs.readdirSync(dir).filter((n) => /^gateway-\\d+\\.sock$/.test(n));
const sock = socks.find((n) => n === "gateway-" + portHint + ".sock") || socks[0];
if (!sock) { console.error("NO_GATEWAY_SOCKET"); process.exit(2); }
const ws = new WebSocket("ws+unix://" + dir + "/" + sock + ":/");
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "session_register", sessionId, cwd, source: "tui", pid: process.pid }));
  ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
  process.stdout.write("OPEN\\n");
});
ws.on("message", (d) => process.stdout.write(String(d).replace(/\\n/g, " ") + "\\n"));
ws.on("close", () => process.exit(0));
ws.on("error", (e) => { console.error("WS_ERROR " + String(e && e.message)); process.exit(1); });
require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => {
  if (l === "__TERMINATE__") return ws.terminate();
  if (ws.readyState === 1) ws.send(l);
}).on("close", () => { try { ws.close(); } catch {} });
`;

export interface ConnectSudoBridgeOptions {
  /** Re-register under an existing id (bridge re-registers after a loss). */
  sessionId?: string;
}

export async function connectSudoBridge(
  page: Page,
  tag: string,
  options: ConnectSudoBridgeOptions = {},
): Promise<SudoBridge> {
  const health = (await (await page.request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  const sessionId = options.sessionId ?? `e2e-sudo-${tag}-${Date.now()}`;
  const child: ChildProcessWithoutNullStreams = spawn(
    "docker",
    [
      "exec", "-i", resolveContainer(),
      "node", "-e", CONTAINER_SCRIPT, sessionId, FIXTURE_GIT, String(health.piGatewayPort ?? ""),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const inbox: BridgeFrame[] = [];
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8").slice(0, 2000); });
  const opened = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sudo bridge did not open: ${stderr}`)), 15_000);
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`sudo bridge exited early: ${stderr}`)); });
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (line === "OPEN") { clearTimeout(timer); resolve(); return; }
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (typeof msg.type === "string") inbox.push({ ...msg, type: msg.type, at: Date.now() });
      } catch {
        // non-JSON line: not a gateway frame
      }
    });
  });
  await opened;

  let requestAt = 0;
  let nextCall = 0;
  const write = (payload: Record<string, unknown>) => {
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify(payload)}\n`);
  };
  const kill = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } };
  // A session with a bash call in flight always has stored events; the server replays a pending
  // prompt to a (re)subscribing page only for such a session.
  write({ type: "event_forward", sessionId, event: { eventType: "agent_start", timestamp: Date.now(), data: {} } });
  return {
    sessionId,
    emitRequest: ({ commands, prompt, callId }) => {
      const id = callId ?? `call-${tag}-${Date.now()}-${nextCall++}`;
      requestAt = Date.now();
      write({ type: "sudo_credential_request", sessionId, callId: id, commands, prompt });
      return id;
    },
    emitCache: (expiresAt) => write({ type: "sudo_credential_cache", sessionId, expiresAt }),
    emitDismiss: (callId) => write({ type: "sudo_credential_dismiss", sessionId, callId }),
    lastRequestAt: () => requestAt,
    received: () => inbox,
    frames: (kind) => inbox.filter((m) => m.type === `sudo_credential_${kind}` && m.sessionId === sessionId),
    close: () => {
      write({ type: "session_unregister", sessionId });
      try { child.stdin.end(); } catch { /* closed */ }
      setTimeout(kill, 1500).unref();
    },
    drop: () => {
      try { child.stdin.write("__TERMINATE__\n"); } catch { /* closed */ }
      setTimeout(kill, 1500).unref();
    },
  };
}

/** A `sudo_credential_*` frame the page sent or received. Never read `password` outside a leak assertion. */
export interface PageSudoFrame {
  type: string;
  sessionId?: string;
  callId?: string;
  password?: string;
  commands?: string[];
  prompt?: string;
  at: number;
}

export interface PageSudoCapture {
  /** Browser → server frames, oldest first. */
  sent: () => PageSudoFrame[];
  /** Server → browser frames that REACHED the page (a frame dropped by `dropSudoRequests` is not here). */
  received: () => PageSudoFrame[];
}

/**
 * Record the page's `sudo_credential_*` WebSocket frames. Register before the
 * page connects; survives reloads and reconnects (Playwright re-fires `websocket`).
 */
export function capturePageSudoFrames(page: Page): PageSudoCapture {
  const sent: PageSudoFrame[] = [];
  const received: PageSudoFrame[] = [];
  const parse = (payload: string | Buffer): PageSudoFrame | null => {
    try {
      const msg = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8")) as Record<string, unknown>;
      if (typeof msg.type !== "string" || !msg.type.startsWith("sudo_credential_")) return null;
      return { ...msg, type: msg.type, at: Date.now() };
    } catch {
      return null;
    }
  };
  page.on("websocket", (ws) => {
    ws.on("framesent", (f) => { const m = parse(f.payload); if (m) sent.push(m); });
    ws.on("framereceived", (f) => { const m = parse(f.payload); if (m) received.push(m); });
  });
  return { sent: () => sent, received: () => received };
}

export interface SudoRequestDrop {
  setDropping: (v: boolean) => void;
}

/**
 * Old-client simulation: drop server → page `sudo_credential_request` frames while
 * dropping (everything else, and all page → server traffic, passes). Install BEFORE
 * navigation. Same proxy shape as `dropServerFrames`, with a switch.
 */
export async function dropSudoRequests(page: Page): Promise<SudoRequestDrop> {
  let dropping = true;
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (dropping && typeof m === "string") {
        try {
          if ((JSON.parse(m) as { type?: string }).type === "sudo_credential_request") return;
        } catch {
          // not JSON: forward
        }
      }
      ws.send(m);
    });
  });
  return { setDropping: (v) => { dropping = v; } };
}

export interface SocketOutage {
  /** Close the page's live socket(s) and refuse reconnects until `restore()`. */
  cut: () => Promise<void>;
  restore: () => Promise<void>;
}

/** Connection-loss simulation for the page's dashboard WebSocket. Install BEFORE navigation. */
export async function controlSocketOutage(page: Page): Promise<SocketOutage> {
  let blocked = false;
  const live = new Set<{ close: () => void }>();
  await page.routeWebSocket(/.*/, (ws) => {
    if (blocked) {
      ws.close();
      return;
    }
    const server = ws.connectToServer();
    const pair = { close: () => { ws.close(); server.close(); } };
    live.add(pair);
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    // Installing onClose disables Playwright's automatic close forwarding: forward it ourselves.
    ws.onClose((code, reason) => {
      live.delete(pair);
      server.close({ code, reason }).catch(() => undefined);
    });
  });
  return {
    // Offline too: the client's post-close `/auth/status` probe must REJECT (outage), not answer
    // `authenticated:false` (which swaps the whole app for the sign-in page and unmounts the dialog).
    cut: async () => {
      blocked = true;
      await page.context().setOffline(true);
      for (const p of [...live]) p.close();
      live.clear();
    },
    restore: async () => {
      blocked = false;
      await page.context().setOffline(false);
    },
  };
}

/** The dialog and its stable test ids (`SudoCredentialDialog.tsx`). */
export function sudoDialog(page: Page) {
  const dialog = page.getByTestId("sudo-credential-dialog");
  return {
    dialog,
    password: page.getByTestId("sudo-credential-password"),
    submit: page.getByTestId("sudo-credential-submit"),
    cancel: page.getByTestId("sudo-credential-cancel"),
    forget: page.getByTestId("sudo-credential-forget"),
    commands: page.getByTestId("sudo-credential-commands"),
    promptText: page.getByTestId("sudo-credential-prompt-text"),
    error: dialog.getByRole("alert"),
  };
}

/**
 * Poll until `count()` equals `n`, then confirm it STAYS `n` for `settleMs`
 * ("exactly once" is not provable by the first sighting alone).
 */
export async function expectExactly(count: () => number, n: number, settleMs = 750): Promise<void> {
  await expect.poll(count, { timeout: 10_000 }).toBe(n);
  await new Promise((r) => setTimeout(r, settleMs));
  expect(count()).toBe(n);
}
