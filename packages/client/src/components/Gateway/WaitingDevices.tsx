import { useSyncExternalStore } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { describeUserAgent } from "../../lib/pairing/describe-user-agent.js";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";

/**
 * Pending devices this tab knows about (fed by `PairingApprovalHost`), each
 * with a Review action that reopens the app-wide approval dialog. Empty — and
 * so hidden — in a paired-device browser, which never fetches the list.
 * See change: add-pairing-approval-dialog.
 */
export function WaitingDevices() {
  const { t } = useI18n();
  const { pending } = useSyncExternalStore(pairingApprovalStore.subscribe, pairingApprovalStore.getState);
  if (pending.length === 0) return null;
  return (
    <div className="mb-3" data-testid="pairing-waiting-list">
      <p className="mb-1 text-xs font-medium text-[var(--text-primary)]">
        {t("gateway.pair.waiting", undefined, "Waiting devices")}
      </p>
      <ul className="space-y-1">
        {pending.map((p) => (
          <li
            key={p.pendingId}
            data-testid="pairing-waiting-row"
            data-pending-id={p.pendingId}
            className="flex items-center gap-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs"
          >
            <span className="flex-1 break-all text-[var(--text-secondary)]">
              {describeUserAgent(p.userAgent)}
              {p.viaHost ? <span className="font-mono text-[var(--text-tertiary)]"> · {p.viaHost}</span> : null}
            </span>
            <button
              type="button"
              data-testid="pairing-waiting-review"
              onClick={() => pairingApprovalStore.review(p.pendingId)}
              className="rounded border border-[var(--border-primary)] px-2 py-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {t("gateway.pair.review", undefined, "Review")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
