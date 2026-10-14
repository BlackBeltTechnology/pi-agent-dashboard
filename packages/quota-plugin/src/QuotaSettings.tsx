/**
 * Quota settings page — `settings-section` claim, loaded lazily through the
 * manifest `module` field so the settings UI stays out of the cold-landing
 * chunk. Helpers shared with the widget/dialog are imported from `./client.js`.
 *
 * See change: lazy-plugin-claim-modules.
 */
import { useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { providerLabel, useQuotaUnavailable } from "./client.js";
import { SUPPORTED_PROVIDERS } from "./providers.js";
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

/** Retry schedule preview — backoff sequence + honest wall-clock total. */
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
    <div
      data-testid="quota-retry-preview"
      style={{ fontSize: 10, color: "var(--text-muted, #71717a)", marginTop: 6, lineHeight: 1.5 }}
    >
      <div>
        {t("retryPreviewTotal", undefined, "Worst-case wait before a provider is marked unavailable:")}{" "}
        <b data-testid="quota-retry-total" style={{ color: "var(--text-secondary, #a1a1aa)" }}>
          {maxAttempts === 0 ? t("retryNone", undefined, "no retries") : humanMs(totalMs)}
        </b>
      </div>
      {seq.length > 0 && (
        <div data-testid="quota-retry-sequence" style={{ fontFamily: "monospace", marginTop: 2 }}>
          {seq.join(" → ")}
        </div>
      )}
      <div style={{ marginTop: 2 }}>
        {t(
          "retryMultiCallCaveat",
          undefined,
          "Includes each attempt's request timeout. A provider that issues multiple calls per attempt (e.g. Copilot) may exceed this.",
        )}
      </div>
    </div>
  );
}

/** A labelled number input for a retry field. */
function RetryNumField({
  label,
  testId,
  value,
  onChange,
  disabled,
  min,
  max,
  step,
}: {
  label: string;
  testId: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min: number;
  max?: number;
  step: number;
}) {
  return (
    <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
      <span style={{ width: 130, color: "var(--text-secondary, #a1a1aa)" }}>{label}</span>
      <input
        type="number"
        data-testid={testId}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: 90,
          fontSize: 11,
          padding: "2px 6px",
          borderRadius: 4,
          border: "1px solid var(--border-subtle, rgba(82,82,91,0.6))",
          background: "var(--bg-tertiary, rgba(63,63,70,0.5))",
          color: "var(--text-primary, #e4e4e7)",
          opacity: disabled ? 0.4 : 1,
        }}
      />
    </label>
  );
}

/**
 * settings-section: printed ToS warning (NOT a gate) + master enable +
 * per-provider toggles. Edits buffer into a draft and commit through the host
 * Settings panel's global Save (`useSettingsDraftSource`) — no local button.
 */
