/**
 * On-/off-machine pill: a kit `SettingsStatusPill` (word + decorative icon, so
 * colour is never the only signal — WCAG 1.4.1). Text comes from the server's
 * egress label (`hosted`, `loopback (user-declared)`, `cloud model`, …).
 * See change: add-system-one-registry; retro-ux-plugin-settings-wave-2.
 */
import { SettingsStatusPill, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import type { BackendView } from "./api.js";

export function EgressBadge({ view }: { view: BackendView | undefined }): React.ReactElement {
  const t = useT();
  if (!view)
    return (
      <SettingsStatusPill tone="neutral" icon={null}>
        {t("egressUnsaved", undefined, "not saved yet")}
      </SettingsStatusPill>
    );
  return view.offMachine ? (
    <SettingsStatusPill tone="warning">{t("offMachineBadge", { label: view.egress }, `Off-machine · ${view.egress}`)}</SettingsStatusPill>
  ) : (
    <SettingsStatusPill tone="success">{t("onMachineBadge", { label: view.egress }, `On-machine · ${view.egress}`)}</SettingsStatusPill>
  );
}
