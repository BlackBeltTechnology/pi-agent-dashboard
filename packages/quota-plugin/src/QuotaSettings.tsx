/**
 * Quota settings page — `settings-section` claim, loaded lazily through the
 * manifest `module` field so the settings UI stays out of the cold-landing
 * chunk. Helpers shared with the widget/dialog are imported from `./quota-status.js`.
 * Built on the shared settings field kit: no identity header, a "Check quotas"
 * master switch, a visible ToS notice, a Providers group with worded status
 * pills, and a Retries group whose preview is an info notice.
 *
 * See changes: lazy-plugin-claim-modules, retro-ux-plugin-settings-wave-2.
 */
import { NumberField, SettingsGroup, SettingsNotice, SettingsStatusPill, type SettingsStatusTone, ToggleField, usePluginConfig, usePluginSend, useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUPPORTED_PROVIDERS } from "./providers.js";
import { providerLabel, useQuotaProviderStatus } from "./quota-status.js";
import type { QuotaPluginConfig, QuotaUnavailableReason } from "./types.js";

/**
 * Per-request timeout the server bounds each fetch attempt with
 * (`FETCH_TIMEOUT_MS` in server/quotas/http.ts). Reproduced here — the client
 * cannot import the server tree — so the preview's wall-clock total is honest.
 */
const REQUEST_TIMEOUT_MS = 15_000;
/** Retry schema bounds, mirrored from configSchema.json for the input attrs. */
const RETRY_MAX_ATTEMPTS = 5;

/** Humanize a millisecond delay. Mirrors RetrySettingsSection.human. */
function humanMs(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s % 1 === 0 ? s : s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
}

/**
 * The quota backoff schedule: delay_n = min(baseDelayMs·2^n, maxDelayMs) for
 * n = 0..maxAttempts-1. `totalMs` is the wall-clock worst case the retries add
 * before a provider is marked unavailable: the between-attempt SLEEPS plus every
 * attempt's request timeout — including the initial one, so the count is
 * `maxAttempts + 1` (design D4).
 */
function computeSchedule(
  maxAttemptsRaw: number,
  baseDelayMsRaw: number,
  maxDelayMsRaw: number,
): { seq: string[]; totalMs: number } {
  // Clamp to the schema bounds BEFORE looping — number inputs don't normalize
  // typed values, and a malformed persisted `maxAttempts` (e.g. 1e9) would
  // otherwise spin this loop and freeze the settings UI before the server's
  // own clamp ever runs. Mirrors the server-side clampRetry bounds.
  const clamp = (v: number, lo: number, hi: number, dflt: number) =>
    Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : dflt;
  const maxAttempts = clamp(Math.trunc(maxAttemptsRaw), 0, RETRY_MAX_ATTEMPTS, 3);
  const baseDelayMs = clamp(baseDelayMsRaw, 100, 10_000, 1_000);
  const maxDelayMs = clamp(maxDelayMsRaw, 100, 60_000, 60_000);
  const seq: string[] = [];
  let sleepMs = 0;
  for (let n = 0; n < maxAttempts; n++) {
    const d = Math.min(baseDelayMs * 2 ** n, maxDelayMs);
    sleepMs += d;
    seq.push(humanMs(d));
  }
  return { seq, totalMs: sleepMs + (maxAttempts + 1) * REQUEST_TIMEOUT_MS };
}

/** Retry schedule preview — backoff sequence + honest wall-clock total, as an info notice. */
function SchedulePreview({
  maxAttempts,
  baseDelayMs,
  maxDelayMs,
  t,
}: {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  t: ReturnType<typeof useT>;
}) {
  const { seq, totalMs } = computeSchedule(maxAttempts, baseDelayMs, maxDelayMs);
  return (
    <SettingsNotice tone="info" testId="quota-retry-preview">
      <div>
        {t("retryPreviewTotal", undefined, "Worst-case wait before a provider is marked unavailable:")}{" "}
        <strong data-testid="quota-retry-total">
          {maxAttempts === 0 ? t("retryNone", undefined, "no retries") : humanMs(totalMs)}
        </strong>
      </div>
      {seq.length > 0 && (
        <div data-testid="quota-retry-sequence" className="mt-0.5 font-mono text-[12px]">
          {seq.join(" → ")}
        </div>
      )}
      <div className="mt-0.5">
        {t(
          "retryMultiCallCaveat",
          undefined,
          "Includes each attempt's request timeout. A provider that issues multiple calls per attempt (e.g. Copilot) may exceed this.",
        )}
      </div>
    </SettingsNotice>
  );
}

