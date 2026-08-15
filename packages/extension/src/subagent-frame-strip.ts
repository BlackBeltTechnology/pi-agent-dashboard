/**
 * subagent-frame-strip — drop the cumulative `details.entries[]` timeline from
 * frames describing a NON-terminal subagent, on the FORWARD path only.
 *
 * Why here (D2): the producer builds one `snapshotDetails()` object and hands
 * it to BOTH carriers (the `subagents:*` EventBus frame and the pi-core
 * `tool_execution_update`), so per-tick bytes grow linearly with run length on
 * both wire segments and in every stored event. The bridge is downstream of
 * every producer version that exists, is our code, and already retains the fat
 * snapshot for resync — so stripping here needs no producer release, no wire
 * key, no version negotiation.
 *
 * Two invariants this module exists to hold:
 *  - **Allowlist, never a negation.** `AgentStatus` also carries `"stopped"`
 *    (unemitted today); a `!terminal` test would silently strip it and lose
 *    that run's timeline forever. Only `queued`/`running` are stripped, and an
 *    absent/unknown status is never stripped.
 *  - **Clone, never mutate.** `SubagentFrameBuffer` retains frames BY
 *    REFERENCE, so an in-place strip would corrupt the very snapshot the pull
 *    path serves.
 *
 * NOT applied to terminal frames (the durable record behind `tool_execution_end`
 * backfill) nor to resync replies (the pull model's own answer).
 *
 * See change: reduce-subagent-details-payload.
 */
import { TERMINAL_CHANNELS } from "./subagent-frame-buffer.js";

/**
 * Statuses whose frames are stripped. An ALLOWLIST on purpose — a new
 * `AgentStatus` defaults to "keep the timeline", which is the safe direction.
 */
export const NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);

/** The two places a subagent `details` object sits on a frame payload. */
function detailsPathOf(
  data: Record<string, unknown>,
): { container: Record<string, unknown>; key: string } | undefined {
  const pr = data.partialResult;
  if (pr && typeof pr === "object" && !Array.isArray(pr)) {
    const prObj = pr as Record<string, unknown>;
    if (prObj.details && typeof prObj.details === "object") {
      return { container: prObj, key: "partialResult" };
    }
  }
  if (data.details && typeof data.details === "object" && !Array.isArray(data.details)) {
    return { container: data, key: "details" };
  }
  return undefined;
}

/**
 * Return a frame payload with `details.entries` removed when the frame
 * describes a `queued`/`running` subagent. Every other frame — terminal,
 * status-less, timeline-less — is returned unchanged (same reference).
 *
 * Pure: the input is never mutated. Only the objects on the mutated path are
 * copied; untouched sub-objects are shared.
 */
export function stripSubagentEntries(data: Record<string, unknown>): Record<string, unknown> {
  const path = detailsPathOf(data);
  if (!path) return data;
  const isNested = path.key === "partialResult";
  const details = (isNested ? path.container.details : data.details) as Record<string, unknown>;
  if (!Array.isArray(details.entries)) return data;
  if (typeof details.status !== "string" || !NON_TERMINAL_STATUSES.has(details.status)) return data;

  const { entries: _dropped, ...thinDetails } = details;
  if (isNested) {
    return { ...data, partialResult: { ...path.container, details: thinDetails } };
  }
  return { ...data, details: thinDetails };
}

/**
 * Rollback switch (D2). `PI_DASHBOARD_SUBAGENT_STRIP=0` forwards frames
 * unstripped and behaviour is byte-identical to pre-change: no producer,
 * protocol, or store rollback exists to do. Read per call so a session does not
 * have to restart to flip it.
 */
function isSubagentStripEnabled(): boolean {
  return process.env.PI_DASHBOARD_SUBAGENT_STRIP !== "0";
}

/**
 * The forward-path entry point: strip unless the rollback flag is off. Applied
 * at an explicit allowlist of CALL SITES (bus forward, buffered-frame flush,
 * the `tool_execution_update` carrier) rather than inside `sendEventForward` —
 * the resync reply calls that directly for a RUNNING agent and MUST stay fat.
 *
 * `channel`, when known, is a SECOND independent terminal guard: a frame on
 * `subagents:completed`/`subagents:failed` is never stripped whatever its
 * `details.status` says. The status allowlist alone would trust the producer to
 * have flipped `status` before emitting on a terminal channel; a producer that
 * emitted its last `running` snapshot there would lose that timeline forever —
 * the single highest-severity failure mode in this design. Both signals have to
 * be wrong for that to happen now.
 */
export function stripForForward(
  data: Record<string, unknown>,
  channel?: string,
): Record<string, unknown> {
  if (!isSubagentStripEnabled()) return data;
  if (channel !== undefined && TERMINAL_CHANNELS.has(channel)) return data;
  return stripSubagentEntries(data);
}
