/**
 * Trusted-plugin → session emit seams (`emitEventToSession`, `sendExtensionMessage`).
 * Refuses reserved host namespaces and the raw `plugin_emit_event` lane so a plugin
 * cannot fire privileged `pi.events` listeners (roles:, model:, dashboard:, …).
 * See change: harden-trust-and-credential-boundaries (D3).
 */
import { isReservedEventType } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

type Send = (sessionId: string, msg: any) => boolean;

export function emitEventToSession(
  trusted: boolean,
  send: Send,
  sessionId: string,
  eventType: string,
  data: Record<string, unknown> | undefined,
): boolean {
  if (!trusted) return false;
  if (typeof eventType !== "string" || eventType.length === 0) return false;
  if (isReservedEventType(eventType)) {
    console.warn(`[plugin] refused emitEventToSession: reserved event namespace "${eventType}"`);
    return false;
  }
  return send(sessionId, { type: "plugin_emit_event", sessionId, eventType, data: data ?? {} });
}

export function sendExtensionMessage(
  trusted: boolean,
  send: Send,
  sessionId: string,
  msg: unknown,
): boolean {
  if (!trusted) return false;
  if ((msg as { type?: unknown } | null)?.type === "plugin_emit_event") {
    console.warn("[plugin] refused sendExtensionMessage: plugin_emit_event must use emitEventToSession");
    return false;
  }
  return send(sessionId, msg);
}
