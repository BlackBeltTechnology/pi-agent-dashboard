/**
 * "This browser couldn't keep its access" notice shared by the QR landing and
 * the request landing. Shown when `finishDevicePairing` kept the bearer because
 * the device cookie could not be proven (it still authenticates this browser).
 *
 * See change: add-lan-knock-pairing (D15, ui-plan `landing.request.keepFailed`).
 */
import { mdiAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { CALLOUT_WARNING, LANDING_PRIMARY } from "./pair-landing-ui.js";

export function PairKeepFailedNotice({ onOpen, children }: { onOpen: () => void; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div data-testid="pair-landing-keep-failed-box" className="space-y-3">
      <div
        data-testid="pair-landing-keep-failed"
        role="alert"
        className={CALLOUT_WARNING}
      >
        <Icon path={mdiAlertOutline} size={0.8} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          {t(
            "landing.request.keepFailed",
            undefined,
            "This browser couldn't keep its access. Check that cookies are allowed, then request again.",
          )}
        </p>
      </div>
      <button type="button" data-testid="pair-landing-open" onClick={onOpen} className={LANDING_PRIMARY}>
        {t("landing.openDashboard", undefined, "Open the dashboard")}
      </button>
      {children}
    </div>
  );
}
