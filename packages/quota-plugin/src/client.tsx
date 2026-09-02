/**
 * Provider Quota — dashboard client entry.
 *
 * Two contributions:
 *  - `QuotaWidget` (content-inline-footer): ONE COMPACT LINE per enabled
 *    provider — label + slim bar, no percentage number (the fill and the `now`
 *    tick carry it; the exact numbers live in the dialog). Fill coloured by
 *    pace severity (worst window drives it). Click → shared Dialog primitive.
 *    Stays in `content-inline-footer`: the composer's own context slider is
 *    draft-conditional (it vanishes when the input is empty), so aligning with
 *    it would make quota disappear too.
 *  - `QuotaSettings` (settings-section): a non-blocking ToS WARNING (printed,
 *    not a gate) + master enable + per-provider toggles, committed through the
 *    host Settings panel's global Save via `useSettingsDraftSource`.
 *
 * Data comes only from `GET /api/quota` (server-computed, tokens never cross the
 * wire). Absent/empty → nothing renders (honest degradation, never an error).
 */
import { useSettingsDraftSource, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computePace, formatResetIn, type Pace, type PaceSeverity, paceLabel } from "./pace.js";
import { SUPPORTED_PROVIDERS } from "./providers.js";
import type {
  ApiQuotaResponse,
  ProviderQuota,
  QuotaPluginConfig,
  QuotaUnavailableReason,
  QuotaWindowDto,
} from "./types.js";

export { catalog } from "./i18n.js";

// Display names only; providers.ts owns WHICH providers exist.
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-codex": "Codex",
  "github-copilot": "Copilot",
  openrouter: "OpenRouter",
  synthetic: "Synthetic",
  zai: "Z.ai",
  "kimi-coding": "Kimi Code",
};

const SEVERITY_COLOR: Record<PaceSeverity, string> = {
  green: "#34d399",
  orange: "#fbbf24",
  red: "#f87171",
  muted: "#71717a",
};

const SEVERITY_RANK: Record<PaceSeverity, number> = { red: 3, orange: 2, green: 1, muted: 0 };

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * Localized pace-state formatter. `paceLabel` (pure, in pace.ts) supplies the
 * English fallback; the shell translator localizes it for zh-CN/hu.
 */
function usePaceText(): (pace: Pace) => string {
  const t = useT();
  return (pace: Pace) => {
    const fallback = paceLabel(pace);
    switch (pace.state) {
      case "unavailable":
        return t("unavailable", undefined, fallback);
      case "stale":
        return t("stale", undefined, fallback);
      case "ok":
        return pace.warn
          ? t("overBy", { pct: Math.round(pace.overage ?? 0) }, fallback)
          : t("onPace", undefined, fallback);
    }
  };
}

interface WindowPace {
  window: QuotaWindowDto;
  pace: Pace;
}

/** Worst-severity window for a provider (ties broken by higher projected). */
function worstWindow(windows: QuotaWindowDto[], now: number): WindowPace | null {
  let best: WindowPace | null = null;
  for (const window of windows) {
    const pace = computePace(window, now);
    if (
      !best ||
      SEVERITY_RANK[pace.severity] > SEVERITY_RANK[best.pace.severity] ||
      (SEVERITY_RANK[pace.severity] === SEVERITY_RANK[best.pace.severity] &&
        (pace.projected ?? 0) > (best.pace.projected ?? 0))
    ) {
      best = { window, pace };
    }
  }
  return best;
}

/** Shared quota fetch/refresh state. One owner (`QuotaWidget`) instantiates it. */
export interface QuotaState {
  providers: ProviderQuota[];
  /** Epoch ms of the most recently APPLIED snapshot, or null before the first. */
  lastUpdated: number | null;
  /** Force a fresh `GET /api/quota`. No-op while a request is already in flight. */
  refresh: () => void;
  isRefreshing: boolean;
}

