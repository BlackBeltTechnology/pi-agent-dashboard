import { mdiCellphoneLink, mdiLanConnect, mdiLockOpenVariantOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useSyncExternalStore } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { describeUserAgent } from "../../lib/pairing/describe-user-agent.js";
import type { PendingPairing } from "../../lib/pairing/pairing-approval-api.js";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";

const PILL = "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium";

function WaitingRow({ p }: { p: PendingPairing }) {
  const { t } = useI18n();
  const knock = p.provenance === "knock";
  const address = p.remoteAddress ?? "—";
  return (
      <li
        data-testid="pairing-waiting-row"
        data-pending-id={p.pendingId}
        className="flex flex-wrap items-center gap-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs"
      >
        <span
          data-testid="pairing-waiting-provenance"
          className={`${PILL} ${
            knock
              ? "bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]"
              : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
          }`}
        >
          <Icon path={knock ? mdiLanConnect : mdiCellphoneLink} size={0.5} aria-hidden="true" />
          {knock
            ? t("gateway.pair.provenanceKnock", undefined, "Network request")
            : t("gateway.pair.provenanceQr", undefined, "Pairing link")}
        </span>
        <span className="min-w-0 flex-[1_1_14rem] break-words text-[var(--text-secondary)]">
          {knock ? (
            <>
              <b className="font-mono font-semibold text-[var(--text-primary)]">{address}</b>
              {p.requesterName ? (
                <> · {t("gateway.pair.says", { name: p.requesterName }, "says “{name}”")}</>
              ) : null}
              {" · "}
              {describeUserAgent(p.userAgent)}
            </>
          ) : (
            <>
              {describeUserAgent(p.userAgent)}
              {p.viaHost ? <span className="font-mono text-[var(--text-tertiary)]"> · {p.viaHost}</span> : null}
            </>
          )}
        </span>
        {knock && p.unencrypted ? (
          <span className={`${PILL} bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]`}>
            <Icon path={mdiLockOpenVariantOutline} size={0.5} aria-hidden="true" />
            {t("gateway.pair.unencrypted", undefined, "Unencrypted")}
          </span>
        ) : null}
        <button
          type="button"
          data-testid="pairing-waiting-review"
          aria-label={
            knock
              ? t("gateway.pair.reviewKnock", { address }, "Review request from {address}")
              : t("gateway.pair.reviewQr", undefined, "Review pairing link request")
          }
          onClick={() => pairingApprovalStore.review(p.pendingId)}
          className="min-h-11 rounded border border-[var(--border-primary)] px-2 py-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] sm:min-h-8"
        >
          {t("gateway.pair.review", undefined, "Review")}
        </button>
      </li>
  );
}

/**
 * Pending devices this tab knows about (fed by `PairingApprovalHost`), each
 * with a Review action that reopens the app-wide approval dialog. Empty — and
 * so hidden — in a paired-device browser, which never fetches the list.
 * A network request ("knock") leads with its observed address; the name it
 * typed is untrusted and shown only as `says “…”`.
 * See change: add-pairing-approval-dialog, add-lan-knock-pairing (ui-plan D13).
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
          <WaitingRow key={p.pendingId} p={p} />
        ))}
      </ul>
    </div>
  );
}
