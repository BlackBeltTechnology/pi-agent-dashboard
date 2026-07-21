/**
 * Sticky top-right notification for the cold-start recovery offer. Queues into
 * the same corner the dashboard uses for toasts, but never auto-times-out (a
 * recovery offer must not silently vanish). Reopen routes each candidate
 * through the normal resume flow; dismiss is non-destructive but DURABLE — it
 * sends `recovery_dismiss` to the server (which consumes the on-disk liveness
 * marker) before clearing the local bus, so the offer never re-appears on
 * reconnect, reload, or restart. Resuming any session clears the offer
 * upstream via the bus.
 * See change: fix-recovery-offer-dismiss-and-phantom-reopen.
 */
import React, { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  clearRecoveryOffer,
  type RecoveryOffer,
  subscribeRecoveryOffer,
} from "../../lib/state/recovery-offer-bus.js";

export function RecoveryOfferHost({ onReopen, onDismiss }: {
  /** Route the given candidate session ids through the resume flow. */
  onReopen: (sessionIds: string[]) => void;
  /**
   * Send `recovery_dismiss` with the offered session ids so the server
   * consumes the liveness markers (durable dismiss). Called BEFORE the local
   * bus clear. See change: fix-recovery-offer-dismiss-and-phantom-reopen.
   */
  onDismiss: (sessionIds: string[]) => void;
}) {
  const [offer, setOffer] = useState<RecoveryOffer | null>(null);

  useEffect(() => subscribeRecoveryOffer(setOffer), []);

  if (!offer) return null;
  const count = offer.candidates.length;

  const handleReopen = () => {
    onReopen(offer.candidates.map((c) => c.sessionId));
    clearRecoveryOffer();
  };

  const handleDismiss = () => {
    // Durable dismiss: tell the server to consume the liveness markers for the
    // offered sessions BEFORE clearing the local bus, so a reconnect/restart
    // never re-offers them.
    onDismiss(offer.candidates.map((c) => c.sessionId));
    clearRecoveryOffer();
  };

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      data-testid="recovery-offer-host"
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-auto flex items-center gap-3 px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm rounded-xl shadow-lg border border-[var(--border-primary)] max-w-sm"
      >
        <span className="flex-none w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
        <span className="flex-1 whitespace-nowrap font-medium">
          {i18nT("session.reopenNSessions", { count }, `Reopen ${count} session${count === 1 ? "" : "s"}?`)}
        </span>
        <button
          type="button"
          onClick={handleReopen}
          data-testid="recovery-offer-reopen"
          className="flex-none px-3 py-1 rounded-lg bg-[var(--accent-primary)] text-white font-medium hover:opacity-90"
        >
          {i18nT("common.reopen", undefined, "Reopen")}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          data-testid="recovery-offer-dismiss"
          className="flex-none leading-none text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
          title={i18nT("common.dismiss", undefined, "Dismiss")}
        >
          ×
        </button>
      </div>
    </div>
  );
}