export function QuotaSettings() {
  const t = useT();
  const config = usePluginConfig<QuotaPluginConfig>();
  const send = usePluginSend();
  const unavailable = useQuotaUnavailable();

  /** Plain-language cause for a ticked provider that returned nothing. */
  const reasonText = (reason: QuotaUnavailableReason): string => {
    switch (reason) {
      case "no-credential":
        return t("reasonNoCredential", undefined, "not signed in");
      case "peer-rejected":
        return t("reasonRejected", undefined, "provider refused the request");
      case "no-data":
        return t("reasonNoData", undefined, "no quota reported");
      case "no-adapter":
        return t("reasonNoAdapter", undefined, "not supported");
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

  const commit = useCallback(async () => {
    await send({ type: "plugin_config_write", id: "quota", config: draftRef.current });
  }, [send]);
  const reset = useCallback(() => setDraft(baseRef.current), []);
  useSettingsDraftSource({ id: "plugin:quota", isDirty, commit, reset });

  return (
    <section
      data-testid="quota-settings"
      style={{ padding: 12, border: "1px solid var(--border-subtle, rgba(82,82,91,0.5))", borderRadius: 6, marginBottom: 12 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t("heading", undefined, "Provider Quota")}</h3>
        <span style={{ fontSize: 10, color: "var(--text-muted, #71717a)" }}>quota</span>
      </div>

      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginBottom: 10 }}>
        <input
          type="checkbox"
          data-testid="quota-enable"
          checked={!!draft.enabled}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
        />
        {t("enableQuota", undefined, "Enable quota tracking")}
      </label>

      <fieldset style={{ border: "none", padding: 0, margin: 0, fontSize: 11 }}>
        <legend style={{ fontSize: 11, color: "var(--text-secondary, #a1a1aa)", padding: 0, marginBottom: 4 }}>
          {t("providersLegend", undefined, "Enable per provider")}
        </legend>
        {/* Every provider is tickable: the plugin owns every contract, so there
            is no peer that can be missing. A tick that yields nothing gets an
            inline reason instead of silence. */}
        {SUPPORTED_PROVIDERS.map((id) => {
          const ticked = !!draft.providers?.[id]?.enabled;
          const reason = ticked ? unavailable[id] : undefined;
          return (
          <label
            key={id}
            style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}
          >
            <input
              type="checkbox"
              data-testid={`quota-provider-${id}`}
              checked={ticked}
              onChange={(e) => setProvider(id, e.target.checked)}
            />
            {providerLabel(id)}
            {reason && (
              <span
                data-testid={`quota-provider-${id}-reason`}
                style={{ fontSize: 10, color: "var(--text-muted, #71717a)" }}
              >
                {reasonText(reason)}
              </span>
            )}
            {/* The ToS caveat is Anthropic-specific, so it sits on that row
                alone rather than as a banner over every provider. */}
            {id === "anthropic" && (
              <span
                data-testid="quota-tos-warning"
                title={t(
                  "tosBody",
                  undefined,
                  "Quota tracking calls undocumented provider endpoints that may violate provider terms. Personal/local use only.",
                )}
                style={{ fontSize: 10, color: "#fbbf24", cursor: "help" }}
              >
                ⚠ {t("tosTitle", undefined, "Warning")}
              </span>
            )}
          </label>
          );
        })}
      </fieldset>

      {/* Transient-retry block (mirrors the shell's RetrySettingsSection element
          vocabulary; the schedule helper is reproduced, not imported — the
          client cannot reach the server tree). Off by default. */}
      <fieldset
        data-testid="quota-retry"
        style={{ border: "none", padding: 0, margin: "12px 0 0", fontSize: 11 }}
      >
        <legend style={{ fontSize: 11, color: "var(--text-secondary, #a1a1aa)", padding: 0, marginBottom: 4 }}>
          {t("retryLegend", undefined, "Retry transient failures")}
        </legend>
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <input
            type="checkbox"
            data-testid="quota-retry-enabled"
            checked={!!retry.enabled}
            onChange={(e) => setRetry({ enabled: e.target.checked })}
          />
          {t("retryEnable", undefined, "Retry on HTTP 429/5xx, timeout, or network error")}
        </label>
        <RetryNumField
          label={t("retryMaxAttempts", undefined, "Max retries")}
          testId="quota-retry-maxAttempts"
          value={retry.maxAttempts ?? 3}
          onChange={(v) => setRetry({ maxAttempts: v })}
          disabled={!retry.enabled}
          min={0}
          max={RETRY_MAX_ATTEMPTS}
          step={1}
        />
        <RetryNumField
          label={t("retryBaseDelay", undefined, "Base delay (ms)")}
          testId="quota-retry-baseDelayMs"
          value={retry.baseDelayMs ?? 1000}
          onChange={(v) => setRetry({ baseDelayMs: v })}
          disabled={!retry.enabled}
          min={100}
          max={10000}
          step={100}
        />
        <RetryNumField
          label={t("retryMaxDelay", undefined, "Max delay (ms)")}
          testId="quota-retry-maxDelayMs"
          value={retry.maxDelayMs ?? 60000}
          onChange={(v) => setRetry({ maxDelayMs: v })}
          disabled={!retry.enabled}
          min={100}
          max={60000}
          step={1000}
        />
        {retry.enabled && (
          <SchedulePreview
            maxAttempts={retry.maxAttempts ?? 3}
            baseDelayMs={retry.baseDelayMs ?? 1000}
            maxDelayMs={retry.maxDelayMs ?? 60000}
            t={t}
          />
        )}
      </fieldset>
    </section>
  );
}
