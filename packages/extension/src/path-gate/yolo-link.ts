/**
 * Bridge half of the gate↔server YOLO link (design D6/D7).
 *
 *  - `handleIdentity`: the server advertises `features: ["path-yolo"]` on
 *    `dashboard_identity`. Until that is seen, the link is UNSUPPORTED and `ask`
 *    resolves `decline` without sending or waiting (old server → zero added wait).
 *  - `ask`: send `path_yolo_request`, resolve on the matching `path_yolo_result`.
 *    NEVER rejects: unsent / throw / late / closed all resolve `decline`, and the
 *    caller then shows the ordinary prompt. The budget is deliberately short.
 *  - `reportRefusal`: best-effort, fire-and-forget `path_gate_refusal`.
 *  - `reset`: connection closed → pending asks decline, the flag is dropped.
 * See change: yolo-covers-agent-path-gate.
 */
import { randomUUID } from "node:crypto";

export type YoloAskVerdict = "auto-allow" | "refused" | "decline";

export const YOLO_ASK_TIMEOUT_MS = 1500;
const FEATURE = "path-yolo";

export interface YoloLinkDeps {
  /** Sends on the OPEN socket; `false` = not sent. */
  send: (msg: unknown) => boolean;
  sessionId: () => string;
  timeoutMs?: number;
  newId?: () => string;
}

export interface YoloLink {
  handleIdentity(msg: { features?: unknown }): void;
  handleResult(msg: { requestId?: unknown; verdict?: unknown }): void;
  /** True once the connected server advertised `path-yolo`. */
  supported(): boolean;
  ask(req: { path: string; access: "r" | "w"; tool: string }): Promise<YoloAskVerdict>;
  reportRefusal(req: { promptId: string; path: string; subject: string }): void;
  reset(): void;
}

export function createYoloLink(deps: YoloLinkDeps): YoloLink {
  const timeoutMs = deps.timeoutMs ?? YOLO_ASK_TIMEOUT_MS;
  const newId = deps.newId ?? randomUUID;
  let supported = false;
  const pending = new Map<string, { resolve: (v: YoloAskVerdict) => void; timer: ReturnType<typeof setTimeout> }>();

  const settle = (id: string, v: YoloAskVerdict): void => {
    const e = pending.get(id);
    if (!e) return;
    pending.delete(id);
    clearTimeout(e.timer);
    e.resolve(v);
  };

  return {
    handleIdentity(msg) {
      supported = Array.isArray(msg.features) && (msg.features as unknown[]).includes(FEATURE);
    },
    handleResult(msg) {
      if (typeof msg.requestId !== "string") return;
      const v = msg.verdict;
      settle(msg.requestId, v === "auto-allow" || v === "refused" ? v : "decline");
    },
    supported: () => supported,
    ask(req) {
      if (!supported) return Promise.resolve("decline");
      return new Promise((resolve) => {
        const requestId = newId();
        const timer = setTimeout(() => settle(requestId, "decline"), timeoutMs);
        timer.unref?.();
        pending.set(requestId, { resolve, timer });
        let sent = false;
        try {
          sent = deps.send({
            type: "path_yolo_request",
            requestId,
            sessionId: deps.sessionId(),
            path: req.path,
            access: req.access,
            tool: req.tool,
          });
        } catch {
          sent = false;
        }
        if (!sent) settle(requestId, "decline");
      });
    },
    reportRefusal(req) {
      try {
        deps.send({
          type: "path_gate_refusal",
          sessionId: deps.sessionId(),
          promptId: req.promptId,
          path: req.path,
          subject: req.subject,
        });
      } catch {
        /* best effort: the call is already blocked as denied */
      }
    },
    reset() {
      supported = false;
      for (const id of [...pending.keys()]) settle(id, "decline");
    },
  };
}
