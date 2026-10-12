/**
 * `session/request_permission` ↔ dashboard interactive prompt.
 *
 * The prompt frame is byte-shaped like the one the extension's prompt bus emits
 * for a `select` prompt (`generic-dialog` component, `inline` placement), so the
 * existing client dialog renders it. The chosen option NAME comes back as the
 * `prompt_response` answer and maps to `{outcome:"selected", optionId}`;
 * dismissal / abort / close → `{outcome:"cancelled"}`.
 *
 * See change: add-acp-session-driver (D9).
 */
import { randomUUID } from "node:crypto";
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

export type PermissionOutcome = { outcome: "selected"; optionId: string } | { outcome: "cancelled" };

interface Pending {
  frame: Extract<ExtensionToServerMessage, { type: "prompt_request" }>;
  options: Array<{ optionId: string; label: string }>;
  resolve: (o: PermissionOutcome) => void;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Distinct, non-empty labels: duplicate / missing names get a positional suffix. */
function labelOptions(raw: unknown): Array<{ optionId: string; label: string }> {
  const out: Array<{ optionId: string; label: string }> = [];
  const seen = new Set<string>();
  for (const [i, o] of (Array.isArray(raw) ? raw : []).entries()) {
    if (!isRec(o) || typeof o.optionId !== "string") continue;
    let label = typeof o.name === "string" && o.name !== "" ? o.name : o.optionId;
    if (seen.has(label)) label = `${label} (${i + 1})`;
    seen.add(label);
    out.push({ optionId: o.optionId, label });
  }
  return out;
}

function questionOf(params: Record<string, unknown>): string {
  if (typeof params.title === "string" && params.title !== "") return params.title; // v2
  const tool = params.toolCall;
  if (isRec(tool) && typeof tool.title === "string" && tool.title !== "") return tool.title; // v1
  return "The agent requests permission";
}

export interface PermissionBridge {
  /** Show the prompt; resolves with the outcome the agent expects. */
  request(params: unknown): Promise<PermissionOutcome>;
  /** `prompt_response` from the dashboard. Returns whether it matched a pending prompt. */
  respond(promptId: string, answer: string | undefined, cancelled: boolean | undefined): boolean;
  /** Answer every pending request `cancelled` and tell the dashboard to drop the dialogs. */
  cancelAll(): void;
  /** Re-send every pending prompt as a fresh `prompt_request` (reattach / resync). */
  resend(resyncRequestId?: string): void;
  hasPending(): boolean;
}

export function createPermissionBridge(
  sessionId: string,
  send: (m: ExtensionToServerMessage) => void,
  hooks: { onAnswered?: () => void } = {},
): PermissionBridge {
  const pending = new Map<string, Pending>();

  return {
    request(raw) {
      const params = isRec(raw) ? raw : {};
      const options = labelOptions(params.options);
      if (options.length === 0) return Promise.resolve({ outcome: "cancelled" });
      const promptId = randomUUID();
      const question = questionOf(params);
      const frame = {
        type: "prompt_request" as const,
        sessionId,
        promptId,
        prompt: { question, type: "select", options: options.map((o) => o.label), defaultValue: undefined, pipeline: "command", metadata: { source: "acp" } },
        component: { type: "generic-dialog", props: { question, type: "select", options: options.map((o) => o.label), defaultValue: undefined } },
        placement: "inline",
      };
      return new Promise<PermissionOutcome>((resolve) => {
        pending.set(promptId, { frame, options, resolve });
        send(frame);
      });
    },
    respond(promptId, answer, cancelled) {
      const p = pending.get(promptId);
      if (!p) return false;
      pending.delete(promptId);
      const chosen = cancelled ? undefined : p.options.find((o) => o.label === answer);
      p.resolve(chosen ? { outcome: "selected", optionId: chosen.optionId } : { outcome: "cancelled" });
      hooks.onAnswered?.();
      return true;
    },
    cancelAll() {
      for (const [promptId, p] of pending) {
        p.resolve({ outcome: "cancelled" });
        send({ type: "prompt_cancel", sessionId, promptId });
      }
      pending.clear();
    },
    resend(resyncRequestId) {
      for (const p of pending.values()) send({ ...p.frame, ...(resyncRequestId ? { __resyncRequestId: resyncRequestId } : {}) });
    },
    hasPending: () => pending.size > 0,
  };
}
