/**
 * Gateway "Accessible at" — every tagged address the dashboard answers on,
 * with a kind pill + TLS / no-TLS badge + copy button, plus the migrated
 * **Add HTTPS URL** control (task 6.4).
 *
 * Add-HTTPS write path (D4, no bespoke route): re-read the current config,
 * append the entered URL to the top-level `publicBaseUrls` (seeded from the
 * legacy `pairing.publicBaseUrls` on the first such write), and PUT that list
 * through the auth-gated `PUT /api/config`. On success, re-fetch the endpoint
 * list so the new URL appears in "Accessible at" and — when TLS — the pairing
 * QR. The `https`/`wss` gate is UX-only here; the server drops plain http at
 * read time regardless.
 *
 * See changes: add-tunnel-providers, config-override-oauth-redirect-base.
 */

import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { mdiAlert, mdiCheck, mdiContentCopy, mdiLockOutline, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { getConfig, putConfig } from "../../lib/gateway/gateway-api.js";
import {
  appendPublicBaseUrl,
  isSecureBaseUrl,
  type PublicBaseUrlsConfigShape,
} from "../../lib/gateway/gateway-config-ops.js";
import { getGatewayEndpoints } from "../../lib/gateway/gateway-endpoints.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { copyText } from "../../lib/util/clipboard.js";
import { BTN_ICON_GHOST, severityPill } from "../connectivity/connectivity-ui.js";

/**
 * Kind = the contract's neutral chip with the kind as a WORD. The identity
 * tints are reserved for other meanings (`ui-contract.md` § Colour roles), so
 * the label — not a hue — distinguishes the kinds. An unknown kind falls back
 * to its own name rather than another kind's look.
 * See change: add-tailscale-cert-tls (D11).
 */
const KIND_LABEL: Record<string, { key: string; fallback: string }> = {
  local: { key: "gateway.kind.local", fallback: "Local" },
  lan: { key: "gateway.kind.lan", fallback: "LAN" },
  mesh: { key: "gateway.kind.mesh", fallback: "Mesh" },
  magicdns: { key: "gateway.kind.magicdns", fallback: "MagicDNS" },
  public: { key: "gateway.kind.public", fallback: "Public" },
  domain: { key: "gateway.kind.domain", fallback: "Domain" },
};
const KIND_CHIP =
  "inline-flex shrink-0 items-center rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[var(--text-primary)]";

function EndpointRow({ ep }: { ep: TunnelEndpoint }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(ep.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };
  const kind = KIND_LABEL[ep.kind];
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2.5 py-1.5"
      data-testid="gateway-endpoint"
    >
      <span className={KIND_CHIP} data-kind={ep.kind}>
        {kind ? t(kind.key, undefined, kind.fallback) : ep.kind}
      </span>
      <code className="min-w-0 flex-[1_1_200px] truncate font-mono text-xs text-[var(--text-secondary)]" title={ep.url}>
        {ep.url}
      </code>
      {ep.kind !== "local" &&
        (ep.tls ? (
          <span className={severityPill("success")} data-testid="gateway-endpoint-tls">
            <Icon path={mdiLockOutline} size={0.5} aria-hidden="true" />
            {t("gateway.https", undefined, "HTTPS")}
          </span>
        ) : (
          <span className={severityPill("warning")} data-testid="gateway-endpoint-notls">
            <Icon path={mdiAlert} size={0.5} aria-hidden="true" />
            {t("gateway.noTlsLabel", undefined, "No TLS")}
          </span>
        ))}
      <button
        type="button"
        onClick={copy}
        aria-label={t("gateway.copyEndpoint", { url: ep.url }, "Copy {url}")}
        title={copied ? t("gateway.copied", undefined, "Copied!") : t("gateway.copy", undefined, "Copy")}
        data-testid="gateway-endpoint-copy"
        className={BTN_ICON_GHOST}
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.6} aria-hidden="true" />
      </button>
    </div>
  );
}

interface Props {
  /** Provide endpoints to render statically (tests); otherwise fetched. */
  endpoints?: TunnelEndpoint[];
  onEndpointsChange?: (eps: TunnelEndpoint[]) => void;
}

export function GatewayEndpoints({ endpoints: provided, onEndpointsChange }: Props) {
  const { t } = useI18n();
  const [endpoints, setEndpoints] = useState<TunnelEndpoint[]>(provided ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const eps = await getGatewayEndpoints();
    setEndpoints(eps);
    onEndpointsChange?.(eps);
  }, [onEndpointsChange]);

  useEffect(() => {
    if (provided) {
      setEndpoints(provided);
      return;
    }
    void refresh().catch(() => {
      /* endpoint fetch failed — leave existing list intact */
    });
  }, [provided, refresh]);

  const addUrl = async () => {
    setError(null);
    const url = draft.trim();
    if (!isSecureBaseUrl(url)) {
      setError(t("gateway.err.onlyHttps", undefined, "Only https:// or wss:// endpoints are accepted."));
      return;
    }
    setSaving(true);
    try {
      // Re-read immediately before PUT to shrink the lost-update window.
      const cfg = (await getConfig()) as PublicBaseUrlsConfigShape;
      await putConfig(appendPublicBaseUrl(cfg, url));
      setDraft("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("gateway.err.addUrlFailed", undefined, "Failed to add URL"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="gateway-endpoints">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {t("gateway.accessibleAt", undefined, "Accessible at")}
      </p>
      <div className="flex flex-col gap-1.5">
        {endpoints.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">{t("gateway.noEndpoints", undefined, "No reachable endpoints yet.")}</p>
        ) : (
          endpoints.map((ep) => <EndpointRow key={`${ep.kind}:${ep.url}`} ep={ep} />)
        )}
      </div>

      {/* Add HTTPS URL (task 6.4) */}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="url"
          inputMode="url"
          placeholder="https://dashboard.example.com"
          data-testid="gateway-add-https-input"
          className="flex-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addUrl();
          }}
        />
        <button
          type="button"
          disabled={saving || draft.trim().length === 0}
          data-testid="gateway-add-https-btn"
          onClick={() => void addUrl()}
          className="flex items-center gap-1 rounded border border-[var(--border-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          <Icon path={mdiPlus} size={0.6} /> {saving ? t("gateway.adding", undefined, "Adding…") : t("gateway.addHttpsUrl", undefined, "Add HTTPS URL")}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-[var(--severity-error-fg)]" data-testid="gateway-add-https-error">
          {error}
        </p>
      )}
      <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
        {t(
          "gateway.addUrlHint",
          undefined,
          "Add your own reverse-proxy / funnel URL. Only https/wss endpoints ride the pairing QR (D14).",
        )}
      </p>
    </div>
  );
}
