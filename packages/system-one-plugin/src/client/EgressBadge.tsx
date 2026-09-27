/**
 * On-/off-machine badge: icon + words, colour only as a second channel
 * (WCAG 1.4.1; ui-contract invariant 4). Text comes from the server's egress
 * label (`hosted`, `loopback (user-declared)`, `cloud model`, …).
 * See change: add-system-one-registry.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import type { BackendView } from "./api.js";

const base = "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold whitespace-nowrap";

export function EgressBadge({ view }: { view: BackendView | undefined }): React.ReactElement {
  const t = useT();
  if (!view)
    return (
      <span className={`${base} border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-secondary)]`}>
        {t("egressUnsaved", undefined, "not saved yet")}
      </span>
    );
  return view.offMachine ? (
    <span className={`${base} border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]`}>
      <span aria-hidden="true">☁</span>
      {t("offMachineBadge", { label: view.egress }, `Off-machine · ${view.egress}`)}
    </span>
  ) : (
    <span className={`${base} border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]`}>
      <span aria-hidden="true">⌂</span>
      {t("onMachineBadge", { label: view.egress }, `On-machine · ${view.egress}`)}
    </span>
  );
}
