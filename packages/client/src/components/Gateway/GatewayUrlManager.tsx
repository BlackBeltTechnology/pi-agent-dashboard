/**
 * "Add a gateway URL" — the ONE operator action of D12, plus the per-gateway
 * status row and Fix of D13.
 *
 * One shared component rendered from BOTH entry points (`GatewaySetupGuide`
 * first-run step and the persistent Gateway-page control), so the two cannot
 * drift. Not gated on "no tunnel active": a gateway and a tunnel legitimately
 * coexist, and hiding the control while a tunnel is up would strand the
 * operator mid-migration.
 *
 * All config algebra lives in `lib/gateway/gateway-action.ts` (pure, unit
 * tested); this file is presentation plus one `PUT /api/config` per action.
 *
 * See change: config-override-oauth-redirect-base.
 */

import type { GatewayAuthMode, GatewayRecord } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import {
  buildGatewayAddPatch,
  buildGatewayFixPatch,
  buildGatewayRemovePatch,
  computeGatewayStatus,
  type GatewayConfigShape,
  type GatewayValidationCode,
  validateGatewayDraft,
} from "../../lib/gateway/gateway-action.js";
import { getConfig, putConfig } from "../../lib/gateway/gateway-api.js";
import { suggestTrustEntries } from "../../lib/gateway/gateway-config-ops.js";
import { useI18n } from "../../lib/i18n/i18n.js";

const MODE_LABEL: Record<GatewayAuthMode, string> = {
  "trusted-network": "Trusted network",
  pairing: "QR pairing",
  oauth: "OAuth sign-in",
};

const ERROR_COPY: Record<GatewayValidationCode, string> = {
  "url-invalid": "Enter a full http:// or https:// URL.",
  "no-auth-mode": "Pick at least one way in — a gateway with none is either unreachable or unprotected.",
  "insecure-pairing": "QR pairing needs publicly-trusted TLS; a http:// URL can never ride the QR.",
  "insecure-oauth": "OAuth providers refuse a non-TLS redirect URI.",
  "insecure-needs-trusted-network":
    "A http:// gateway is only reachable through a trusted network — add one.",
  "trusted-network-empty": "Add at least one address or CIDR for the trusted network.",
};

const STATUS_COPY: Record<string, string> = {
  ok: "OK",
  incomplete: "Incomplete — a value this gateway wrote is missing",
  conflicting: "Conflicting — another value holds the OAuth redirect base",
  ineligible: "Ineligible — the recorded access modes are no longer legal for this URL",
};

function useConfig() {
  const [config, setConfig] = useState<GatewayConfigShape>({});
  const refresh = useCallback(async () => {
    setConfig((await getConfig()) as GatewayConfigShape);
  }, []);
  useEffect(() => {
    void refresh().catch(() => {
      /* keep the empty config; every action re-reads before writing */
    });
  }, [refresh]);
  return { config, refresh };
}

