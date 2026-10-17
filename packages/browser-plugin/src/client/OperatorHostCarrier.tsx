/**
 * Operator host carrier (change: add-operator-browser-relay, task 8.1; design
 * D1, D2, D9, D10).
 *
 * Always mounted (via `BrowserRelayFeed`), zero UI. In the Electron main window
 * (`window.piDashboard.browserHost` present) it makes this machine's Electron
 * main an *operator host* of the dashboard the SPA's `/ws` currently targets:
 *
 *   status probe (`operatorHosts: true`) → `setTarget` → `identity`
 *     → `browser_host_hello` → `challenge` → `sign` → `browser_host_register`
 *     → `browser_host_registered`
 *
 * and then bridges main's IPC ↔ the `browser_host_*` WS messages (connect,
 * connect_cancel, relay data/close, ext open/data/close, tee).
 *
 * Gating (never speak to an older server — an unknown type would fall through
 * the gateway's `default:` branch): no `browserHost` → nothing at all (no
 * probe, no listener); status without a literal `operatorHosts: true` → no
 * message, no IPC. The probe is repeated on every (re)connect.
 *
 * One cycle per socket: the effect re-runs when the shell reconnects or the
 * socket changes (server switch), so there is exactly one hello/register per
 * connection and `setTarget` is called again every time (main clears the target
 * on navigation). A cycle's end — disconnect, switch, unmount — drops the
 * registration, cancels unanswered connects and closes live links in main (the
 * server already closed them when the carrier socket closed). A missing
 * `registered` within `HOST_REGISTER_TIMEOUT_MS` is a refusal: the window stays
 * unregistered and nothing is bridged until the next connection.
 *
 * Secrets: the signature is the only credential produced here, via
 * `browserHost.sign` (main refuses unless `serverId` matches the target's
 * `/api/health` `instanceId`). The private key, tokens and the socket's ticket
 * query never appear in a message, log or store. `linkId` is only ever
 * forwarded between the wire and main.
 */
import {
  usePluginSend,
  usePluginSocket,
  useShellConnectionStatus,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { BrowserHostBridge } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import type React from "react";
import { useEffect, useRef } from "react";
import { getBrowserStatus } from "./browser-api.js";
import { setOperatorHostId } from "./relay-store.js";

/** How long to wait for `browser_host_registered` before treating the register as refused. */
export const HOST_REGISTER_TIMEOUT_MS = 10_000;
/** WS close code used when a connection loss ends a link in main ("going away"). */
const LINK_GONE_CODE = 1001;
const WS_OPEN = 1;

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const swallow = (p: Promise<unknown>): void => {
  p.catch(() => {});
};

/** `window.piDashboard.browserHost`, or `undefined` outside the trusted Electron main window. */
export function getBrowserHost(): BrowserHostBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { piDashboard?: { browserHost?: BrowserHostBridge } }).piDashboard?.browserHost;
}

/** The dashboard origin a shell socket targets (`ws(s)://h:p/ws?…` → `http(s)://h:p`), or `null`. */
function targetOrigin(ws: WebSocket): string | null {
  try {
    const u = new URL(ws.url);
    const scheme = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : null;
    return scheme ? `${scheme}//${u.host}` : null;
  } catch {
    return null;
  }
}

type Msg = Record<string, unknown>;

/** The state of ONE register cycle (one socket). */
interface Cycle {
  bridge: BrowserHostBridge;
  alive: boolean;
  registered: boolean;
  /** The hostId a `challenge` / `registered` is accepted for; `null` = none expected. */
  expectHostId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  pending: Set<string>; // connect requestIds main has not answered
  links: Set<string>; // linkIds main opened (answered ok) and not yet closed
  linkOf: Map<string, string>; // requestId → linkId
  post(msg: Msg): void;
}

function onRegistered(c: Cycle, msg: Msg): void {
  if (c.expectHostId === null || msg.hostId !== c.expectHostId || c.registered || !c.alive) return;
  c.registered = true;
  if (c.timer) clearTimeout(c.timer);
  c.timer = null;
  setOperatorHostId(c.expectHostId);
}

