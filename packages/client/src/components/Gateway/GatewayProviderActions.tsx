/**
 * The per-provider action group on a readiness row: **Make primary** (D10) and
 * the **register this live URL as a gateway** offer (D9).
 *
 * Both actions exist because the alternative is a silent write. Promoting a
 * provider re-mints the OAuth redirect URI, and registering a URL as a gateway
 * publishes an address under an access mode that cannot be inferred from the
 * URL — so each states its consequence inline and applies only on a second,
 * deliberate click. Neither uses `window.confirm`: the confirmation has to be
 * READ, and the consequence text is the point of it.
 *
 * All the algebra is pure and lives in `lib/gateway/primary-switch.ts` and
 * `lib/gateway/gateway-action.ts`; this file is presentation plus one
 * `PUT /api/config` per applied action.
 *
 * See change: add-zrok-custom-reserved-name (D9/D10).
 */

import type { GatewayAuthMode } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type {
  ProviderReadiness,
  TunnelProviderId,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { useState } from "react";
import {
  buildGatewayAddPatch,
  buildGatewayModeOffer,
  type GatewayConfigShape,
  type GatewayModeOffer,
  isUnregisteredGatewayUrl,
} from "../../lib/gateway/gateway-action.js";
import { getConfig, putConfig } from "../../lib/gateway/gateway-api.js";
import {
  buildPrimarySwitchPatch,
  canMakePrimary,
  primarySwitchConsequence,
} from "../../lib/gateway/primary-switch.js";
import { useI18n } from "../../lib/i18n/i18n.js";

const MODE_LABEL: Record<GatewayAuthMode, string> = {
  "trusted-network": "Trusted network",
  pairing: "QR pairing",
  oauth: "OAuth sign-in",
};

/** The provider's live URL, when it has one. Only a connected provider owes one. */
function liveUrl(readiness: ProviderReadiness): string | undefined {
  return readiness.endpoints[0]?.url;
}

export function GatewayProviderActions({
  readiness,
  isPrimary,
  config,
  onConfigChange,
}: {
  readiness: ProviderReadiness;
  isPrimary: boolean;
  config: GatewayConfigShape;
  onConfigChange: () => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [offering, setOffering] = useState(false);
  const [modes, setModes] = useState<GatewayAuthMode[]>([]);
  const [cidr, setCidr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = liveUrl(readiness);
  const showPrimary = canMakePrimary({ state: readiness.state, isPrimary });
  // The offer is bound to a LIVE url: a provider that is not connected has no
  // URL to register, so there is nothing to offer (shipped scenario).
  const showOffer =
    readiness.state === "connected" && !!url && isUnregisteredGatewayUrl(config, url);

  if (!showPrimary && !showOffer) return null;

  const write = async (patch: (cfg: GatewayConfigShape) => Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      // Re-read immediately before the write: the board polls, and a stale
      // `gateways` array would drop a record added from another surface.
      const fresh = (await getConfig()) as GatewayConfigShape;
      await putConfig(patch(fresh));
      onConfigChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to write config");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const offers = url ? buildGatewayModeOffer({ url, isPrimary }) : [];
  const needsCidr = modes.includes("trusted-network") && offers.some((o) => o.requires === "cidr");
  const canSave = modes.length > 0 && (!needsCidr || cidr.trim().length > 0);

  return (
    <div
      data-testid={`gateway-provider-actions-${readiness.provider}`}
      className="mt-1 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {showPrimary && (
          // Placed BEFORE the offer, matching "ahead of its disconnect action"
          // in the same action group.
          <button
            type="button"
            data-testid={`gateway-make-primary-${readiness.provider}`}
            disabled={busy}
            onClick={() => setConfirming((v) => !v)}
            className="rounded border border-[var(--border-primary)] px-2 py-1 text-[11px] text-[var(--text-primary)] disabled:opacity-50"
          >
            {t("gateway.primary.make", undefined, "Make primary")}
          </button>
        )}
        {showOffer && (
          <button
            type="button"
            data-testid={`gateway-register-offer-${readiness.provider}`}
            disabled={busy}
            onClick={() => setOffering((v) => !v)}
            className="rounded border border-[var(--border-primary)] px-2 py-1 text-[11px] text-[var(--text-primary)] disabled:opacity-50"
          >
            {t("gateway.offer.register", undefined, "Register as gateway URL")}
          </button>
        )}
      </div>

      {confirming && (
        <div
          data-testid={`gateway-make-primary-confirm-${readiness.provider}`}
          className="mt-2 rounded border border-[var(--border-primary)] p-2"
        >
          <p className="text-[11px] text-[var(--severity-warning-fg)]">
            {primarySwitchConsequence(readiness.provider, isPrimaryLabel(config))}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid={`gateway-make-primary-apply-${readiness.provider}`}
              disabled={busy}
              onClick={() =>
                void write(() => buildPrimarySwitchPatch(readiness.provider)).then((ok) => {
                  if (ok) setConfirming(false);
                })
              }
              className="rounded bg-[var(--accent-solid)] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {t("gateway.primary.apply", undefined, "Make primary")}
            </button>
            <button
              type="button"
              data-testid={`gateway-make-primary-cancel-${readiness.provider}`}
              onClick={() => setConfirming(false)}
              className="rounded border border-[var(--border-primary)] px-2.5 py-1 text-[11px] text-[var(--text-primary)]"
            >
              {t("gateway.cancel", undefined, "Cancel")}
            </button>
          </div>
        </div>
      )}

      {offering && url && (
        <OfferPanel
          provider={readiness.provider}
          url={url}
          offers={offers}
          modes={modes}
          setModes={setModes}
          cidr={cidr}
          setCidr={setCidr}
          needsCidr={needsCidr}
          canSave={canSave}
          busy={busy}
          error={error}
          onCancel={() => setOffering(false)}
          onSave={() =>
            void write((cfg) =>
              buildGatewayAddPatch(cfg, {
                url,
                authModes: modes,
                trustedNetworks: cidr.trim() ? [cidr.trim()] : [],
              }),
            ).then((ok) => {
              if (ok) {
                setOffering(false);
                setModes([]);
                setCidr("");
              }
            })
          }
        />
      )}

      {error && !offering && (
        <p data-testid={`gateway-actions-error-${readiness.provider}`} className="mt-2 text-[11px] text-[var(--danger,#ef4444)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** The provider currently holding `tunnel.provider`, for the consequence copy. */
function isPrimaryLabel(config: GatewayConfigShape): string | undefined {
  const tunnel = (config as { tunnel?: { provider?: string } }).tunnel;
  return tunnel?.provider;
}

/** The registration offer's expanded panel (D9) — mode picker plus its write. */
function OfferPanel({
  provider,
  url,
  offers,
  modes,
  setModes,
  cidr,
  setCidr,
  needsCidr,
  canSave,
  busy,
  error,
  onSave,
  onCancel,
}: {
  provider: TunnelProviderId;
  url: string;
  offers: GatewayModeOffer[];
  modes: GatewayAuthMode[];
  setModes: (fn: (prev: GatewayAuthMode[]) => GatewayAuthMode[]) => void;
  cidr: string;
  setCidr: (v: string) => void;
  needsCidr: boolean;
  canSave: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
        <div
          data-testid={`gateway-offer-panel-${provider}`}
          className="mt-2 rounded border border-[var(--border-primary)] p-2"
        >
          <code className="block truncate font-mono text-[11px] text-[var(--text-secondary)]">{url}</code>
          <div className="mt-1 flex flex-col gap-1">
            {offers.map((o) => (
              <label
                key={o.mode}
                className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-primary)]"
              >
                <input
                  type="checkbox"
                  data-testid={`gateway-offer-mode-${o.mode}`}
                  disabled={!o.available}
                  checked={modes.includes(o.mode)}
                  onChange={() =>
                    setModes((prev) =>
                      prev.includes(o.mode) ? prev.filter((m) => m !== o.mode) : [...prev, o.mode],
                    )
                  }
                />
                <span className={o.available ? undefined : "opacity-60"}>{MODE_LABEL[o.mode]}</span>
                {/* Ineligible modes render WITH their reason, never hidden — a
                    hidden mode is indistinguishable from an unimplemented one. */}
                {!o.available && (
                  <span
                    data-testid={`gateway-offer-mode-${o.mode}-reason`}
                    className="text-[10.5px] text-[var(--text-secondary)]"
                  >
                    {o.reason}
                  </span>
                )}
              </label>
            ))}
          </div>

          {needsCidr && (
            <input
              type="text"
              placeholder="10.4.0.9/32"
              data-testid={`gateway-offer-cidr-${provider}`}
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              className="mt-2 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
            />
          )}

          {modes.includes("oauth") && (
            // Registering the PRIMARY's URL with oauth writes
            // `auth.redirectBaseUrl` — the same consequence a primary switch
            // carries, so it carries the same statement.
            <p
              data-testid={`gateway-offer-oauth-consequence-${provider}`}
              className="mt-2 text-[11px] text-[var(--severity-warning-fg)]"
            >
              {primarySwitchConsequence(provider)}
            </p>
          )}

          {error && (
            <p data-testid={`gateway-offer-error-${provider}`} className="mt-2 text-[11px] text-[var(--danger,#ef4444)]">
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid={`gateway-offer-save-${provider}`}
              disabled={busy || !canSave}
              onClick={onSave}
              className="rounded bg-[var(--accent-solid)] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {t("gateway.offer.save", undefined, "Register")}
            </button>
            <button
              type="button"
              data-testid={`gateway-offer-cancel-${provider}`}
              onClick={onCancel}
              className="rounded border border-[var(--border-primary)] px-2.5 py-1 text-[11px] text-[var(--text-primary)]"
            >
              {t("gateway.cancel", undefined, "Cancel")}
            </button>
          </div>
        </div>
  );
}
