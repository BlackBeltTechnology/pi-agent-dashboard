/**
 * Pure session-name provenance lattice (`auto | system | user`) — server side.
 *
 * `user` is terminal. The server is authoritative for persistence: it tags the
 * senders of `rename_session`, owns the `nameSourceFor` witness (the name the
 * provenance was recorded FOR), and guards bridge `session_name_update` claims
 * so a restart relabel / old-bridge echo cannot downgrade provenance.
 * See change: investigate-auto-name-provenance-relabel (D1, D2, D4).
 */
import type { AutoNameStateRestoreMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { sanitizeSessionName } from "@blackbelt-technology/pi-dashboard-shared/session-name.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

type NameFields = Pick<DashboardSession, "name" | "nameSource" | "nameSourceFor">;
type NameUpdates = Partial<NameFields>;

/** A dashboard-initiated user rename (browser / REST): terminal `user`, witness cleared. */
export function userRenameUpdates(name: string | undefined): NameUpdates {
  return { name: name || undefined, nameSource: "user", nameSourceFor: undefined };
}

/**
 * A dashboard SYSTEM rename (attach / detach revert / plugin). Never downgrades
 * `user` (the name may still change); non-empty N → `system` + witness N;
 * `""` (detach revert) → provenance and witness cleared.
 */
export function systemRenameUpdates(session: Pick<DashboardSession, "nameSource"> | undefined, name: string): NameUpdates {
  if (session?.nameSource === "user") return { name: name || undefined };
  if (name === "") return { name: undefined, nameSource: undefined, nameSourceFor: undefined };
  return { name, nameSource: "system", nameSourceFor: name };
}

/**
 * Guard a bridge `session_name_update`. Returns the updates to apply, or
 * `undefined` when the whole claim must be dropped (an `auto` claim racing a
 * server-owned `system`/`user` name — the server's own rename converges pi).
 */
export function guardBridgeNameClaim(
  session: Pick<DashboardSession, "nameSource" | "nameSourceFor"> | undefined,
  name: string,
  claim: "auto" | "user" | "system" | undefined,
): NameUpdates | undefined {
  const cur = session?.nameSource;
  const plain = name || undefined;
  if (claim === "auto") {
    if (cur === "system" || cur === "user") return undefined;
    return { name: plain, nameSource: "auto", nameSourceFor: name || undefined };
  }
  if (claim === "user") {
    const witness = session?.nameSourceFor;
    if ((cur === "auto" || cur === "system") && witness !== undefined && sanitizeSessionName(name) === sanitizeSessionName(witness)) {
      return { name: plain }; // the claim is the relabel artefact: keep provenance
    }
    return { name: plain, nameSource: "user", nameSourceFor: undefined };
  }
  return { name: plain }; // unattributed poll: keep provenance and witness
}

/**
 * Build the register-time `auto_name_state_restore`, or `undefined` when the
 * session carries neither a namer state nor provenance. Provenance comes from
 * the SESSION (never the bridge-persisted state, which an old bridge may have
 * overwritten). A stop WITHOUT `stopCause` is a `user`-latch artefact: it is
 * cleared when provenance ≠ `user`.
 */
export function buildAutoNameRestore(
  session: Pick<DashboardSession, "autoNamerState" | "nameSource" | "nameSourceFor"> | undefined,
): AutoNameStateRestoreMessage | undefined {
  const st = session?.autoNamerState;
  const source = session?.nameSource;
  if (!st && !source) return undefined;
  const clearStop = !!st && !st.stopCause && source !== undefined && source !== "user";
  return {
    type: "auto_name_state_restore",
    state: restoreStopState(st, source, clearStop),
    ...(source ? { nameSource: source } : {}),
    ...(session?.nameSourceFor !== undefined ? { nameSourceFor: session.nameSourceFor } : {}),
  };
}

const ZERO_STOP = { hardStopped: false, errorEmitted: false, attemptsUsed: 0, starvedCount: 0, waitingCount: 0, sawStarved: false };

/** The STOP projection: cleared (all zero) for a `user`-latch artefact; `user` provenance is a permanent stop. */
function restoreStopState(
  st: DashboardSession["autoNamerState"],
  source: DashboardSession["nameSource"],
  clearStop: boolean,
): AutoNameStateRestoreMessage["state"] {
  if (clearStop) return { ...ZERO_STOP, stopCause: st?.stopCause };
  const base = st ?? ZERO_STOP;
  return {
    hardStopped: source === "user" ? true : base.hardStopped,
    errorEmitted: base.errorEmitted,
    attemptsUsed: base.attemptsUsed,
    starvedCount: base.starvedCount,
    waitingCount: base.waitingCount,
    sawStarved: base.sawStarved,
    stoppedModelRef: st?.stoppedModelRef,
    stopCause: st?.stopCause,
    stoppedReason: st?.stoppedReason,
  };
}
