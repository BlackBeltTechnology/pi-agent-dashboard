/**
 * Server handling of a bridge `path_grant_request` (D3): session-connection
 * binding → confirm-registry match (single use) → subject re-derivation (refuse
 * on change) → `isUngrantableSubject` → `recordGrant({scope:"project",
 * via:"agent-prompt"})`. The bridge never writes the store.
 * See change: ask-agent-file-access-in-chat.
 */

import { isSameSubject } from "@blackbelt-technology/pi-dashboard-shared/canonical-subject.js";
import { isUngrantableSubject } from "@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js";
import type { PathGrantRequestMessage, PathGrantResultMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { normalizeGrantSubject, recordGrant } from "./access-grants.js";
import type { AgentConfirmRegistry } from "./agent-confirm-registry.js";

export interface AgentGrantDeps {
  registry: AgentConfirmRegistry;
  log?: (line: string) => void;
}

export function handlePathGrantRequest(
  /** The gateway's own socket key for this connection — never trusted from the body. */
  connectionSessionId: string,
  msg: PathGrantRequestMessage,
  deps: AgentGrantDeps,
): PathGrantResultMessage {
  const log = deps.log ?? ((l: string) => console.log(l));
  const refuse = (error: string): PathGrantResultMessage => {
    log(`[path-gate] grant refused session=${connectionSessionId} cause=${error}`);
    return { type: "path_grant_result", requestId: msg.requestId, ok: false, error };
  };
  if (
    typeof msg.requestId !== "string" ||
    typeof msg.promptId !== "string" ||
    typeof msg.path !== "string" ||
    typeof msg.subject !== "string"
  ) {
    return refuse("malformed request");
  }
  if (msg.sessionId !== connectionSessionId) return refuse("session mismatch");

  const consumed = deps.registry.consume(connectionSessionId, msg.promptId, { path: msg.path, subject: msg.subject }, isSameSubject);
  if (!consumed.ok) return refuse(consumed.error);

  // Re-derive now: a directory created / renamed / symlink-swapped between the
  // prompt and this grant must not persist under a name the operator never saw.
  // Compared as strings against the subject the registry recorded (the gate sent
  // a realpath'd directory): a swapped symlink re-derives to a different path.
  const rederived = normalizeGrantSubject(consumed.subject);
  if (rederived !== consumed.subject) return refuse("subject changed since confirmation");
  if (isUngrantableSubject(rederived)) return refuse("forbidden subject");

  const result = recordGrant({ subject: rederived, scope: "project", origin: connectionSessionId, via: "agent-prompt" });
  if (!result.ok) return refuse(result.error ?? "write failed");
  log(`[path-gate] grant accepted session=${connectionSessionId} subject=${result.grant.subject}`);
  return { type: "path_grant_result", requestId: msg.requestId, ok: true, subject: result.grant.subject };
}
