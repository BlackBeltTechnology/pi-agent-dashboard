/**
 * **Built-in HTTPS** section of the Gateway page (approved board:
 * `openspec/changes/add-tailscale-cert-tls/mockups/tls.html`).
 *
 * Source-neutral shell: heading + status pill, an enable switch that writes
 * `tls.enabled` immediately (the server reconciles live, no restart), the
 * advertised address, listener gates with their fixes, Port / Listen-on fields
 * committed by an explicit Apply, and a Certificates list grouped by source
 * (rendered through the `registerTlsSourceGroup` registry).
 *
 * Status = `/api/health.tls`, re-read every 5 s while mounted (never
 * overlapping) and immediately after this section's own writes / issue calls.
 * "Checking…" until the first read: a default is never rendered as fact.
 *
 * Tokens + `connectivity-ui` recipes only. Copy says "pair", never "sign in":
 * a login started from the TLS origin returns to the resolved redirect base.
 *
 * See change: add-tailscale-cert-tls (design D11).
 */
import { hasTlsDetail, type TlsGate, type TlsStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { mdiAlert, mdiCheck, mdiContentCopy, mdiInformationOutline, mdiLockOutline, mdiOpenInNew, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useId, useState } from "react";
import { getConfig, putConfig } from "../../lib/gateway/gateway-api.js";
import { issueTlsNow } from "../../lib/gateway/tls-api.js";
import { deriveTlsPill, describeApplyError, isHeld, planApply } from "../../lib/gateway/tls-view.js";
import { useTlsStatus } from "../../lib/gateway/use-tls-status.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { copyText } from "../../lib/util/clipboard.js";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, callout, errorMessage, HELP, INPUT, INSET, LABEL, META, severityPill } from "../connectivity/connectivity-ui.js";
import { tlsSourceGroupFor } from "./tls-source-groups.js";

/** Gates that belong to the listener (shown with its fields); the rest sit with their source group. */
const LISTENER_GATES = new Set(["bind-reachable"]);

interface Props {
  /** Focus the Tailscale setup on the same page (the readiness board). */
  onSetupRequested?: () => void;
  /** Fixed clock for tests. */
  now?: () => number;
}

function ipv4Of(status: TlsStatusDetail): string | null {
  for (const s of status.sources) {
    const v = s.details?.ipv4;
    if (typeof v === "string" && v) return v;
  }
  return null;
}

const certUrl = (name: string, port: number): string => `https://${name}${port === 443 ? "" : `:${port}`}`;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one view shell over the status; the pill, row, apply-error and validation rules live in `lib/gateway/tls-view.ts`
export function GatewayTlsSection({ onSetupRequested, now = Date.now }: Props) {
  const { t } = useI18n();
  const ids = useId();
  const { status, readFailed, refresh } = useTlsStatus();
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const [hostDraft, setHostDraft] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const detail: TlsStatusDetail | null = status && hasTlsDetail(status) ? status : null;
  const enabled = pendingEnabled ?? status?.enabled ?? false;
  const clock = now();

  // ── actions ──
  const toggle = async () => {
    if (pendingEnabled !== null || !status) return;
    const next = !enabled;
    setPendingEnabled(next);
    setSwitchError(null);
    try {
      let seed = false;
      if (next) {
        const cfg = await getConfig().catch(() => ({}) as Record<string, unknown>);
        const stored = (cfg.tls as { sources?: unknown[] } | undefined)?.sources;
        seed = !Array.isArray(stored) || stored.length === 0;
      }
      await putConfig({ tls: { enabled: next, ...(seed ? { sources: [{ type: "tailscale" }] } : {}) } });
    } catch (e) {
      setSwitchError(errorMessage(e, t("gateway.tls.err.saveFailed", undefined, "Could not save this setting")));
    } finally {
      setPendingEnabled(null);
      void refresh(true);
    }
  };

  const issue = (sourceId: string, name?: string) => {
    setActionError(null);
    setBusyKey(`${sourceId}\u0000${name ?? ""}`);
    issueTlsNow(sourceId, name)
      .catch((e: unknown) => setActionError(errorMessage(e, t("gateway.tls.err.issueFailed", undefined, "Could not start the certificate request"))))
      .finally(() => {
        setBusyKey(null);
        void refresh(true);
      });
  };

  const useIpv4 = async (ipv4: string) => {
    setActionError(null);
    try {
      const cfg = await getConfig();
      const stored = (cfg.tls as Record<string, unknown> | undefined) ?? {};
      await putConfig({ tls: { ...stored, host: ipv4 } });
    } catch (e) {
      setActionError(errorMessage(e, t("gateway.tls.err.saveFailed", undefined, "Could not save this setting")));
    } finally {
      void refresh(true);
    }
  };

  const apply = async () => {
    if (!detail) return;
    setPortError(null);
    setHostError(null);
    const draft = planApply(detail, portDraft, hostDraft);
    if (draft.kind === "invalid") {
      setPortError(t("gateway.tls.err.portRange", undefined, "Enter a port from 1 to 65535."));
      return;
    }
    if (draft.kind === "unchanged") {
      setPortDraft(null);
      setHostDraft(null);
      return;
    }
    setApplying(true);
    try {
      await putConfig({ tls: draft.patch });
      setPortDraft(null);
      setHostDraft(null);
    } catch (e) {
      const view = describeApplyError(errorMessage(e, ""), draft.patch.port ?? detail.port, t);
      if (view.field === "host") setHostError(view.message);
      else setPortError(view.message);
    } finally {
      setApplying(false);
      void refresh(true);
    }
  };

  const copyAddress = async (url: string) => {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  const pill = deriveTlsPill(status, enabled, clock, t);

  // ── gate callouts ──
  const ipv4 = detail ? ipv4Of(detail) : null;
  const checkNow = (g: TlsGate): ReactNode =>
    g.sourceId ? (
      <button type="button" className={BTN_SMALL} data-testid={`gateway-tls-check-${g.id}`} onClick={() => issue(g.sourceId as string)}>
        <Icon path={mdiRefresh} size={0.5} aria-hidden="true" />
        {t("gateway.tls.gate.checkNow", undefined, "Check now")}
      </button>
    ) : null;

  const renderGate = (g: TlsGate): ReactNode => {
    const testId = `gateway-tls-gate-${g.id}`;
    const wrap = (children: ReactNode) => (
      <div className={callout("warning")} role="note" data-testid={testId}>
        <Icon path={mdiAlert} size={0.6} className="mt-px flex-none" aria-hidden="true" />
        <div className="min-w-0 space-y-1.5">{children}</div>
      </div>
    );
    if (g.id === "tailscale-running") {
      return wrap(
        <>
          <p>
            <b>{t("gateway.tls.gate.tailscaleTitle", undefined, "Tailscale isn't running on this computer.")}</b>{" "}
            {t("gateway.tls.gate.tailscaleBody", undefined, "Start Tailscale and sign in, then this check runs again.")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {onSetupRequested && (
              <button type="button" className={BTN_SMALL} onClick={onSetupRequested} data-testid="gateway-tls-setup-tailscale">
                {t("gateway.tls.gate.setupTailscale", undefined, "Set up Tailscale above")}
              </button>
            )}
            {checkNow(g)}
          </div>
        </>,
      );
    }
    if (g.id === "https-certs") {
      return wrap(
        <>
          <p>
            <b>{t("gateway.tls.gate.httpsTitle", undefined, "HTTPS certificates are off for your tailnet.")}</b>{" "}
            {t("gateway.tls.gate.httpsLead", undefined, "Turn them on once, in the Tailscale admin console:")}
          </p>
          <ol className="list-decimal pl-[18px]">
            <li>{t("gateway.tls.gate.httpsStep1", undefined, "Open DNS.")}</li>
            <li>{t("gateway.tls.gate.httpsStep2", undefined, "Turn on MagicDNS if it is off.")}</li>
            <li>{t("gateway.tls.gate.httpsStep3", undefined, "Under HTTPS Certificates, select Enable HTTPS.")}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://login.tailscale.com/admin/dns"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline"
              data-testid="gateway-tls-admin-link"
            >
              {t("gateway.tls.gate.httpsOpen", undefined, "Open Tailscale DNS settings")}
              <Icon path={mdiOpenInNew} size={0.5} aria-hidden="true" />
              <span className="sr-only">{t("gateway.tls.newTab", undefined, "(opens in a new tab)")}</span>
            </a>
            {checkNow(g)}
          </div>
          <p className="text-[11px]">
            {t("gateway.tls.gate.httpsMeta", undefined, "Checked automatically every 15 minutes. Your device name is published in public certificate logs.")}
          </p>
        </>,
      );
    }
    if (g.id === "bind-reachable") {
      const host = detail?.host ?? "127.0.0.1";
      return wrap(
        <>
          <p>
            <b>{t("gateway.tls.gate.bindTitle", undefined, "Only this computer can open it.")}</b>{" "}
            {t("gateway.tls.gate.bindBody", { host }, "HTTPS listens on {host}. Listen on the Tailscale address so your other devices can reach it.")}
          </p>
          {ipv4 && (
            <button type="button" className={BTN_PRIMARY} data-testid="gateway-tls-use-ipv4" onClick={() => void useIpv4(ipv4)}>
              {t("gateway.tls.gate.useIpv4", { ip: ipv4 }, "Use {ip}")}
            </button>
          )}
        </>,
      );
    }
    if (g.id === "name-conflict") {
      return wrap(
        <p>
          <b>{t("gateway.tls.gate.conflictTitle", { name: g.name ?? "" }, "{name} is already provided by another source.")}</b>{" "}
          {t("gateway.tls.gate.conflictBody", undefined, "Only the first source for a name issues its certificate.")}
        </p>,
      );
    }
    return wrap(
      <p>
        <b>{g.id}</b>
        {g.hint ? `: ${g.hint}` : ""}
      </p>,
    );
  };

  const issueCtx = { now: clock, issue, renderGate, busyKey };

  // ── render ──
  const head = (
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <span className="inline-flex text-[var(--text-secondary)]">
        <Icon path={mdiLockOutline} size={0.7} aria-hidden="true" />
      </span>
      <h3 id={`${ids}-h`} className="text-xs font-semibold text-[var(--text-secondary)]">
        {t("gateway.tls.title", undefined, "Built-in HTTPS")}
      </h3>
      <span className={severityPill(pill.severity)} data-testid="gateway-tls-pill" data-severity={pill.severity}>
        <Icon path={pill.icon} size={0.5} spin={pill.spin} aria-hidden="true" />
        {pill.label}
      </span>
    </div>
  );
  const lead = (
    <p className="mb-3 text-xs text-[var(--text-secondary)]">
      {t(
        "gateway.tls.lead",
        undefined,
        "Serve this dashboard over HTTPS on a second port with trusted certificates, so phones and browsers connect without warnings. Phones need HTTPS to pair and to get notifications. The main port keeps working.",
      )}
    </p>
  );

  if (!status) {
    return (
      <section aria-labelledby={`${ids}-h`} data-testid="gateway-tls">
        {head}
        {lead}
        <p className={HELP} role={readFailed ? "status" : undefined} data-testid="gateway-tls-checking">
          {readFailed
            ? t("gateway.tls.err.readFailed", undefined, "Could not read the HTTPS status. Retrying…")
            : t("gateway.tls.checking", undefined, "Checking…")}
        </p>
      </section>
    );
  }

  const listenerGates = detail?.gates.filter((g) => !g.ok && LISTENER_GATES.has(g.id)) ?? [];
  const looseGates = detail?.gates.filter((g) => !g.ok && !LISTENER_GATES.has(g.id) && !g.sourceId) ?? [];
  const anyUnmet = detail?.gates.some((g) => !g.ok) ?? false;
  const heldCerts = detail ? detail.certs.filter((c) => isHeld(c, clock)) : [];
  const advertised = heldCerts.find((c) => c.advertise) ?? heldCerts[0];
  const showAddress = !!(detail && advertised && detail.bound && !detail.bindError && !anyUnmet);
  const portValue = portDraft ?? String(detail?.port ?? "");
  const hostValue = hostDraft ?? detail?.host ?? "";
  const bindErr = detail?.bindError ?? "";
  const portFieldError =
    portError ??
    (/EADDRINUSE/.test(bindErr)
      ? t("gateway.tls.err.portBusy", { port: detail?.port ?? "" }, "Port {port} is already used by another program. Pick another port.")
      : /EACCES/.test(bindErr)
        ? t("gateway.tls.err.portDenied", undefined, "This port needs administrator rights. Pick a port above 1024.")
        : null);
  const hostFieldError =
    hostError ??
    (/EADDRNOTAVAIL/.test(bindErr)
      ? t("gateway.tls.err.hostUnavailable", undefined, "That address is not available on this computer yet. It is retried automatically.")
      : null);
  const dirty = (portDraft !== null && portDraft !== String(detail?.port ?? "")) || (hostDraft !== null && hostDraft !== (detail?.host ?? ""));

  return (
    <section aria-labelledby={`${ids}-h`} data-testid="gateway-tls" className="space-y-3">
      <div>
        {head}
        {lead}
      </div>

      {/* Switch: writes tls.enabled immediately; reverts with an inline error on a failed write. */}
      <div>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span id={`${ids}-sl`} className={LABEL}>
              {t("gateway.tls.switch", undefined, "Serve HTTPS on its own port")}
            </span>
            <p id={`${ids}-sd`} className={HELP}>
              {t("gateway.tls.switchHint", undefined, "Applies right away, no restart. Off by default.")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby={`${ids}-sl`}
            aria-describedby={`${ids}-sd`}
            aria-busy={pendingEnabled !== null || undefined}
            disabled={pendingEnabled !== null}
            data-testid="gateway-tls-enabled"
            onClick={() => void toggle()}
            className="focus-ring inline-flex min-h-[44px] flex-none cursor-pointer items-center gap-2 rounded-md px-1.5 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[32px]"
          >
            <span
              aria-hidden="true"
              className={`relative h-5 w-10 flex-none rounded-full border ${
                enabled ? "border-[var(--accent-solid)] bg-[var(--accent-solid)]" : "border-[var(--border-strong)] bg-[var(--bg-surface)]"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full transition-transform motion-reduce:transition-none ${
                  enabled ? "translate-x-5 bg-white" : "translate-x-0 bg-[var(--text-secondary)]"
                }`}
              />
            </span>
            <span aria-hidden="true" className="min-w-[2em] text-xs font-semibold text-[var(--text-secondary)]">
              {enabled ? t("gateway.tls.on", undefined, "On") : t("gateway.tls.off", undefined, "Off")}
            </span>
          </button>
        </div>
        {switchError && (
          <p role="alert" data-testid="gateway-tls-switch-error" className="mt-1 text-xs text-[var(--severity-error-fg)]">
            {switchError}
          </p>
        )}
      </div>

      {enabled && detail && (
        <>
          {showAddress && advertised && (
            <div className={INSET}>
              <p className={LABEL}>{t("gateway.tls.address", undefined, "Address")}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <code className="min-w-0 flex-[1_1_220px] break-all font-mono text-xs text-[var(--text-primary)]" data-testid="gateway-tls-url">
                  {certUrl(advertised.name, detail.port)}
                </code>
                <button type="button" className={BTN_SMALL} data-testid="gateway-tls-copy" onClick={() => void copyAddress(certUrl(advertised.name, detail.port))}>
                  <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.5} aria-hidden="true" />
                  {copied ? t("gateway.tls.copied", undefined, "Copied") : t("gateway.tls.copy", undefined, "Copy")}
                </button>
                <a
                  className={BTN_SMALL}
                  href={certUrl(advertised.name, detail.port)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="gateway-tls-open"
                >
                  <Icon path={mdiOpenInNew} size={0.5} aria-hidden="true" />
                  {t("gateway.tls.open", undefined, "Open")}
                  <span className="sr-only">{t("gateway.tls.newTab", undefined, "(opens in a new tab)")}</span>
                </a>
              </div>
              <p className={`mt-1.5 ${HELP}`} data-testid="gateway-tls-name-note">
                {t(
                  "gateway.tls.nameNote",
                  { ip: detail.host },
                  "Connect using this name. An IP address such as {ip} won't work: the certificate is issued for the name.",
                )}
              </p>
              <p className={`mt-1 ${HELP}`}>
                {t("gateway.tls.addressNote", undefined, "Shown in Accessible at and offered by Connect a device.")}
              </p>
            </div>
          )}

          {actionError && (
            <p role="alert" data-testid="gateway-tls-action-error" className="text-xs text-[var(--severity-error-fg)]">
              {actionError}
            </p>
          )}

          {looseGates.map((g) => (
            <div key={`${g.id}:${g.hint ?? ""}`}>{renderGate(g)}</div>
          ))}
          {listenerGates.map((g) => (
            <div key={g.id}>{renderGate(g)}</div>
          ))}

          {/* Port / Listen on — committed by an explicit Apply. */}
          <div className={INSET}>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
              <div>
                <label className={LABEL} htmlFor={`${ids}-port`}>
                  {t("gateway.tls.port", undefined, "Port")}
                </label>
                <input
                  id={`${ids}-port`}
                  className={`${INPUT} font-mono`}
                  inputMode="numeric"
                  value={portValue}
                  aria-invalid={portFieldError ? "true" : undefined}
                  aria-describedby={portFieldError ? `${ids}-port-e` : `${ids}-port-h`}
                  data-testid="gateway-tls-port"
                  onChange={(e) => {
                    setPortDraft(e.target.value);
                    setPortError(null);
                  }}
                />
                {!portFieldError && (
                  <p id={`${ids}-port-h`} className={`mt-1 ${META}`}>
                    {t("gateway.tls.portHint", undefined, "Default 8443.")}
                  </p>
                )}
              </div>
              <div>
                <label className={LABEL} htmlFor={`${ids}-host`}>
                  {t("gateway.tls.host", undefined, "Listen on")}
                </label>
                <input
                  id={`${ids}-host`}
                  className={`${INPUT} font-mono`}
                  value={hostValue}
                  aria-invalid={hostFieldError ? "true" : undefined}
                  aria-describedby={hostFieldError ? `${ids}-host-e` : `${ids}-host-h`}
                  data-testid="gateway-tls-host"
                  onChange={(e) => {
                    setHostDraft(e.target.value);
                    setHostError(null);
                  }}
                />
                {!hostFieldError && (
                  <p id={`${ids}-host-h`} className={`mt-1 ${META}`}>
                    {ipv4 && detail.host !== ipv4 && listenerGates.length === 0 && (
                      <>
                        <button type="button" className="focus-ring min-h-[24px] underline" onClick={() => void useIpv4(ipv4)} data-testid="gateway-tls-use-ipv4-inline">
                          {t("gateway.tls.useTailscaleAddress", { ip: ipv4 }, "Use Tailscale address {ip}")}
                        </button>
                        {" · "}
                      </>
                    )}
                    {t("gateway.tls.hostHint", undefined, "The Tailscale address limits HTTPS to your tailnet.")}
                  </p>
                )}
              </div>
              {portFieldError && (
                <p id={`${ids}-port-e`} role="alert" className="col-span-full -mt-1 text-xs text-[var(--severity-error-fg)]" data-testid="gateway-tls-port-error">
                  {portFieldError}
                </p>
              )}
              {hostFieldError && (
                <p id={`${ids}-host-e`} role="alert" className="col-span-full -mt-1 text-xs text-[var(--severity-error-fg)]" data-testid="gateway-tls-host-error">
                  {hostFieldError}
                </p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_SECONDARY} disabled={!dirty || applying} aria-disabled={!dirty || applying || undefined} onClick={() => void apply()} data-testid="gateway-tls-apply">
                {t("gateway.tls.apply", undefined, "Apply")}
              </button>
              <span className={META}>{t("gateway.tls.applyHint", undefined, "Restarts only the HTTPS listener.")}</span>
            </div>
          </div>

          {/* Certificates, grouped by source. */}
          <div>
            <p className={LABEL} id={`${ids}-ch`}>
              {t("gateway.tls.certificates", undefined, "Certificates")}
            </p>
            <div className="space-y-3" role="group" aria-labelledby={`${ids}-ch`}>
              {detail.sources.map((source) => {
                const Group = tlsSourceGroupFor(source.type);
                return (
                  <Group
                    key={source.id}
                    source={source}
                    certs={detail.certs.filter((c) => c.sourceId === source.id)}
                    gates={detail.gates.filter((g) => !g.ok && g.sourceId === source.id)}
                    ctx={issueCtx}
                  />
                );
              })}
            </div>
          </div>

          {heldCerts.length > 0 && !anyUnmet && (
            <div className={callout("info")} role="note" data-testid="gateway-tls-trust-hint">
              <Icon path={mdiInformationOutline} size={0.6} className="mt-px flex-none" aria-hidden="true" />
              <div className="min-w-0">
                {t(
                  "gateway.tls.trustHint",
                  undefined,
                  "Tailnet devices still have to pair before they get in. To skip that for your whole tailnet, add 100.64.0.0/10 as a trusted network on the Security page.",
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
