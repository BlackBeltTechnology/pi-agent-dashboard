/**
 * Sticky top-right notification for the cold-start recovery offer. Queues into
 * the same corner the dashboard uses for toasts, but never auto-times-out (a
 * recovery offer must not silently vanish). Reopen routes each candidate
 * through the normal resume flow; dismiss is non-destructive. Resuming any
 * session clears the offer upstream via the bus.
 * See change: reopen-sessions-after-shutdown.
 */
import React, { useEffect, useState } from "react";
import {
  subscribeRecoveryOffer,
  clearRecoveryOffer,
  type RecoveryOffer,
} from "../lib/recovery-offer-bus.js";
import { t as i18nT } from "../lib/i18n";

export function RecoveryOfferHost({ onReopen }: {
  /** Route the given candidate session ids through the resume flow. */
  onReopen: (sessionIds: string[]) => void;
}) {
  const [offer, setOffer] = useState<RecoveryOffer | null>(null);

  useEffect(() => subscribeRecoveryOffer(setOffer), []);

  if (!offer) return null;
  const count = offer.candidates.length;

  const handleReopen = () => {
    onReopen(offer.candidates.map((c) => c.sessionId));
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
        className="pointer-events-auto flex items-center gap-3 px-3 py-2 bg-[var(--bg-elevated)] text-[var(--text-primary)] text-sm rounded-xl shadow-lg border border-[var(--border-primary)] max-w-sm"
      >
        <span className="flex-none w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
        <span className="flex-1 whitespace-nowrap font-medium">
          {i18nT("auto.reopen_n_sessions", { count }, `Reopen ${count} session${count === 1 ? "" : "s"}?`)}
        </span>
        <button
          type="button"
          onClick={handleReopen}
          data-testid="recovery-offer-reopen"
          className="flex-none px-3 py-1 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
        >
          {i18nT("auto.reopen", undefined, "Reopen")}
        </button>
        <button
          type="button"
          onClick={clearRecoveryOffer}
          data-testid="recovery-offer-dismiss"
          className="flex-none leading-none text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label={i18nT("auto.dismiss", undefined, "Dismiss")}
          title={i18nT("auto.dismiss", undefined, "Dismiss")}
        >
          ×
        </button>
      </div>
    </div>
  );
}
