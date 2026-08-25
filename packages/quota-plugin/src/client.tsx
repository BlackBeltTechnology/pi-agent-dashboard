/**
 * Provider Quota — dashboard client entry.
 *
 * Two contributions:
 *  - `QuotaWidget` (content-inline-footer): one mini-slider per enabled
 *    provider, fill coloured by pace severity (worst window drives it), a `now`
 *    tick, minimal tooltip. Click → the shared Dialog primitive.
 *  - `QuotaSettings` (settings-section): ToS acknowledgement gate + master
 *    enable + per-provider toggles.
 *
 * Data comes only from `GET /api/quota` (server-computed, tokens never cross the
 * wire). Absent/empty → nothing renders (honest degradation, never an error).
 */
import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { useEffect, useMemo, useState } from "react";
import { computePace, type Pace, type PaceSeverity, paceLabel } from "./pace.js";
import type { ApiQuotaResponse, ProviderQuota, QuotaPluginConfig, QuotaWindowDto } from "./types.js";

export { catalog } from "./i18n.js";

// Providers eligible for the subscription tracker (Anthropic excluded).
const PROVIDER_LABELS: Record<string, string> = {
  "openai-codex": "Codex",
  "github-copilot": "Copilot",
  openrouter: "OpenRouter",
  synthetic: "Synthetic",
  zai: "Z.ai",
  "opencode-go": "OpenCode Go",
  "kimi-coding": "Kimi Code",
};
const TRACKED_PROVIDERS = Object.keys(PROVIDER_LABELS);

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
        .filter((p) => p.provider !== "anthropic" && p.windows.length > 0)
        .map((p) => ({ provider: p.provider, worst: worstWindow(p.windows, now) }))
        .filter((r): r is { provider: string; worst: WindowPace } => r.worst !== null),
    [providers, now],
  );

  if (rows.length === 0) return null;

  return (
    <div
      data-testid="quota-widget"
      style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "4px 8px", fontSize: 11 }}
    >
      {rows.map(({ provider, worst }) => (
        <button
          key={provider}
          type="button"
          data-testid={`quota-slider-${provider}`}
          title={paceText(worst.pace)}
          onClick={() => setDialogProvider(provider)}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 96,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--text-secondary, #a1a1aa)",
          }}
        >
          <span style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
            <span>{providerLabel(provider)}</span>
            <span style={{ color: SEVERITY_COLOR[worst.pace.severity] }}>
              {Math.round(worst.window.usedPercent)}%
            </span>
          </span>
          <MiniBar pace={worst.pace} usedPercent={worst.window.usedPercent} />
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
                  <div style={{ fontSize: 10, color: "var(--text-muted, #71717a)", marginTop: 2 }}>
                    {paceText(pace)}
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

/** settings-section: master enable + ToS ack gate + per-provider toggles. */
export function QuotaSettings() {
  const t = useT();
  const config = usePluginConfig<QuotaPluginConfig>();
  const send = usePluginSend();

  const [draft, setDraft] = useState<QuotaPluginConfig>({
    enabled: !!config?.enabled,
    acknowledgedToS: !!config?.acknowledgedToS,
    providers: { ...(config?.providers ?? {}) },
  });

  useEffect(() => {
    setDraft({
      enabled: !!config?.enabled,
      acknowledgedToS: !!config?.acknowledgedToS,
      providers: { ...(config?.providers ?? {}) },
    });
  }, [config?.enabled, config?.acknowledgedToS, config?.providers]);

  const setProvider = (id: string, enabled: boolean) =>
    setDraft((d) => ({ ...d, providers: { ...(d.providers ?? {}), [id]: { enabled } } }));

  return (
    <section
      data-testid="quota-settings"
      style={{ padding: 12, border: "1px solid var(--border-subtle, rgba(82,82,91,0.5))", borderRadius: 6, marginBottom: 12 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t("heading", undefined, "Provider Quota")}</h3>
        <span style={{ fontSize: 10, color: "var(--text-muted, #71717a)" }}>quota</span>
      </div>

      <div
        style={{
          fontSize: 11,
          color: "var(--text-secondary, #a1a1aa)",
          background: "rgba(245,158,11,0.1)",
          border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 4,
          padding: 8,
          marginBottom: 10,
        }}
      >
        <strong>{t("tosTitle", undefined, "Terms of Service")}</strong>
        <p style={{ margin: "4px 0 8px 0" }}>
          {t(
            "tosBody",
            undefined,
            "Quota tracking calls undocumented provider endpoints that may violate provider terms. Anthropic is excluded. Personal/local use only.",
          )}
        </p>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid="quota-ack"
            checked={!!draft.acknowledgedToS}
            onChange={(e) => setDraft((d) => ({ ...d, acknowledgedToS: e.target.checked }))}
          />
          {t("tosAck", undefined, "I understand and accept")}
        </label>
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
        {TRACKED_PROVIDERS.map((id) => (
          <label key={id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
            <input
              type="checkbox"
              data-testid={`quota-provider-${id}`}
              checked={!!draft.providers?.[id]?.enabled}
              onChange={(e) => setProvider(id, e.target.checked)}
            />
            {providerLabel(id)}
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        data-testid="quota-save"
        onClick={() => send({ type: "plugin_config_write", id: "quota", config: draft })}
        style={{
          marginTop: 8,
          fontSize: 11,
          padding: "3px 10px",
          border: "1px solid var(--border-subtle, rgba(82,82,91,0.7))",
          borderRadius: 4,
          background: "var(--bg-tertiary, rgba(63,63,70,0.4))",
          color: "var(--text-primary, #e4e4e7)",
          cursor: "pointer",
        }}
      >
        {t("save", undefined, "Save")}
      </button>
    </section>
  );
}
