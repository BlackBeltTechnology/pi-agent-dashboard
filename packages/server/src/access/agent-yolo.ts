/**
 * Server handling of the agent path gate's YOLO frames (design D5):
 *   - `path_yolo_request` → `path_yolo_result` (session-bound; verdict from the
 *     YOLO controller, never from the body);
 *   - `path_gate_refusal` (fire-and-forget) → `recordRefusal("agent-path", subject)`,
 *     bound to a select prompt the server actually saw raised (registry `select`
 *     kind), with the subject re-derived from the path by the gate rule.
 * See change: yolo-covers-agent-path-gate.
 */
import * as fs from "node:fs";
import nodePath from "node:path";
import { isSameSubject } from "@blackbelt-technology/pi-dashboard-shared/canonical-subject.js";
import { realpathNearestAncestor } from "@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js";
import type {
  PathGateRefusalMessage,
  PathYoloRequestMessage,
  PathYoloResultMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { AgentConfirmRegistry } from "./agent-confirm-registry.js";

export type YoloAgentVerdict = "auto-allow" | "refused-by-prior-refusal" | null;

export interface AgentYoloDeps {
  /** Lazy: absent (YOLO not constructed yet) → every request declines. */
  decideAgentPath?: (path: string) => YoloAgentVerdict;
  registry: AgentConfirmRegistry;
  recordRefusal: (plane: "agent-path", subject: string) => unknown;
  log?: (line: string) => void;
}

function makeLog(deps: AgentYoloDeps): (line: string) => void {
  const sink = deps.log ?? ((l: string) => console.log(l));
  // Paths / ids are attacker-influenced: strip control characters at the single emission point.
  return (line) => sink(line.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "?"));
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function handlePathYoloRequest(
  /** The gateway's own socket key — never trusted from the body. */
  connectionSessionId: string,
  msg: PathYoloRequestMessage,
  deps: AgentYoloDeps,
): PathYoloResultMessage {
  const log = makeLog(deps);
  const requestId = typeof msg?.requestId === "string" ? msg.requestId : "";
  const decline = (cause: string): PathYoloResultMessage => {
    log(`[path-gate] yolo declined session=${connectionSessionId} cause=${cause}`);
    return { type: "path_yolo_result", requestId, verdict: "decline" };
  };
  if (typeof msg?.requestId !== "string" || msg.requestId === "" || typeof msg.path !== "string" || !nodePath.isAbsolute(msg.path)) {
    return decline("malformed request");
  }
  if (msg.sessionId !== connectionSessionId) return decline("session mismatch");
  if (!deps.decideAgentPath) return decline("yolo unavailable");
  let verdict: YoloAgentVerdict;
  try {
    verdict = deps.decideAgentPath(msg.path);
  } catch {
    return decline("yolo error");
  }
  const mapped = verdict === "auto-allow" ? "auto-allow" : verdict === "refused-by-prior-refusal" ? "refused" : "decline";
  return { type: "path_yolo_result", requestId: msg.requestId, verdict: mapped };
}

export function handlePathGateRefusal(connectionSessionId: string, msg: PathGateRefusalMessage, deps: AgentYoloDeps): void {
  const log = makeLog(deps);
  const drop = (cause: string): void => log(`[path-gate] refusal not recorded session=${connectionSessionId} cause=${cause}`);
  if (
    typeof msg?.promptId !== "string" ||
    typeof msg.path !== "string" ||
    typeof msg.subject !== "string" ||
    !nodePath.isAbsolute(msg.path)
  ) {
    return drop("malformed request");
  }
  if (msg.sessionId !== connectionSessionId) return drop("session mismatch");
  const consumed = deps.registry.consume(
    connectionSessionId,
    msg.promptId,
    { path: msg.path, subject: msg.subject },
    isSameSubject,
    "select",
  );
  if (!consumed.ok) return drop(consumed.error);
  const real = realpathNearestAncestor(msg.path);
  const subject = isDirectory(real) ? real : nodePath.dirname(real);
  if (subject !== consumed.subject && !isSameSubject(subject, consumed.subject)) return drop("subject mismatch");
  deps.recordRefusal("agent-path", subject);
  log(`[path-gate] refusal recorded session=${connectionSessionId} subject=${subject}`);
}
