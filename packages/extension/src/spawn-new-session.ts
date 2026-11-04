/**
 * Build the bridge's `spawn_new_session` frame. The new session inherits the
 * requesting session's model + thinking level when known. Infallible: any throw
 * from reading the bridge context falls back to the plain frame.
 *
 * See change: add-spawn-model-choice (design D5).
 */
import type { SpawnNewSessionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { type BridgeContext, getCurrentModelString } from "./bridge-context.js";

export function buildSpawnNewSessionMessage(sessionId: string, cwd: string, readBc: () => BridgeContext): SpawnNewSessionMessage {
  const base: SpawnNewSessionMessage = { type: "spawn_new_session", sessionId, cwd };
  try {
    const bc = readBc();
    const model = getCurrentModelString(bc);
    if (!model) return base;
    const level: unknown = (bc.pi as { getThinkingLevel?: () => unknown }).getThinkingLevel?.();
    return { ...base, model, ...(typeof level === "string" && level.length > 0 ? { thinkingLevel: level } : {}) };
  } catch {
    return base;
  }
}
