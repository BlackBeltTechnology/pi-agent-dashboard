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

/** Poll `/api/quota`; returns the latest provider snapshot (empty on any failure). */
function useQuota(pollMs = 60_000): ProviderQuota[] {
  const [providers, setProviders] = useState<ProviderQuota[]>([]);
  useEffect(() => {
    let alive = true;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/quota");
        const json = (await res.json()) as ApiQuotaResponse;
        if (alive) setProviders(Array.isArray(json.providers) ? json.providers : []);
      } catch {
        if (alive) setProviders([]);
      }
    }
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pollMs]);
  return providers;
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
  const providers = useQuota();
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
        <QuotaDialog providers={providers} initial={dialogProvider} onClose={() => setDialogProvider(null)} />
      )}
    </div>
  );
}

/** Detail dialog via the shared `ui:dialog` primitive; selector: All · per-provider. */
export function QuotaDialog({
  providers,
  initial,
  onClose,
}: {
  providers: ProviderQuota[];
  initial: string;
  onClose: () => void;
}) {
  const t = useT();
  const paceText = usePaceText();
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const [selected, setSelected] = useState<string>(initial);
  const now = Date.now();

  const shown = selected === "__all__" ? providers : providers.filter((p) => p.provider === selected);

  return (
    <Dialog open onClose={onClose} title={t("heading", undefined, "Provider Quota")} size="md" testId="quota-dialog">
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

  const base = useMemo<QuotaPluginConfig>(
    () => ({ enabled: !!config?.enabled, providers: { ...(config?.providers ?? {}) } }),
    [config?.enabled, config?.providers],
  );

  const [draft, setDraft] = useState<QuotaPluginConfig>(base);
  useEffect(() => setDraft(base), [base]);

  const setProvider = (id: string, enabled: boolean) =>
    setDraft((d) => ({ ...d, providers: { ...(d.providers ?? {}), [id]: { enabled } } }));

  const isDirty =
    draft.enabled !== base.enabled ||
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
    </section>
  );
}
