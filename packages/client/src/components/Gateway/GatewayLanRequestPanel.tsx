/**
 * "Devices on this network" — the operator switch for `pairing.acceptLanRequests`.
 * Rendered by the Gateway page's Connect-a-device surface AND the Remote access
 * wizard's "Let devices ask" step (extracted so the two cannot drift).
 *
 * See change: add-lan-knock-pairing; add-remote-access-wizard (design D5).
 */
import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { mdiCheck, mdiContentCopy } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useId, useState } from "react";
import { getConfig, putConfig } from "../../lib/gateway/gateway-api.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { copyText } from "../../lib/util/clipboard.js";
import { BTN_SMALL, errorMessage, HELP, INSET } from "../connectivity/connectivity-ui.js";

function LanRequestRow({ url, onCopy, copied }: { url: string; onCopy: (url: string) => void; copied: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <code
        data-testid="gateway-lan-request-url"
        className="select-all break-all rounded border border-[var(--border-secondary)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-primary)]"
      >
        {url}
      </code>
      <button
        type="button"
        data-testid="gateway-lan-request-copy"
        aria-label={t("gateway.lan.copyAria", { url }, `Copy ${url}`)}
        onClick={() => onCopy(url)}
        className={`${BTN_SMALL} max-sm:min-h-[44px]`}
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.5} aria-hidden="true" />
        {copied ? t("gateway.lan.copied", undefined, "Copied") : t("gateway.lan.copy", undefined, "Copy")}
      </button>
    </div>
  );
}

/**
 * "Devices on this network" — the operator switch for `pairing.acceptLanRequests`
 * (change: add-lan-knock-pairing, ui-plan D11/D16). One `role="switch"` button
 * holds track + visible On/Off word (state never by colour alone; ≥32 px, 44 px
 * below `sm`). Read/written through the existing `GET/PUT /api/config` path
 * (the server merges `{ pairing: { acceptLanRequests } }`, live, no restart).
 * While on, one Copy row per `kind: "lan"` endpoint the Gateway already lists —
 * never tunnel, localhost or public — as `<url>/pair?request`.
 */
export function LanRequestPanel({
  endpoints,
  onChanged,
}: {
  endpoints: TunnelEndpoint[];
  /** Fired after a successful write, so a host (the wizard) can re-read its snapshot. */
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((cfg) => {
        if (!cancelled) setOn((cfg.pairing as { acceptLanRequests?: boolean } | undefined)?.acceptLanRequests === true);
      })
      .catch(() => {
        if (cancelled) return;
        setOn(false);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    if (busy || on === null) return;
    setBusy(true);
    setError(null);
    setLoadFailed(false);
    try {
      await putConfig({ pairing: { acceptLanRequests: !on } });
      setOn(!on);
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e, t("gateway.lan.err.saveFailed", undefined, "Could not save this setting")));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    const ok = await copyText(url);
    setCopyFailed(!ok);
    setCopiedUrl(ok ? url : null);
    if (ok) setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 1200);
  };

  const lanUrls = endpoints.filter((ep) => ep.kind === "lan").map((ep) => `${ep.url.replace(/\/+$/, "")}/pair?request`);
  const checked = on === true;

  return (
    <section className={`mt-4 space-y-3 ${INSET}`} aria-labelledby={`${ids}-h`} data-testid="gateway-lan-panel">
      <h3 id={`${ids}-h`} className="text-xs font-semibold text-[var(--text-secondary)]">
        {t("gateway.lan.heading", undefined, "Devices on this network")}
      </h3>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span id={`${ids}-l`} className="mb-1 block text-xs font-semibold text-[var(--text-primary)]">
            {t("gateway.lan.switch", undefined, "Accept requests from devices on this network")}
          </span>
          <p id={`${ids}-d`} className={HELP}>
            {t(
              "gateway.lan.switchHelp",
              undefined,
              "A device on your local network can ask to connect. You approve each request by typing the code it shows. Without the Gateway or TLS, requests and the access you grant are unencrypted.",
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${ids}-l`}
          aria-describedby={`${ids}-d`}
          aria-busy={busy || on === null || undefined}
          disabled={busy || on === null}
          data-testid="gateway-lan-switch"
          onClick={() => void toggle()}
          className="focus-ring inline-flex min-h-[44px] flex-none cursor-pointer items-center gap-2 rounded-md px-1.5 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[32px]"
        >
          <span
            aria-hidden="true"
            className={`relative h-5 w-10 flex-none rounded-full border ${
              checked ? "border-[var(--accent-solid)] bg-[var(--accent-solid)]" : "border-[var(--border-strong)] bg-[var(--bg-surface)]"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full transition-transform motion-reduce:transition-none ${
                checked ? "translate-x-5 bg-white" : "translate-x-0 bg-[var(--text-secondary)]"
              }`}
            />
          </span>
          <span aria-hidden="true" className="min-w-[2em] text-xs font-semibold text-[var(--text-secondary)]">
            {checked ? t("gateway.lan.on", undefined, "On") : t("gateway.lan.off", undefined, "Off")}
          </span>
        </button>
      </div>
      {(error || loadFailed) && (
        <p role="alert" data-testid="gateway-lan-error" className="text-xs text-[var(--severity-error-fg)]">
          {error ?? t("gateway.lan.err.loadFailed", undefined, "Could not read this setting")}
        </p>
      )}
      {checked && lanUrls.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">{t("gateway.lan.requestPage", undefined, "Request page")}</p>
          {lanUrls.map((url) => (
            <LanRequestRow key={url} url={url} onCopy={(u) => void copy(u)} copied={copiedUrl === url} />
          ))}
          {copyFailed && (
            <p role="status" data-testid="gateway-lan-copy-failed" className={HELP}>
              {t("gateway.lan.copyFailed", undefined, "Couldn't copy automatically. Select the address and copy it.")}
            </p>
          )}
          <p className={HELP}>
            {t(
              "gateway.lan.requestPageHelp",
              undefined,
              "Open it on the other device, or use Connect in that dashboard's Network Discovery.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}

