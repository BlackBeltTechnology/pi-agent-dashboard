/**
 * Gateway "Accessible at" — every tagged address the dashboard answers on,
 * with a kind pill + TLS / no-TLS badge + copy button, plus the migrated
 * **Add HTTPS URL** control (task 6.4).
 *
 * Add-HTTPS write path (D4, no bespoke route): re-read the current config,
 * append the entered URL to `pairing.publicBaseUrls` preserving siblings, and
 * PUT the FULL `pairing` object through the auth-gated `PUT /api/config`
 * (`writeConfigPartial` shallow-overwrites `pairing`). On success, re-fetch the
 * endpoint list so the new URL appears in "Accessible at" and — when TLS — the
 * pairing QR. The `https`/`wss` gate is UX-only here; the server drops plain
 * http at read time regardless.
 *
 * See change: add-tunnel-providers.
 */

import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { mdiCheck, mdiContentCopy, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { getConfig, putConfig } from "../../lib/gateway/gateway-api.js";
import { appendPublicBaseUrl, isSecureBaseUrl, type PairingConfigShape } from "../../lib/gateway/gateway-config-ops.js";
import { getGatewayEndpoints } from "../../lib/gateway/gateway-endpoints.js";
import { useI18n } from "../../lib/i18n/i18n.js";

const KIND_CLASS: Record<string, string> = {
  public: "bg-[var(--green-soft,#132d1c)] text-[#5dd67f]",
  mesh: "bg-[#152a3a] text-[#5cb8e6]",
  magicdns: "bg-[#152a3a] text-[#5cb8e6]",
  lan: "bg-[#2a2440] text-[#b79cf0]",
  local: "bg-[var(--bg-secondary)] text-[var(--text-muted)]",
};

function EndpointRow({ ep }: { ep: TunnelEndpoint }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ep.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5"
      data-testid="gateway-endpoint"
    >
      <span
        className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${KIND_CLASS[ep.kind] ?? KIND_CLASS.local}`}
      >
        {ep.kind}
      </span>
      <code className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]" title={ep.url}>
        {ep.url}
      </code>
      {ep.kind !== "local" &&
        (ep.tls ? (
          <span className="rounded border border-[#23502f] px-1.5 py-px text-[9.5px] text-[var(--green,#2ea043)]">
            TLS
          </span>
        ) : (
          <span className="rounded border border-[#4a3c14] px-1.5 py-px text-[9.5px] text-[var(--amber,#d29922)]">
            {t("gateway.noTls", undefined, "no TLS")}
          </span>
        ))}
      <button
        type="button"
        onClick={copy}
        title={copied ? t("gateway.copied", undefined, "Copied!") : t("gateway.copy", undefined, "Copy")}
        data-testid="gateway-endpoint-copy"
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.6} />
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
      // Re-read immediately before PUT to shrink the shallow-overwrite window.
      const cfg = await getConfig();
      const pairing = (cfg.pairing as PairingConfigShape | undefined) ?? {};
      const nextPairing = appendPublicBaseUrl(pairing, url);
      await putConfig({ pairing: nextPairing });
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
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {t("gateway.accessibleAt", undefined, "Accessible at")}
      </p>
      <div className="flex flex-col gap-1.5">
        {endpoints.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">{t("gateway.noEndpoints", undefined, "No reachable endpoints yet.")}</p>
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
          className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)]"
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
          className="flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
        >
          <Icon path={mdiPlus} size={0.6} /> {saving ? t("gateway.adding", undefined, "Adding…") : t("gateway.addHttpsUrl", undefined, "Add HTTPS URL")}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-[var(--danger,#ef4444)]" data-testid="gateway-add-https-error">
          {error}
        </p>
      )}
      <p className="mt-1.5 text-[10.5px] text-[var(--text-muted)]">
        {t(
          "gateway.addUrlHint",
          undefined,
          "Add your own reverse-proxy / funnel URL. Only https/wss endpoints ride the pairing QR (D14).",
        )}
      </p>
    </div>
  );
}
