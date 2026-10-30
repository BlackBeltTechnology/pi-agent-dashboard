/**
 * Settings ▸ Security ▸ Trusted Types — the operator control for the Trusted Types
 * mode (`security.trustedTypes`): Default / Enforce / Report only / Off.
 *
 * Contracts:
 * - Edits the panel DRAFT through `onChange`; the panel Save persists it (a side `PUT`
 *   would be clobbered by the next Save). `undefined` = Default = no stored key (Save
 *   sends `null`, which removes it server-side).
 * - A change needs a server restart; the panel's save message states that (the server
 *   reports `restartRequired`).
 * - Under `PI_DASHBOARD_TRUSTED_TYPES` (env beats config) the control is replaced by
 *   read-only text naming the variable and its mode.
 *
 * See change: enforce-trusted-types-default (D5).
 */
import type { TrustedTypesMode } from "@blackbelt-technology/pi-dashboard-shared/trusted-types-mode.js";
import { useId } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";

const MODES: TrustedTypesMode[] = ["enforce", "report", "off"];

export function TrustedTypesSection({
  value,
  envOverride,
  onChange,
}: {
  /** Stored `security.trustedTypes` (raw); anything but a valid mode shows as Default. */
  value: unknown;
  /** `PI_DASHBOARD_TRUSTED_TYPES` as the server sees it (recognized value), or null. */
  envOverride: TrustedTypesMode | null;
  onChange: (next: TrustedTypesMode | undefined) => void;
}) {
  const { t } = useI18n();
  const selectId = useId();
  const label = (m: TrustedTypesMode): string =>
    m === "enforce"
      ? t("settings.trustedTypesEnforce", undefined, "Enforce")
      : m === "report"
        ? t("settings.trustedTypesReport", undefined, "Report only")
        : t("settings.trustedTypesOff", undefined, "Off");
  const current = MODES.find((m) => m === value) ?? "";
  return (
    <section data-testid="trusted-types-section" className="mb-6">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
        {t("settings.trustedTypes", undefined, "Trusted Types")}
      </h3>
      <p className="text-xs text-[var(--text-tertiary)] mb-3 max-w-[64ch]">
        {t(
          "settings.trustedTypesBody",
          undefined,
          "Browser protection against script injection through unsafe HTML and script sinks. Report only logs violations; Enforce blocks them. A change takes effect after a server restart.",
        )}
      </p>
      {envOverride ? (
        <p data-testid="trusted-types-locked" className="text-xs text-[var(--severity-warning-fg)]">
          {t(
            "settings.trustedTypesLocked",
            { mode: label(envOverride) },
            "Set by PI_DASHBOARD_TRUSTED_TYPES: {mode}",
          )}
        </p>
      ) : (
        <>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor={selectId}>
            {t("settings.trustedTypesMode", undefined, "Mode")}
          </label>
          <select
            id={selectId}
            data-testid="trusted-types-select"
            className="bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
            value={current}
            onChange={(e) => onChange(MODES.find((m) => m === e.target.value))}
          >
            <option value="">
              {t("settings.trustedTypesDefault", undefined, "Default (report only; off when the CSP is off)")}
            </option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        </>
      )}
    </section>
  );
}
