/**
 * Settings ▸ Security ▸ Sudo password prompt — operator switch + limits for the
 * SUDO_ASKPASS bridge that asks for a sudo password in the dashboard.
 *
 * Contracts:
 * - Edits the panel DRAFT through callbacks; the panel Save persists it.
 * - Default on; the toggle exists to DISABLE the feature.
 * - Out-of-range input is clamped with the shared clamps (same ones the server
 *   applies on load), so the draft never holds a value the server would rewrite.
 *
 * See change: add-sudo-credential-prompt.
 */
import {
  clampSudoCacheMinutes,
  clampSudoTimeoutMs,
  type SudoCredentialPromptConfig,
} from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";
import { useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";

const INPUT_CLASS =
  "w-28 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]";

function toNumber(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

export function SudoCredentialSection({
  value,
  onChange,
}: {
  value: SudoCredentialPromptConfig;
  onChange: (next: SudoCredentialPromptConfig) => void;
}) {
  const { t } = useI18n();
  // Local text so a half-typed value ("", "6") is not rewritten mid-edit; the
  // clamped value is committed to the draft on every change and shown on blur.
  const [cacheText, setCacheText] = useState<string | null>(null);
  const [timeoutText, setTimeoutText] = useState<string | null>(null);
  return (
    <section data-testid="sudo-credential-section" className="mb-6">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
        {t("settings.sudoCredential", undefined, "Sudo password prompt")}
      </h3>
      <p className="text-xs text-[var(--text-tertiary)] mb-3 max-w-[64ch]">
        {t(
          "settings.sudoCredentialBody",
          undefined,
          "When an agent command needs sudo, ask for the password here instead of failing. The password goes straight to sudo and is only kept in the agent session's memory for a few minutes, never written to disk.",
        )}
      </p>
      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          data-testid="sudo-credential-enabled"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        {t("settings.sudoCredentialEnabled", undefined, "Ask for sudo passwords in the dashboard")}
      </label>
      <div className="mt-3">
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor="sudo-credential-timeout">
          {t("settings.sudoCredentialTimeout", undefined, "Answer within (seconds)")}
        </label>
        <input
          id="sudo-credential-timeout"
          data-testid="sudo-credential-timeout"
          type="text"
          inputMode="numeric"
          className={INPUT_CLASS}
          value={timeoutText ?? String(Math.round(value.timeoutMs / 1000))}
          onChange={(e) => {
            setTimeoutText(e.target.value);
            onChange({ ...value, timeoutMs: clampSudoTimeoutMs(toNumber(e.target.value) * 1000) });
          }}
          onBlur={() => setTimeoutText(null)}
        />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          {t("settings.sudoCredentialTimeoutHint", undefined, "5–600 seconds. No answer in time fails the sudo call without blocking later prompts.")}
        </p>
      </div>
      <div className="mt-3">
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor="sudo-credential-cache-minutes">
          {t("settings.sudoCredentialCache", undefined, "Remember password for (minutes)")}
        </label>
        <input
          id="sudo-credential-cache-minutes"
          data-testid="sudo-credential-cache-minutes"
          type="text"
          inputMode="numeric"
          className={INPUT_CLASS}
          value={cacheText ?? String(value.cacheMinutes)}
          onChange={(e) => {
            setCacheText(e.target.value);
            onChange({ ...value, cacheMinutes: clampSudoCacheMinutes(toNumber(e.target.value)) });
          }}
          onBlur={() => setCacheText(null)}
        />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          {t("settings.sudoCredentialCacheHint", undefined, "0–60 minutes. 0 asks every time.")}
        </p>
      </div>
    </section>
  );
}
