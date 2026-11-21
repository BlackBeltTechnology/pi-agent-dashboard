/**
 * Harness for the sudo credential relay tests: the REAL `createBrowserGateway`
 * message loop + the REAL relay, with a recording fake bridge side and fake
 * browser sockets (the owner-gate exemplar's shape).
 * See change: add-sudo-credential-prompt.
 */
import { EventEmitter } from "node:events";
import type { ServerToExtensionMessage, SudoCredentialRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { vi } from "vitest";
import { createBrowserGateway } from "../../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import type { PiGateway } from "../../pi/pi-gateway.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import { createSudoCredentialRelay, type SudoCredentialRelay } from "../../sudo-credential/relay.js";

export const OWNER = { iss: "https://kc/realms/app", sub: "user-1" };
export const OTHER = { iss: "https://kc/realms/app", sub: "user-2" };

export interface FakeBrowser extends EventEmitter {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  readyState: number;
  bufferedAmount: number;
  OPEN: number;
  principal?: { iss: string; sub: string };
  sessionTier?: () => "observe" | "control" | "operate" | null;
}

export function makeBrowser(opts: { principal?: { iss: string; sub: string }; tier?: "observe" | "control" | "operate" } = {}): FakeBrowser {
  const ws = new EventEmitter() as FakeBrowser;
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.ping = vi.fn();
  ws.terminate = vi.fn();
  ws.readyState = 1;
  ws.bufferedAmount = 0;
  ws.OPEN = 1;
  if (opts.principal) ws.principal = opts.principal;
  if (opts.tier) ws.sessionTier = () => opts.tier!;
  return ws;
}

/** Frames a fake browser received, parsed. */
export const framesOf = (ws: FakeBrowser): Array<Record<string, unknown> & { type: string }> =>
  ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));

export const sudoFramesOf = (ws: FakeBrowser) => framesOf(ws).filter((f) => f.type.startsWith("sudo_credential_"));

export async function deliver(ws: EventEmitter, msg: unknown): Promise<void> {
  ws.emit("message", Buffer.from(JSON.stringify(msg)));
  // A few turns: subscribe replays resolve through a promise chain.
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

export function request(sessionId: string, callId: string, extra: Partial<SudoCredentialRequestMessage> = {}): SudoCredentialRequestMessage {
  return { type: "sudo_credential_request", sessionId, callId, commands: ["sudo true"], prompt: "[sudo] password for me: ", ...extra };
}

export interface SudoHarness {
  gateway: ReturnType<typeof createBrowserGateway>;
  relay: SudoCredentialRelay;
  /** Every `sudo_credential_*` frame sent to a bridge, in order. */
  bridgeFrames: Array<{ sessionId: string; msg: ServerToExtensionMessage }>;
  trusted: { value: boolean };
  eventStore: ReturnType<typeof createMemoryEventStore>;
  sessionManager: ReturnType<typeof createMemorySessionManager>;
  /** Connect a fake browser; optionally subscribe it to `sessionId`. */
  connect(opts?: Parameters<typeof makeBrowser>[0] & { subscribe?: string | false; req?: unknown }): Promise<FakeBrowser>;
}

/** Sessions `s1` and `s2` are owned by `OWNER`. */
export function makeSudoHarness(opts: { active?: boolean; ackDeadlineMs?: number } = {}): SudoHarness {
  const bridgeFrames: SudoHarness["bridgeFrames"] = [];
  const sendToSession = vi.fn((sessionId: string, msg: ServerToExtensionMessage) => {
    // The gateway also sends request_* frames on subscribe; only the relay's frames matter here.
    if (msg.type.startsWith("sudo_credential_")) bridgeFrames.push({ sessionId, msg });
    return true;
  });
  const piGateway = {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession,
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
  const sessionManager = createMemorySessionManager();
  const eventStore = createMemoryEventStore(() => false);
  for (const id of ["s1", "s2"]) {
    sessionManager.register({ id, cwd: "/p", source: "dashboard" } as never);
    sessionManager.update(id, { principalOwner: OWNER });
    // A live session in a tool call has events; subscribe replays pending state only for such a session.
    eventStore.insertEvent(id, { eventType: "agent_start", timestamp: Date.now(), data: { type: "agent_start" } } as never);
  }
  // Params 4..24 are unused here; isResolverActive is the 25th positional arg.
  const skip = new Array(21).fill(undefined);
  const gateway = (createBrowserGateway as unknown as (...args: unknown[]) => ReturnType<typeof createBrowserGateway>)(
    sessionManager,
    eventStore,
    piGateway,
    ...skip,
    () => opts.active ?? false,
  );
  const trusted = { value: true };
  const relay = createSudoCredentialRelay({
    browsers: gateway.sudoSeam,
    sendToBridge: (sessionId, msg) => sendToSession(sessionId, msg),
    isBridgeTrusted: () => trusted.value,
    ...(opts.ackDeadlineMs !== undefined ? { ackDeadlineMs: opts.ackDeadlineMs } : {}),
  });
  gateway.setSudoCredentialRelay(relay);

  return {
    gateway,
    relay,
    bridgeFrames,
    trusted,
    eventStore,
    sessionManager,
    async connect(o = {}) {
      const ws = makeBrowser(o);
      gateway.wss.emit("connection", ws, o.req ?? {});
      if (o.subscribe !== false) await deliver(ws, { type: "subscribe", sessionId: o.subscribe ?? "s1" });
      return ws;
    },
  };
}
