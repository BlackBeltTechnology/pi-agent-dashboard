/**
 * Exit-intent vocabulary for the server boot record, plus the single mapping
 * that decides whether a boot's sessions may be offered for recovery.
 *
 * Cold-start recovery used to infer "the host crashed" from the ABSENCE of
 * cleanup (`live:true` still on disk). That inference only holds if every
 * deliberate exit clears the marker, and the set of exit paths is open — so
 * `/api/restart` (which never clears anything) read as a crash while an idle
 * auto-stop (which cleared everything) erased a genuine crash signal.
 *
 * The record inverts the signal: each deliberate exit writes what it was.
 * A crash writes nothing, so `null` is the closed definition of a dirty boot.
 *
 * See change: fix-recovery-exit-intent (D1/D2).
 */

/** What ended a server boot. `null` = nothing recorded it, i.e. a crash. */
export type ExitIntent = "restart" | "shutdown" | "user-quit" | "idle" | "signal";

/** One boot's outcome, as retained in the record's ring. */
export interface BootRecord {
  /** The boot's id — the server's `liveEpoch`, also stamped into session sidecars. */
  bootId: number;
  exitIntent: ExitIntent | null;
  /** Epoch ms of the last write to this entry. */
  at: number;
}

/**
 * `~/.pi/dashboard/boot-state.json`. The current boot plus a bounded ring of
 * prior boots, so a session's owning boot is still resolvable after several
 * consecutive dirty boots.
 */
export interface BootState extends BootRecord {
  ring: BootRecord[];
}

/** Prior boots retained beside the current one. */
export const BOOT_RING_SIZE = 8;

/**
 * Exits after which the sessions are still running and WILL reattach — and
 * will do so LATER than the reattach grace window, because the same exit told
 * every bridge to stay away for longer than that window (5 s for a restart,
 * 60 s for a shutdown). Offering those sessions would be a phantom offer that
 * no liveness gate can retract in time, so they are suppressed outright, with
 * no timing dependency.
 *
 * Every other exit — `idle` (which SIGTERMs every spawned pi), `signal`,
 * a user quit, or a crash — leaves recovery to the liveness gate: offer it,
 * and retract whatever proves alive inside the grace window. That is the
 * "only offer sessions that can never reattach" rule, decided by evidence
 * instead of by guessing at the user's intent.
 */
const RECOVERY_SUPPRESSING: ReadonlySet<ExitIntent> = new Set<ExitIntent>(["restart", "shutdown"]);

/**
 * May a boot that ended with `intent` have its sessions offered for recovery?
 * An unknown / absent intent (`null`, pre-upgrade record, unresolvable boot id)
 * is ALLOWED, so this can never under-offer relative to the old behaviour.
 */
export function isRecoveryAllowed(intent: ExitIntent | null | undefined): boolean {
  return intent == null || !RECOVERY_SUPPRESSING.has(intent);
}
