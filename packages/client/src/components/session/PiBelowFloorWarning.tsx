/**
 * Warning for a session whose running pi is below the dashboard's lockstep
 * floor. The server derives `piBelowFloor` from the bridge-reported
 * (argv-anchored) `piVersion`; this replaces the retired per-feature pi version
 * gates with one generic, visible signal. Renders nothing unless flagged.
 *
 * See change: update-pi-core-1-0-adopt-apis (D2).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  session: Pick<DashboardSession, "piVersion" | "piBelowFloor">;
  className?: string;
}

export function PiBelowFloorWarning({ session, className = "" }: Props) {
  const flag = session.piBelowFloor;
  if (!flag) return null;
  const running = session.piVersion ?? "?";
  return (
    <span
      role="status"
      data-testid="pi-below-floor-warning"
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)] ${className}`}
    >
      <Icon path={mdiAlertOutline} size={0.5} aria-hidden="true" />
      <span className="whitespace-nowrap">
        {i18nT(
          "session.piBelowFloor",
          { running, required: flag.minimum },
          "pi {running} is below the required {required} — upgrade pi",
        )}
      </span>
    </span>
  );
}
