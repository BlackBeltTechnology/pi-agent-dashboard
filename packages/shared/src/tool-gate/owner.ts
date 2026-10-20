/**
 * Tool-gate owner slot — which in-session gate owns a session's tool calls.
 *
 * pi loads every extension through jiti with `moduleCache: false`, so a
 * module-level variable would be a different copy in the chat-gateway guard
 * and in the dashboard bridge. State therefore lives on `globalThis` under a
 * `Symbol.for` key (process-global, shared across module instances).
 *
 * Not a trust boundary: any in-process extension can already patch the
 * bridge's handlers.
 * See change: add-supervised-tool-approval (design D12).
 */

export type ToolGateOwner = "chat-gateway";

const SLOT = Symbol.for("pi-dashboard.toolGateOwner");

function slot(): Map<string, ToolGateOwner> {
  const g = globalThis as Record<symbol, unknown>;
  let map = g[SLOT] as Map<string, ToolGateOwner> | undefined;
  if (!(map instanceof Map)) {
    map = new Map();
    g[SLOT] = map;
  }
  return map;
}

export function markToolGateOwner(sessionId: string, owner: ToolGateOwner): void {
  slot().set(sessionId, owner);
}

export function clearToolGateOwner(sessionId: string): void {
  slot().delete(sessionId);
}

export function toolGateOwner(sessionId: string): ToolGateOwner | undefined {
  return slot().get(sessionId);
}