async function onChallenge(c: Cycle, msg: Msg): Promise<void> {
  const hostId = c.expectHostId;
  if (hostId === null || c.registered || !isStr(msg.nonce) || !isStr(msg.serverId)) return;
  c.expectHostId = null; // a challenge answers one hello
  try {
    const identity = await c.bridge.identity();
    const signature = await c.bridge.sign(msg.nonce, msg.serverId);
    if (!c.alive || identity.hostId !== hostId) return;
    c.expectHostId = hostId; // `registered` is accepted only after our own register
    c.post({
      type: "browser_host_register",
      hostId,
      signature,
      label: identity.label,
      platform: identity.platform,
      canOpenChrome: identity.canOpenChrome,
      profiles: identity.profiles,
    });
    c.timer = setTimeout(() => {
      c.timer = null;
      if (!c.registered) c.expectHostId = null; // refused: no late `registered` is trusted
    }, HOST_REGISTER_TIMEOUT_MS);
  } catch {
    /* main refused to sign (serverId mismatch): never register */
  }
}

async function onConnectRequest(c: Cycle, msg: Msg): Promise<void> {
  const { requestId, linkId, instanceId, profileDirectory, serverLabel } = msg;
  if (!isStr(requestId)) return;
  if (!isStr(linkId) || !isStr(instanceId) || !isStr(profileDirectory) || typeof serverLabel !== "string") {
    c.post({ type: "browser_host_connect_result", requestId, ok: false, reason: "invalid" });
    return;
  }
  c.pending.add(requestId);
  c.linkOf.set(requestId, linkId);
  try {
    await c.bridge.connect({ requestId, linkId, instanceId, profileDirectory, serverLabel });
  } catch {
    if (c.pending.delete(requestId)) {
      c.linkOf.delete(requestId);
      c.post({ type: "browser_host_connect_result", requestId, ok: false, reason: "launch-failed" });
    }
  }
}

/** Server → main, after registration only. Field types are checked here; main re-validates. */
function bridgeToMain(c: Cycle, type: string, msg: Msg): void | Promise<void> {
  const { bridge } = c;
  switch (type) {
    case "browser_host_connect":
      return onConnectRequest(c, msg);
    case "browser_host_connect_cancel":
      if (isStr(msg.requestId)) swallow(bridge.cancelConnect(msg.requestId));
      return;
    case "browser_host_relay_data":
      if (isStr(msg.linkId) && typeof msg.data === "string") swallow(bridge.extSend(msg.linkId, msg.data));
      return;
    case "browser_host_relay_close":
      if (isStr(msg.linkId) && isInt(msg.code)) swallow(bridge.extClose(msg.linkId, msg.code));
      return;
    case "browser_host_tee":
      if (isStr(msg.linkId) && isStr(msg.instanceId) && isInt(msg.tabId) && typeof msg.on === "boolean") {
        swallow(bridge.tee(msg.linkId, msg.instanceId, msg.tabId, msg.on));
      }
      return;
  }
}

function dispatch(c: Cycle, type: string, msg: Msg): void | Promise<void> {
  if (type === "browser_host_challenge") return onChallenge(c, msg);
  if (type === "browser_host_registered") return onRegistered(c, msg);
  // Nothing is bridged before (or after a refused) registration.
  if (c.registered) return bridgeToMain(c, type, msg);
}

