/**
 * Dashboard-owned ACP file locations. Paths derive ONLY from the adapter-minted
 * dashboard session UUID — never from anything the agent reports (its own ACP
 * session id is opaque, in-memory only).
 *
 * See change: add-acp-session-driver (D6).
 */
import path from "node:path";
import { getDashboardConfigDir } from "../dashboard-paths.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertSessionUuid(sessionId: string): void {
  if (!UUID_RE.test(sessionId)) throw new Error(`invalid ACP dashboard session id: ${JSON.stringify(sessionId)}`);
}

/** `~/.pi/dashboard/acp` */
export function getAcpDir(): string {
  return path.join(getDashboardConfigDir(), "acp");
}

/** Durable event log of a durable (host B) session. */
export function acpEventLogPath(sessionId: string): string {
  assertSessionUuid(sessionId);
  return path.join(getAcpDir(), `${sessionId}.events.jsonl`);
}

/**
 * Registered as the session's `sessionFile`: the server keys `.meta.json`
 * persistence on it (`<id>.meta.json` beside it). No transcript is ever written
 * here — ACP history is the event stream, not pi JSONL.
 */
export function acpSessionFile(sessionId: string): string {
  assertSessionUuid(sessionId);
  return path.join(getAcpDir(), `${sessionId}.jsonl`);
}
