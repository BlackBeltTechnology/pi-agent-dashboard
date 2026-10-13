/**
 * Stateful ACP v1 → v2 update normaliser (one instance per session).
 *
 * v1 `session/update` payloads are rewritten into the v2 model of
 * `update-model.ts`; v2-shaped payloads pass straight through
 * `parseSessionUpdate`. v1 has no foreground-state notifications, so the
 * caller reports prompt dispatch / permission / resolution and the normaliser
 * emits the matching `state_update`.
 *
 * See change: add-acp-session-driver (acp-update-model, "v1 to v2 normalisation").
 */

import { type AcpUpdate, parseSessionUpdate } from "./update-model.js";

export interface V1Normalizer {
  /** Convert one v1 (or v2-shaped) `session/update` payload. */
  update(raw: unknown): AcpUpdate[];
  /** `session/prompt` written → `state_update running`. */
  promptDispatched(): AcpUpdate[];
  /** Pending `session/request_permission` → `state_update requires_action`. */
  permissionRequested(): AcpUpdate[];
  /** Permission answered → `state_update running`. */
  permissionAnswered(): AcpUpdate[];
  /** `session/prompt` response `stopReason` → exactly one `state_update idle`. */
  promptResolved(stopReason?: string | null): AcpUpdate[];
}

type RunKind = "user" | "agent" | "thought";

const CHUNK_KIND: Record<string, RunKind> = {
  user_message_chunk: "user",
  agent_message_chunk: "agent",
  agent_thought_chunk: "thought",
};

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function createV1Normalizer(): V1Normalizer {
  let runKind: RunKind | null = null;
  let runSeq = 0;
  let runId = "";

  const state = (s: "running" | "requires_action"): AcpUpdate[] => {
    runKind = null;
    return [{ kind: "state_update", state: s }];
  };

  /** Stable synthetic id per contiguous same-kind run when the agent sent none. */
  const chunk = (raw: Record<string, unknown>, kind: RunKind): AcpUpdate[] => {
    let messageId = typeof raw.messageId === "string" ? raw.messageId : undefined;
    if (messageId === undefined) {
      if (runKind !== kind) {
        runSeq += 1;
        runId = `acp-v1-${kind}-${runSeq}`;
      }
      messageId = runId;
    }
    runKind = kind;
    return [parseSessionUpdate({ ...raw, messageId })];
  };

  const toolCall = (raw: Record<string, unknown>): AcpUpdate[] => {
    runKind = null;
    return [parseSessionUpdate({ ...raw, sessionUpdate: "tool_call_update" })];
  };

  return {
    update(raw: unknown): AcpUpdate[] {
      if (!isRec(raw) || typeof raw.sessionUpdate !== "string") return [parseSessionUpdate(raw)];
      const tag = raw.sessionUpdate;
      const chunkKind = CHUNK_KIND[tag];
      if (chunkKind) return chunk(raw, chunkKind);
      if (tag === "tool_call" || tag === "tool_call_update") return toolCall(raw);
      if (tag === "plan") return [parseSessionUpdate({ sessionUpdate: "plan_update", plan: { type: "items", planId: "default", entries: raw.entries } })];
      if (tag === "current_mode_update") return [parseSessionUpdate(modeAsConfigOption(raw.currentModeId))];
      return [parseSessionUpdate(raw)];
    },
    promptDispatched: () => state("running"),
    permissionRequested: () => state("requires_action"),
    permissionAnswered: () => state("running"),
    promptResolved(stopReason) {
      runKind = null;
      return [{ kind: "state_update", state: "idle", stopReason: stopReason ?? null }];
    },
  };
}

const modeAsConfigOption = (currentModeId: unknown) => ({
  sessionUpdate: "config_option_update",
  configOptions: [{ configId: "mode", name: "Mode", category: "mode", type: "select", currentValue: currentModeId }],
});
