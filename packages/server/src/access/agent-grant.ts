/**
 * Server handling of a bridge `path_grant_request` (D3): session-connection
 * binding → confirm-registry match (single use) → subject re-derivation (refuse
 * on change) → `isUngrantableSubject` → `recordGrant({scope:"project",
 * via:"agent-prompt"})`. The bridge never writes the store.
 * See change: ask-agent-file-access-in-chat.
 */

import { isSameSubject } from "@blackbelt-technology/pi-dashboard-shared/canonical-subject.js";
import * as fs from "node:fs";
import nodePath from "node:path";
import { isUngrantableSubject, realpathNearestAncestor } from "@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js";
import type { PathGrantRequestMessage, PathGrantResultMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { recordGrant } from "./access-grants.js";
import type { AgentConfirmRegistry } from "./agent-confirm-registry.js";

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

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

  // Re-derive the subject from the confirmed PATH now, by the gate's rule (the path
  // itself when it is a directory, else its containing directory; realpath'd) and
  // require it to equal what the confirmation named. Deriving from the claimed
  // subject alone would let a confirm naming an ancestor persist that ancestor; a
  // path that became a directory (or a swapped symlink) since the prompt derives a
  // different subject and is refused rather than persisted under a name the
  // operator never saw.
  const real = realpathNearestAncestor(msg.path);
  const rederived = isDirectory(real) ? real : nodePath.dirname(real);
  if (rederived !== consumed.subject) return refuse("subject does not match the confirmed path");
  if (isUngrantableSubject(rederived)) return refuse("forbidden subject");

  const result = recordGrant({ subject: rederived, scope: "project", origin: connectionSessionId, via: "agent-prompt" });
  if (!result.ok) return refuse(result.error ?? "write failed");
  log(`[path-gate] grant accepted session=${connectionSessionId} subject=${result.grant.subject}`);
  return { type: "path_grant_result", requestId: msg.requestId, ok: true, subject: result.grant.subject };
}