/** Main → server: connect answers and extension link events. */
function subscribeMain(c: Cycle): Array<() => void> {
  return [
    c.bridge.onConnect((answer) => {
      if (!c.pending.delete(answer.requestId)) return; // not a request we forwarded
      const linkId = c.linkOf.get(answer.requestId);
      c.linkOf.delete(answer.requestId);
      if (answer.ok && linkId) c.links.add(linkId);
      c.post({
        type: "browser_host_connect_result",
        requestId: answer.requestId,
        ok: answer.ok,
        ...(answer.reason ? { reason: answer.reason } : {}),
      });
    }),
    c.bridge.onExt((ev) => {
      if (ev.kind === "open") c.post({ type: "browser_host_ext_open", linkId: ev.linkId });
      else if (ev.kind === "data") c.post({ type: "browser_host_ext_data", linkId: ev.linkId, data: ev.data });
      else {
        c.links.delete(ev.linkId);
        c.post({ type: "browser_host_ext_close", linkId: ev.linkId, code: ev.code });
      }
    }),
  ];
}

/** Parse one inbound frame; only `browser_host_*` objects are of interest. */
function parseHostFrame(data: unknown): { type: string; msg: Msg } | null {
  try {
    const parsed: unknown = JSON.parse(data as string);
    if (typeof parsed !== "object" || parsed === null) return null;
    const msg = parsed as Msg;
    return typeof msg.type === "string" && msg.type.startsWith("browser_host_") ? { type: msg.type, msg } : null;
  } catch {
    return null;
  }
}

/**
 * Run one register cycle on `ws`; returns its teardown. Probes the status first
 * (an older server gets nothing), then target → identity → listeners → hello.
 */
function runCycle(bridge: BrowserHostBridge, ws: WebSocket, origin: string, send: (m: unknown) => void | Promise<void>): () => void {
  const offs: Array<() => void> = [];
  const c: Cycle = {
    bridge,
    alive: true,
    registered: false,
    expectHostId: null,
    timer: null,
    pending: new Set(),
    links: new Set(),
    linkOf: new Map(),
    post: (msg) => {
      if (c.alive) void send(msg);
    },
  };
  const onMessage = (evt: MessageEvent): void => {
    const frame = parseHostFrame(evt.data);
    if (frame) void dispatch(c, frame.type, frame.msg);
  };

  const begin = async (): Promise<void> => {
    try {
      if ((await getBrowserStatus()).operatorHosts !== true || !c.alive) return;
      await bridge.setTarget(origin);
      const identity = await bridge.identity();
      if (!c.alive) return;
      offs.push(...subscribeMain(c));
      ws.addEventListener("message", onMessage);
      offs.push(() => ws.removeEventListener("message", onMessage));
      c.expectHostId = identity.hostId;
      c.post({ type: "browser_host_hello", hostId: identity.hostId, publicKey: identity.publicKey });
    } catch {
      /* status or main unreachable: stay unregistered */
    }
  };

  // The shell flips to `connected` on open, but after a server switch the new
  // socket may still be connecting while the status is stale: wait for it.
  const readyState = (ws as { readyState?: number }).readyState;
  if (readyState === undefined || readyState === WS_OPEN) {
    void begin();
  } else {
    const onOpen = (): void => void begin();
    ws.addEventListener("open", onOpen, { once: true });
    offs.push(() => ws.removeEventListener("open", onOpen));
  }

  return () => {
    c.alive = false;
    if (c.timer) clearTimeout(c.timer);
    for (const off of offs) off();
    setOperatorHostId(null);
    // The server closed every link when this socket closed; end them in main too.
    for (const requestId of c.pending) swallow(bridge.cancelConnect(requestId));
    for (const linkId of c.links) swallow(bridge.extClose(linkId, LINK_GONE_CODE));
  };
}

export function OperatorHostCarrier(): React.ReactElement | null {
  const bridge = getBrowserHost();
  return bridge ? <ActiveCarrier bridge={bridge} /> : null;
}

function ActiveCarrier({ bridge }: { bridge: BrowserHostBridge }): null {
  const send = usePluginSend();
  const ws = usePluginSocket();
  const connected = useShellConnectionStatus() === "connected";
  // `send` identity may change between renders; a changed `send` must not restart a cycle.
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (!connected || !ws) return;
    const origin = targetOrigin(ws);
    if (!origin) return;
    return runCycle(bridge, ws, origin, (m) => sendRef.current(m));
  }, [bridge, connected, ws]);

  return null;
}
