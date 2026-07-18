/**
 * Gateway Setup — provider + mode segmented controls.
 *
 * Reusable section (task 9.1). Provider buttons: zrok / ngrok / tailscale /
 * zerotier. Mode buttons gated by the provider matrix (`supportsMode`): a mode
 * the provider cannot serve is disabled, and switching to a provider that does
 * not support the current mode auto-selects a valid one. All strings say
 * "Gateway"; the wire keeps `tunnel`.
 *
 * See change: add-tunnel-providers.
 */
import type { TunnelMode } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import {
  GATEWAY_PROVIDERS,
  type GatewayProviderId,
  providerMeta,
  supportsMode,
} from "../../lib/gateway/gateway-providers.js";
import { useI18n } from "../../lib/i18n/i18n.js";

interface Props {
  provider: GatewayProviderId;
  mode: TunnelMode;
  onChange: (next: { provider: GatewayProviderId; mode: TunnelMode }) => void;
  disabled?: boolean;
}

export function GatewayProviderSection({ provider, mode, onChange, disabled }: Props) {
  const { t } = useI18n();
  const meta = providerMeta(provider);
  const MODE_SUB: Record<TunnelMode, string> = {
    public: t("gateway.mode.publicSub", undefined, "funnel · internet"),
    private: t("gateway.mode.privateSub", undefined, "tailnet / mesh only"),
  };

  const selectProvider = (id: GatewayProviderId) => {
    // Keep the mode if the new provider supports it, else pick its first mode.
    const nextMode = supportsMode(id, mode) ? mode : providerMeta(id).modes[0];
    onChange({ provider: id, mode: nextMode });
  };

  return (
    <div data-testid="gateway-provider-section">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {t("gateway.provider", undefined, "Provider")}
      </p>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={t("gateway.aria.provider", undefined, "Gateway provider")}>
        {GATEWAY_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            aria-pressed={p.id === provider}
            data-testid={`gateway-provider-${p.id}`}
            onClick={() => selectProvider(p.id)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-50 ${
              p.id === provider
                ? "border-[var(--accent,#3b82f6)] bg-[var(--accent-soft,#1d3a63)] text-[var(--text-primary)]"
                : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {t("gateway.mode", undefined, "Mode")}
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("gateway.aria.mode", undefined, "Gateway mode")}>
        {(["public", "private"] as TunnelMode[]).map((m) => {
          const ok = meta.modes.includes(m);
          return (
            <button
              key={m}
              type="button"
              disabled={disabled || !ok}
              aria-pressed={m === mode}
              title={ok ? undefined : t("gateway.modeUnsupported", { provider: meta.label, mode: m }, `${meta.label} does not support ${m} mode`)}
              data-testid={`gateway-mode-${m}`}
              onClick={() => onChange({ provider, mode: m })}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                m === mode && ok
                  ? "border-[var(--accent,#3b82f6)] bg-[var(--accent-soft,#1d3a63)] text-[var(--text-primary)]"
                  : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {m === "public" ? t("gateway.mode.public", undefined, "Public") : t("gateway.mode.private", undefined, "Private")}
              <span className="ml-1.5 text-[10.5px] text-[var(--text-muted)]">{MODE_SUB[m]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
