/**
 * Push transport contract. One `PushTransport` per delivery channel; a new
 * channel is one new file in `push-transports/` plus a registry entry, with no
 * change to the trigger logic, the token registry or the call site.
 * See change: add-server-push-notifications.
 */

export type PushTransportKind = "web-push" | "fcm" | "webhook";

export const PUSH_TRANSPORT_KINDS: readonly PushTransportKind[] = ["web-push", "fcm", "webhook"];

/** Device transports are delivered on the unread edge only (Decision 10). */
export function isDeviceTransport(kind: string): boolean {
  return kind === "web-push" || kind === "fcm";
}

export type PushTrigger = "turn_end" | "input" | "crash" | "test";

/** The small, session-linking payload every transport sends (Decision 5). */
export interface PushPayload {
  type: "session_attention";
  trigger: PushTrigger;
  sessionId: string;
  title: string;
  body: string;
  url: string;
}

/** The persisted token shape (`push-tokens.json`). */
export interface PushToken {
  id: string;
  /** web-push: PushSubscription JSON; fcm: device token; webhook: http(s) URL. Secret. */
  deviceToken: string;
  /** Normally a `PushTransportKind`; a persisted unknown value is skipped with a warning. */
  transport: string;
  label?: string;
  userId?: string;
  sessionFilter?: string[];
  /** Epoch ms. */
  registeredAt: number;
  /** Epoch ms. */
  lastUsedAt: number;
}

export interface PushSendResult {
  ok: boolean;
  gone?: boolean;
}

export interface PushTransport {
  kind: PushTransportKind;
  send(token: PushToken, payload: PushPayload): Promise<PushSendResult>;
}

/** Structured logger used by the push module. Fields must never carry a secret. */
export interface PushLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Default logger: one JSON line per record on the server's stdout/stderr (→ server.log). */
export const consolePushLogger: PushLogger = {
  info: (msg, fields) => console.log(`[push] ${msg}`, fields ? JSON.stringify(fields) : ""),
  warn: (msg, fields) => console.warn(`[push] ${msg}`, fields ? JSON.stringify(fields) : ""),
  error: (msg, fields) => console.error(`[push] ${msg}`, fields ? JSON.stringify(fields) : ""),
};