/**
 * settings-section: printed ToS warning (NOT a gate) + master switch +
 * per-provider switches + retry policy. Edits buffer into a draft and commit
 * through the host Settings panel's global Save (`useSettingsDraftSource`) — no
 * local button.
 */
export function QuotaSettings() {
  const t = useT();
  const config = usePluginConfig<QuotaPluginConfig>();
  const send = usePluginSend();
  const { reasons, withData } = useQuotaProviderStatus();

  /** Worded pill for a ticked provider: server-named reason, else "Signed in" when it reports data. */
  const statusPill = (id: string) => {
    const reason: QuotaUnavailableReason | undefined = reasons[id];
    if (reason) {
      const [word, tone] = reasonPill(reason);
      return (
        <SettingsStatusPill tone={tone} testId={`quota-provider-${id}-reason`} status={reason}>
          {word}
        </SettingsStatusPill>
      );
    }
    if (withData.has(id)) {
      return (
        <SettingsStatusPill tone="success" testId={`quota-provider-${id}-status`} status="ok">
          {t("signedIn", undefined, "Signed in")}
        </SettingsStatusPill>
      );
    }
    return null;
  };

  /** Pill word + tone for a ticked provider that returned nothing. */
  const reasonPill = (reason: QuotaUnavailableReason): [string, SettingsStatusTone] => {
    switch (reason) {
      case "no-credential":
        return [t("reasonNoCredential", undefined, "Not signed in"), "neutral"];
      case "peer-rejected":
        return [t("reasonRejected", undefined, "Request refused"), "warning"];
      case "no-data":
        return [t("reasonNoData", undefined, "No quota reported"), "neutral"];
      case "no-adapter":
        return [t("reasonNoAdapter", undefined, "Not supported"), "neutral"];
    }
  };

  // Spread the FULL loaded config so unknown/future fields (notably `retry`)
  // round-trip a save instead of being erased by an allowlist rebuild (D8).
  const base = useMemo<QuotaPluginConfig>(
    () => ({ ...(config ?? {}), enabled: !!config?.enabled, providers: { ...(config?.providers ?? {}) } }),
    [config],
  );

  const [draft, setDraft] = useState<QuotaPluginConfig>(base);
  useEffect(() => setDraft(base), [base]);

  const setProvider = (id: string, enabled: boolean) =>
    setDraft((d) => ({ ...d, providers: { ...(d.providers ?? {}), [id]: { enabled } } }));

  const retry = draft.retry ?? {};
  const setRetry = (patch: Partial<NonNullable<QuotaPluginConfig["retry"]>>) =>
    setDraft((d) => ({ ...d, retry: { ...(d.retry ?? {}), ...patch } }));

  // An emptied number input is an invalid draft value (NaN), never coerced to 0.
  // Only checked while retries are on: the fields are disabled otherwise.
  const emptyError = (v: number | undefined): string | null =>
    retry.enabled && v !== undefined && !Number.isFinite(v) ? t("numberRequired", undefined, "Enter a number.") : null;
  const maxAttemptsError = emptyError(retry.maxAttempts);
  const baseDelayError = emptyError(retry.baseDelayMs);
  const maxDelayError = emptyError(retry.maxDelayMs);
  const retryInvalid = Boolean(maxAttemptsError || baseDelayError || maxDelayError);

  const isDirty =
    draft.enabled !== base.enabled ||
    JSON.stringify(draft.retry ?? {}) !== JSON.stringify(base.retry ?? {}) ||
    SUPPORTED_PROVIDERS.some(
      (id) => !!draft.providers?.[id]?.enabled !== !!base.providers?.[id]?.enabled,
    );

  // Refs keep the host's stable commit/reset callbacks reading live values.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(base);
  baseRef.current = base;
  const invalidRef = useRef(retryInvalid);
  invalidRef.current = retryInvalid;

  const commit = useCallback(async () => {
    if (invalidRef.current) {
      throw new Error(t("saveBlockedInvalid", undefined, "Fix the invalid fields before saving."));
    }
    await send({ type: "plugin_config_write", id: "quota", config: draftRef.current });
  }, [send, t]);
  const reset = useCallback(() => setDraft(baseRef.current), []);
  useSettingsDraftSource({ id: "plugin:quota", isDirty, commit, reset });

  const enabledCount = SUPPORTED_PROVIDERS.filter((id) => draft.providers?.[id]?.enabled).length;
  const unitMs = t("unitMs", undefined, "ms");

  return (
    <section data-testid="quota-settings" className="space-y-3 text-xs text-[var(--text-secondary)]">
      <ToggleField
        label={t("enableQuota", undefined, "Check quotas")}
        hint={t(
          "enableQuotaHint",
          undefined,
          "Shows remaining quota in the composer. Turn off to stop all checks; the plugin stays on.",
        )}
        value={!!draft.enabled}
        onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
        testIds={{ control: "quota-enable" }}
      />

      <SettingsGroup
        title={t("providersLegend", undefined, "Providers")}
        meta={t("providersOn", { on: enabledCount, total: SUPPORTED_PROVIDERS.length }, `${enabledCount} of ${SUPPORTED_PROVIDERS.length} on`)}
      >
        <SettingsNotice tone="warning" testId="quota-tos-warning">
          {t(
            "tosBody",
            undefined,
            "Quota checks call undocumented provider endpoints that may break the provider's terms. Use for personal, local setups only.",
          )}
        </SettingsNotice>
        {/* Every provider is tickable: the plugin owns every contract, so there
            is no peer that can be missing. A tick that yields nothing gets a
            worded pill (the field's description) instead of silence. */}
        {SUPPORTED_PROVIDERS.map((id) => {
          const ticked = !!draft.providers?.[id]?.enabled;
          return (
            <div key={id} data-testid={`quota-provider-${id}-row`}>
              <ToggleField
                label={providerLabel(id)}
                hint={ticked ? statusPill(id) : null}
                value={ticked}
                onChange={(v) => setProvider(id, v)}
                testIds={{ control: `quota-provider-${id}` }}
              />
            </div>
          );
        })}
      </SettingsGroup>

      {/* Transient-retry block (the schedule helper is reproduced, not imported —
          the client cannot reach the server tree). Off by default. */}
      <SettingsGroup title={t("retryLegend", undefined, "Retries")} testId="quota-retry">
        <ToggleField
          label={t("retryEnable", undefined, "Retry failed checks")}
          hint={t("retryEnableHint", undefined, "On HTTP 429/5xx, timeouts and network errors.")}
          value={!!retry.enabled}
          onChange={(v) => setRetry({ enabled: v })}
          testIds={{ control: "quota-retry-enabled" }}
        />
        <NumberField
          label={t("retryMaxAttempts", undefined, "Max retries")}
          hint={t("retryMaxAttemptsHint", undefined, "0–5 retries after the first try.")}
          error={maxAttemptsError}
          allowEmpty
          step={1}
          disabled={!retry.enabled}
          value={retry.maxAttempts ?? 3}
          onChange={(v) => setRetry({ maxAttempts: v })}
          testIds={{ control: "quota-retry-maxAttempts" }}
        />
        <NumberField
          label={t("retryBaseDelay", undefined, "First wait")}
          unit={unitMs}
          hint={t("retryBaseDelayHint", undefined, "Doubles after each retry. 100–10000.")}
          error={baseDelayError}
          allowEmpty
          step={100}
          disabled={!retry.enabled}
          value={retry.baseDelayMs ?? 1000}
          onChange={(v) => setRetry({ baseDelayMs: v })}
          testIds={{ control: "quota-retry-baseDelayMs" }}
        />
        <NumberField
          label={t("retryMaxDelay", undefined, "Longest wait")}
          unit={unitMs}
          hint={t("retryMaxDelayHint", undefined, "The wait never grows past this. 100–60000.")}
          error={maxDelayError}
          allowEmpty
          step={1000}
          disabled={!retry.enabled}
          value={retry.maxDelayMs ?? 60000}
          onChange={(v) => setRetry({ maxDelayMs: v })}
          testIds={{ control: "quota-retry-maxDelayMs" }}
        />
        {retry.enabled && (
          <SchedulePreview
            maxAttempts={retry.maxAttempts ?? 3}
            baseDelayMs={retry.baseDelayMs ?? 1000}
            maxDelayMs={retry.maxDelayMs ?? 60000}
            t={t}
          />
        )}
      </SettingsGroup>
    </section>
  );
}