export function GatewayUrlManager() {
  const { t } = useI18n();
  const { config, refresh } = useConfig();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [modes, setModes] = useState<GatewayAuthMode[]>([]);
  const [cidr, setCidr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = { url, authModes: modes, trustedNetworks: cidr ? [cidr] : [] };
  const validation = validateGatewayDraft(draft);
  const gateways = config.gateways ?? [];
  // Identical-value authorship is not recoverable by provenance (D12), so the
  // add dialog says it out loud instead of guessing at removal time.
  const willClaimExistingBase =
    modes.includes("oauth") && !!config.auth?.redirectBaseUrl && config.auth.redirectBaseUrl === url.trim();

  // The CIDR prefill reuses the existing suggestion rule — an exact /32, never
  // a whole subnet handed over as the default (D12).
  useEffect(() => {
    if (!modes.includes("trusted-network") || cidr) return;
    try {
      const host = new URL(url).hostname;
      setCidr(suggestTrustEntries(host)[0]?.value ?? "");
    } catch {
      /* incomplete URL — no prefill yet */
    }
  }, [modes, url, cidr]);

  const toggleMode = (m: GatewayAuthMode) =>
    setModes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const run = async (build: (cfg: GatewayConfigShape) => Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      // Re-read immediately before the write to shrink the lost-update window.
      const fresh = (await getConfig()) as GatewayConfigShape;
      await putConfig(build(fresh));
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("gateway.url.err", undefined, "Failed to write config"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const okDone = await run((cfg) => buildGatewayAddPatch(cfg, draft));
    if (okDone) {
      setOpen(false);
      setUrl("");
      setModes([]);
      setCidr("");
    }
  };

  return (
    <div data-testid="gateway-url-manager">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {t("gateway.url.title", undefined, "Gateway URLs")}
      </p>

      <div className="flex flex-col gap-1.5">
        {gateways.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">
            {t("gateway.url.empty", undefined, "No gateway URL configured yet.")}
          </p>
        ) : (
          gateways.map((g: GatewayRecord) => {
            const { status, missing, conflictHolder } = computeGatewayStatus(config, g);
            return (
              <div
                key={g.url}
                data-testid="gateway-url-row"
                data-status={status}
                className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5"
              >
                <code className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">{g.url}</code>
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {g.authModes.map((m) => MODE_LABEL[m]).join(", ")}
                </span>
                <span
                  className={`rounded px-1.5 py-px text-[9.5px] ${status === "ok" ? "text-[var(--green,#2ea043)]" : "text-[var(--amber,#d29922)]"}`}
                  title={conflictHolder ? `Currently: ${conflictHolder}` : undefined}
                >
                  {STATUS_COPY[status]}
                </span>
                {status !== "ok" && status !== "ineligible" && (
                  <button
                    type="button"
                    data-testid="gateway-url-fix"
                    disabled={busy}
                    title={`Restores: ${Object.keys(missing).join(", ")}`}
                    onClick={() => void run((cfg) => buildGatewayFixPatch(cfg, g))}
                    className="rounded border border-[var(--border)] px-2 py-px text-[11px] text-[var(--text-primary)]"
                  >
                    {t("gateway.url.fix", undefined, "Fix")}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="gateway-url-remove"
                  disabled={busy}
                  onClick={() => {
                    const reverts = Object.keys(g.wrote ?? {}).join(", ");
                    if (!window.confirm(`Removing ${g.url} reverts: ${reverts}`)) return;
                    void run((cfg) => buildGatewayRemovePatch(cfg, g.url));
                  }}
                  className="rounded border border-[var(--border)] px-2 py-px text-[11px] text-[var(--text-primary)]"
                >
                  {t("gateway.url.remove", undefined, "Remove")}
                </button>
              </div>
            );
          })
        )}
      </div>

      {!open ? (
        <button
          type="button"
          data-testid="gateway-url-add-open"
          onClick={() => setOpen(true)}
          className="mt-3 flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
        >
          <Icon path={mdiPlus} size={0.6} /> {t("gateway.url.add", undefined, "Add gateway URL")}
        </button>
      ) : (
        <div className="mt-3 rounded border border-[var(--border)] p-3" data-testid="gateway-url-dialog">
          <input
            type="url"
            inputMode="url"
            placeholder="https://pi.example.com"
            data-testid="gateway-url-input"
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)]"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />

          <div className="mt-2 flex flex-col gap-1">
            {(["trusted-network", "pairing", "oauth"] as GatewayAuthMode[]).map((m) => {
              const blocked =
                !validation.secure && (m === "pairing" || m === "oauth") && url.trim().length > 0;
              return (
                <label key={m} className="flex items-center gap-2 text-[12px] text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    data-testid={`gateway-url-mode-${m}`}
                    disabled={blocked}
                    checked={modes.includes(m)}
                    onChange={() => toggleMode(m)}
                  />
                  <span className={blocked ? "opacity-50" : undefined}>{MODE_LABEL[m]}</span>
                  {blocked && (
                    <span className="text-[10.5px] text-[var(--text-secondary)]" data-testid={`gateway-url-mode-${m}-reason`}>
                      {ERROR_COPY[m === "pairing" ? "insecure-pairing" : "insecure-oauth"]}
                    </span>
                  )}
                  {!blocked && m === "trusted-network" && !validation.secure && url.trim().length > 0 && (
                    <span className="text-[10.5px] text-[var(--text-secondary)]">
                      {t("gateway.url.httpNeedsTrust", undefined, "required for a http:// gateway")}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {modes.includes("trusted-network") && (
            <input
              type="text"
              placeholder="10.4.0.9/32"
              data-testid="gateway-url-cidr"
              className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)]"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
            />
          )}

          {willClaimExistingBase && (
            <p className="mt-2 text-[11px] text-[var(--amber,#d29922)]" data-testid="gateway-url-claim-warning">
              {t(
                "gateway.url.claimWarning",
                undefined,
                "This value is already set; removing this gateway later will clear it.",
              )}
            </p>
          )}

          {url.trim().length > 0 && !validation.ok && (
            <ul className="mt-2 list-disc pl-4 text-[11px] text-[var(--danger,#ef4444)]" data-testid="gateway-url-errors">
              {validation.errors.map((code) => (
                <li key={code}>{ERROR_COPY[code]}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="mt-2 text-[11px] text-[var(--danger,#ef4444)]" data-testid="gateway-url-error">
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              data-testid="gateway-url-save"
              disabled={busy || !validation.ok}
              onClick={() => void add()}
              className="rounded bg-[var(--accent-solid)] px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? t("gateway.saving", undefined, "Saving…") : t("gateway.url.save", undefined, "Add gateway")}
            </button>
            <button
              type="button"
              data-testid="gateway-url-cancel"
              onClick={() => setOpen(false)}
              className="rounded border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--text-primary)]"
            >
              {t("gateway.cancel", undefined, "Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