/**
 * Poll `/api/quota` and expose an on-demand refresh (design D7). BOTH the poll
 * and the manual refresh carry a monotonically increasing sequence id; a
 * response is applied only when its id is the newest issued, so an out-of-order
 * race can never clobber a newer snapshot and `lastUpdated` never regresses. On
 * failure the prior snapshot is retained (honest degradation, no error UI).
 * `refresh` is a no-op while `isRefreshing` (disable-while-in-flight).
 */
export function useQuota(pollMs = 60_000): QuotaState {
  const [providers, setProviders] = useState<ProviderQuota[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const refreshingRef = useRef(false);
  const aliveRef = useRef(true);

  const apply = useCallback((seq: number, json: ApiQuotaResponse): void => {
    // Apply only if this is still the newest response (drops out-of-order races).
    if (!aliveRef.current || seq <= appliedRef.current) return;
    appliedRef.current = seq;
    setProviders(Array.isArray(json.providers) ? json.providers : []);
    setLastUpdated(Date.now());
  }, []);

  const load = useCallback(
    async (manual: boolean): Promise<void> => {
      if (manual && refreshingRef.current) return; // single-flight: ignore while in flight
      if (manual) {
        refreshingRef.current = true;
        setIsRefreshing(true);
      }
      const seq = ++seqRef.current;
      try {
        const res = await fetch("/api/quota");
        apply(seq, (await res.json()) as ApiQuotaResponse);
      } catch {
        // Keep the prior snapshot — a failed refresh must not blank the widget.
      } finally {
        if (manual) {
          refreshingRef.current = false;
          if (aliveRef.current) setIsRefreshing(false);
        }
      }
    },
    [apply],
  );

  useEffect(() => {
    aliveRef.current = true;
    void load(false);
    const timer = setInterval(() => void load(false), pollMs);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [load, pollMs]);

  const refresh = useCallback(() => void load(true), [load]);
  return { providers, lastUpdated, refresh, isRefreshing };
}

/**
 * Reason-per-provider for every ENABLED provider that produced no quota, from
 * the same `/api/quota` payload.
 *
 * Every provider is tickable now that the plugin owns each contract — there is
 * no peer to be missing. But a tick can still yield nothing (not signed in,
 * endpoint throttled), and silence there is indistinguishable from a bug. The
 * server names the cause; the settings row prints it.
 *
 * Fetched once per mount (no poll): the Settings panel is short-lived.
 */
function useQuotaUnavailable(): Record<string, QuotaUnavailableReason> {
  const [reasons, setReasons] = useState<Record<string, QuotaUnavailableReason>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/quota");
        const json = (await res.json()) as ApiQuotaResponse;
        if (!alive) return;
        setReasons(Object.fromEntries((json.unavailable ?? []).map((u) => [u.provider, u.reason])));
      } catch {
        if (alive) setReasons({});
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return reasons;
}

/**
 * Grey `now` caption sitting directly BENEATH the tick, horizontally centred on
 * it. Replaces the former legend row: the marker names itself in place instead
 * of being explained elsewhere. Offset is clamped to 6..94% so the centred
 * label never overflows the track at the extremes.
 */
/**
 * Time-until-reset caption. Renders NOTHING when `formatResetIn` yields null
 * (past/epoch-sentinel/unparseable reset), so a bogus upstream timestamp stays
 * invisible instead of claiming a decades-old reset.
 */
function ResetsIn({ resetsAt, now }: { resetsAt: string; now: number }) {
  const t = useT();
  const rel = formatResetIn(resetsAt, now);
  if (rel === null) return null;
  return (
    <span data-testid="quota-resets-in" style={{ whiteSpace: "nowrap" }}>
      {t("resetsIn", { t: rel }, `resets in ${rel}`)}
    </span>
  );
}

function NowCaption({ elapsedPercent }: { elapsedPercent: number }) {
  const t = useT();
  return (
    <div style={{ position: "relative", height: 12 }}>
      <span
        data-testid="quota-now-caption"
        style={{
          position: "absolute",
          top: 0,
          left: `${Math.min(94, Math.max(6, elapsedPercent))}%`,
          transform: "translateX(-50%)",
          fontSize: 9,
          lineHeight: "12px",
          whiteSpace: "nowrap",
          color: "var(--text-muted, #71717a)",
        }}
      >
        {t("now", undefined, "now")}
      </span>
    </div>
  );
}

/** Slim track with a fill (0..100) and a `now` tick. */
function MiniBar({ pace, usedPercent, height = 4 }: { pace: Pace; usedPercent: number; height?: number }) {
  const color = SEVERITY_COLOR[pace.severity];
  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: height,
        background: "var(--bg-tertiary, rgba(63,63,70,0.5))",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${Math.min(100, Math.max(0, usedPercent))}%`,
          background: color,
          borderRadius: height,
        }}
      />
      {pace.elapsedPercent !== null && (
        <div
          data-testid="quota-now-tick"
          style={{
            position: "absolute",
            top: -1,
            bottom: -1,
            left: `${pace.elapsedPercent}%`,
            width: 1.5,
            background: "var(--text-primary, #e4e4e7)",
            opacity: 0.7,
          }}
        />
      )}
    </div>
  );
}

/** content-inline-footer: per-provider mini-sliders. Renders nothing when empty. */
export function QuotaWidget() {
  const quota = useQuota();
  const { providers } = quota;
  const paceText = usePaceText();
  const now = Date.now();
  const [dialogProvider, setDialogProvider] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      providers
        .filter((p) => p.windows.length > 0)
        .map((p) => ({ provider: p.provider, worst: worstWindow(p.windows, now) }))
        .filter((r): r is { provider: string; worst: WindowPace } => r.worst !== null),
    [providers, now],
  );

  if (rows.length === 0) return null;

  return (
    <div
      data-testid="quota-widget"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "1px 8px", fontSize: 11 }}
    >
      {rows.map(({ provider, worst }) => (
        <button
          key={provider}
          type="button"
          data-testid={`quota-slider-${provider}`}
          title={paceText(worst.pace)}
          onClick={() => setDialogProvider(provider)}
          style={{
            // Single compact line: label + bar side by side (no percentage).
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            padding: 0,
            lineHeight: 1,
            cursor: "pointer",
            color: "var(--text-secondary, #a1a1aa)",
          }}
        >
          <span style={{ whiteSpace: "nowrap" }}>{providerLabel(provider)}</span>
          <span style={{ display: "inline-block", width: 56 }}>
            <MiniBar pace={worst.pace} usedPercent={worst.window.usedPercent} height={3} />
          </span>
        </button>
      ))}
      {dialogProvider !== null && (
        <QuotaDialog quota={quota} initial={dialogProvider} onClose={() => setDialogProvider(null)} />
      )}
    </div>
  );
}

/** Relative "last updated" caption text, or null before the first snapshot. */
function lastUpdatedText(lastUpdated: number | null | undefined, now: number, t: ReturnType<typeof useT>): string | null {
  if (lastUpdated == null) return null;
  const secs = Math.max(0, Math.round((now - lastUpdated) / 1000));
  if (secs < 5) return t("updatedJustNow", undefined, "updated just now");
  if (secs < 60) return t("updatedSecondsAgo", { s: secs }, `updated ${secs}s ago`);
  const mins = Math.round(secs / 60);
  return t("updatedMinutesAgo", { m: mins }, `updated ${mins}m ago`);
}

/** Detail dialog via the shared `ui:dialog` primitive; selector: All · per-provider. */
export function QuotaDialog({
  quota,
  initial,
  onClose,
}: {
  quota: QuotaState;
  initial: string;
  onClose: () => void;
}) {
  const { providers, lastUpdated, refresh, isRefreshing } = quota;
  const t = useT();
  const paceText = usePaceText();
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const [selected, setSelected] = useState<string>(initial);
  const now = Date.now();

  // A refresh can drop the selected provider from the snapshot; fall back to All
  // rather than render an empty detail view (design D7).
  useEffect(() => {
    if (selected !== "__all__" && !providers.some((p) => p.provider === selected)) {
      setSelected("__all__");
    }
  }, [providers, selected]);

  const shown = selected === "__all__" ? providers : providers.filter((p) => p.provider === selected);
  const updatedLabel = lastUpdatedText(lastUpdated, now, t);

  return (
    <Dialog open onClose={onClose} title={t("heading", undefined, "Provider Quota")} size="md" testId="quota-dialog">
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}
      >
        <span data-testid="quota-last-updated" style={{ fontSize: 10, color: "var(--text-muted, #71717a)" }}>
          {updatedLabel}
        </span>
        <button
          type="button"
          data-testid="quota-refresh"
          onClick={refresh}
          disabled={isRefreshing}
          style={{
            fontSize: 11,
            padding: "2px 10px",
            borderRadius: 999,
            border: "1px solid var(--border-subtle, rgba(82,82,91,0.6))",
            background: "transparent",
            color: "var(--text-secondary, #a1a1aa)",
            cursor: isRefreshing ? "default" : "pointer",
            opacity: isRefreshing ? 0.5 : 1,
          }}
        >
          {isRefreshing ? t("refreshing", undefined, "Refreshing…") : t("refresh", undefined, "Refresh")}
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <SelectorPill label={t("all", undefined, "All")} active={selected === "__all__"} onClick={() => setSelected("__all__")} />
        {providers.map((p) => (
          <SelectorPill
            key={p.provider}
            label={providerLabel(p.provider)}
            active={selected === p.provider}
            onClick={() => setSelected(p.provider)}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.map((p) => (
          <div
            key={p.provider}
            data-testid={`quota-card-${p.provider}`}
            style={{
              border: "1px solid var(--border-subtle, rgba(82,82,91,0.5))",
              borderRadius: 6,
              padding: 10,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-primary, #e4e4e7)" }}>
              {providerLabel(p.provider)}
              {/* Retained snapshot: the latest refresh failed (e.g. HTTP 429) so
                  these are the last known figures, not live. Surfaced in the
                  dialog ONLY — the footer bar stays quiet by design.
                  See change: publish-quota-plugin. */}
              {p.stale === true && (
                <span
                  data-testid={`quota-stale-${p.provider}`}
                  title={t("retainedBody", undefined, "The latest refresh failed, so the last known values are shown.")}
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    fontWeight: 400,
                    color: "var(--text-muted, #71717a)",
                  }}
                >
                  {t("retained", undefined, "not live")}
                </span>
              )}
            </div>
            {p.windows.map((w, i) => {
              const pace = computePace(w, now);
              return (
                <div key={`${w.label}-${i}`} style={{ marginBottom: 8, fontSize: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "var(--text-secondary, #a1a1aa)" }}>{w.label}</span>
                    <span style={{ color: SEVERITY_COLOR[pace.severity] }}>
                      {Math.round(w.usedPercent)}%
                      {pace.projected !== null && (
                        <span style={{ color: "var(--text-muted, #71717a)", marginLeft: 6 }}>
                          {t("projected", undefined, "proj.")} {Math.round(pace.projected)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <MiniBar pace={pace} usedPercent={w.usedPercent} height={6} />
                  {pace.elapsedPercent !== null && <NowCaption elapsedPercent={pace.elapsedPercent} />}
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted, #71717a)",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span>{paceText(pace)}</span>
                    <ResetsIn resetsAt={w.resetsAt} now={now} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function SelectorPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: "2px 10px",
        borderRadius: 999,
        border: "1px solid var(--border-subtle, rgba(82,82,91,0.6))",
        background: active ? "var(--accent, #3b82f6)" : "transparent",
        color: active ? "#fff" : "var(--text-secondary, #a1a1aa)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

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
  maxAttempts: number,
  baseDelayMs: number,
  maxDelayMs: number,
): { seq: string[]; totalMs: number } {
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
