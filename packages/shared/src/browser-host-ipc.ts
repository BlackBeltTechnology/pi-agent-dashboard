/**
 * Contract of `window.piDashboard.browserHost` — the narrow, trusted-sender-only
 * IPC surface between the dashboard SPA's `OperatorHostCarrier` (renderer) and
 * Electron main's operator browser host. Types only + channel names; no runtime
 * dependencies, so both the Electron package and the browser plugin import it.
 *
 * Direction legend: R→M renderer→main (invoke), M→R main→renderer (event).
 * The private key and pairing tokens NEVER appear in any return value or event.
 *
 * Deviation from the spec's name list (design D9), recorded here as the single
 * source of truth: `setTarget` (R→M) tells main which dashboard server the
 * SPA's `/ws` currently targets (needed for the `instanceId` fetch behind
 * `sign` and for consent keys); `connect` (R→M) delivers a server
 * `browser_host_connect`; `onConnect` (M→R) is main's answer stream
 * (`{requestId, ok, reason?}` → carrier forwards `browser_host_connect_result`),
 * so `respondConnect` stays main-internal and is not exposed to the renderer.
 *
 * See change: add-operator-browser-relay.
 */
import type { BrowserHostProfileRow } from "./browser-protocol.js";

export interface BrowserHostIdentity {
  hostId: string;
  /** Ed25519 public key, base64 of SPKI DER. */
  publicKey: string;
  label: string;
  platform: string;
  canOpenChrome: boolean;
  profiles: BrowserHostProfileRow[];
}

/** R→M: the server's `browser_host_connect`, minus the message type. */
export interface BrowserHostConnectRequest {
  requestId: string;
  linkId: string;
  instanceId: string;
  profileDirectory: string;
  serverLabel: string;
}

/** M→R: main's answer to a connect request. */
export interface BrowserHostConnectAnswer {
  requestId: string;
  ok: boolean;
  /** `denied` | `no-chrome` | `server-unverified` | other launch-failure token. */
  reason?: string;
}

/** M→R: one extension-side event on a link. */
export type BrowserHostExtEvent =
  | { kind: "open"; linkId: string }
  | { kind: "data"; linkId: string; data: string }
  | { kind: "close"; linkId: string; code: number };

/** M→R: one teed `Page.screencastFrame`. */
export interface BrowserHostFrame {
  instanceId: string;
  tabId: number;
  jpegBase64: string;
  metadata: { deviceWidth: number; deviceHeight: number; timestamp: number };
}

/** One stored "Always allow". `key` is opaque; `serverLabel`/`profileLabel` are display text. */
export interface BrowserHostConsentRow {
  key: string;
  serverOrigin: string;
  profileDirectory: string;
  grantedAt: number;
}

export type Unsubscribe = () => void;

export interface BrowserHostBridge {
  identity(): Promise<BrowserHostIdentity>;
  /** Refuses (rejects) unless `serverId` equals the target's fetched `/api/health` `instanceId`. */
  sign(nonce: string, serverId: string): Promise<string>;
  setTarget(origin: string): Promise<void>;
  connect(req: BrowserHostConnectRequest): Promise<void>;
  onConnect(cb: (answer: BrowserHostConnectAnswer) => void): Unsubscribe;
  cancelConnect(requestId: string): Promise<void>;
  extSend(linkId: string, data: string): Promise<void>;
  extClose(linkId: string, code: number): Promise<void>;
  onExt(cb: (ev: BrowserHostExtEvent) => void): Unsubscribe;
  tee(linkId: string, instanceId: string, tabId: number, on: boolean): Promise<void>;
  onFrame(cb: (frame: BrowserHostFrame) => void): Unsubscribe;
  setToken(profileDirectory: string, token: string | null): Promise<void>;
  listConsents(): Promise<BrowserHostConsentRow[]>;
  revokeConsent(key: string): Promise<void>;
}

/** IPC channel names, shared by preload and main. */
export const BROWSER_HOST_CHANNELS = {
  identity: "browser-host:identity",
  sign: "browser-host:sign",
  setTarget: "browser-host:set-target",
  connect: "browser-host:connect",
  connectAnswer: "browser-host:connect-answer",
  cancelConnect: "browser-host:cancel-connect",
  extSend: "browser-host:ext-send",
  extClose: "browser-host:ext-close",
  extEvent: "browser-host:ext-event",
  tee: "browser-host:tee",
  frame: "browser-host:frame",
  setToken: "browser-host:set-token",
  listConsents: "browser-host:list-consents",
  revokeConsent: "browser-host:revoke-consent",
} as const;
