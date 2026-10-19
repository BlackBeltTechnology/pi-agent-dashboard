/**
 * Certificates list of the Built-in HTTPS section: one group per certificate
 * source, one shared row anatomy (name · state pill · facts · Renew now / Try
 * again now). Groups render through a per-type registry so a new source type
 * (e.g. `add-acme-dns01-certs`) adds its own group without changing the
 * section; an unregistered type gets the generic group (name, pill, Renew now).
 *
 * Tokens + recipes only (`connectivity-ui`); state is never colour alone (icon + word).
 *
 * See change: add-tailscale-cert-tls (design D11).
 */
import type { TlsCertStatus, TlsGate, TlsSourceStatus } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { mdiAlert, mdiAlertCircleOutline, mdiCertificateOutline, mdiRefresh, mdiShieldLockOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ComponentType, ReactNode } from "react";
import { deriveCertRow, retryMinutes } from "../../lib/gateway/tls-view.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { BTN_SMALL, callout, META, ROW, severityPill } from "../connectivity/connectivity-ui.js";

interface TlsGroupContext {
  /** Fixed clock for a render (days-left maths). */
  now: number;
  /** Operator "issue now" for `(sourceId, name?)`; resolves when the request was accepted. */
  issue: (sourceId: string, name?: string) => void;
  /** A gate callout renderer owned by the shell (gates sit with what they block). */
  renderGate: (gate: TlsGate) => ReactNode;
  /** `sourceId`+name that currently has a request being sent. */
  busyKey: string | null;
}

export interface TlsSourceGroupProps {
  source: TlsSourceStatus;
  certs: TlsCertStatus[];
  gates: TlsGate[];
  ctx: TlsGroupContext;
}

const registry = new Map<string, ComponentType<TlsSourceGroupProps>>();

/** Register the group component for a source `type` (last registration wins). */
export function registerTlsSourceGroup(type: string, component: ComponentType<TlsSourceGroupProps>): void {
  registry.set(type, component);
}

export function tlsSourceGroupFor(type: string): ComponentType<TlsSourceGroupProps> {
  return registry.get(type) ?? GenericSourceGroup;
}

function TlsCertRow({ cert, sourceId, ctx }: { cert: TlsCertStatus; sourceId: string; ctx: TlsGroupContext }) {
  const { t } = useI18n();
  const view = deriveCertRow(cert, ctx.now, t);
  const eta = retryMinutes(cert, ctx.now);
  const busy = view.running || ctx.busyKey === `${sourceId}\u0000${cert.name}`;

  return (
    <div className={ROW} data-testid="gateway-tls-cert" data-stage={cert.stage}>
      <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
        <Icon path={mdiCertificateOutline} size={0.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-[1_1_200px]">
        <div className="break-all font-mono text-xs font-semibold text-[var(--text-primary)]">{cert.name}</div>
        <p className={`mt-0.5 ${META}`}>{view.facts}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={severityPill(view.pill.severity)}>
          <Icon path={view.pill.icon} size={0.5} spin={view.pill.spin} aria-hidden="true" />
          {view.pill.label}
        </span>
        <button
          type="button"
          className={BTN_SMALL}
          data-testid="gateway-tls-issue-now"
          disabled={busy}
          aria-disabled={busy || undefined}
          onClick={() => ctx.issue(sourceId, cert.name)}
        >
          <Icon path={mdiRefresh} size={0.5} aria-hidden="true" />
          {view.action}
        </button>
      </div>
      {cert.lastError && <CertErrorCallout held={view.held} eta={eta} error={cert.lastError} />}
    </div>
  );
}

function CertErrorCallout({ held, eta, error }: { held: boolean; eta: number | null; error: string }) {
  const { t } = useI18n();
  return (
    <div className={`${callout(held ? "warning" : "error")} basis-full`} role={held ? "note" : "alert"}>
      <Icon path={held ? mdiAlert : mdiAlertCircleOutline} size={0.6} className="mt-px flex-none" aria-hidden="true" />
      <div className="min-w-0">
        <b>
          {held
            ? t("gateway.tls.row.renewFailed", undefined, "Renewal failed. The current certificate is still served.")
            : t("gateway.tls.row.getFailed", undefined, "Couldn't get a certificate.")}
        </b>
        {eta !== null && <> {t("gateway.tls.row.nextTry", { minutes: eta }, "Next try in {minutes} minutes.")}</>}
        <span className="mt-1 block break-words font-mono text-[11px]" data-testid="gateway-tls-last-error">
          {error}
        </span>
      </div>
    </div>
  );
}

function GroupFrame({
  testId,
  icon,
  title,
  meta,
  children,
}: {
  testId: string;
  icon: string;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-2" data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        <span className="inline-flex text-[var(--text-secondary)]">
          <Icon path={icon} size={0.65} aria-hidden="true" />
        </span>
        <b className="text-[var(--text-primary)]">{title}</b>
        {meta && <span className={META}>{meta}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Shared body: the source's own gates, then one row per name (or a waiting line). */
function GroupBody({ certs, gates, source, ctx }: TlsSourceGroupProps) {
  const { t } = useI18n();
  return (
    <>
      {gates.map((g) => (
        <div key={`${g.id}:${g.name ?? ""}`}>{ctx.renderGate(g)}</div>
      ))}
      {certs.map((c) => (
        <TlsCertRow key={c.name} cert={c} sourceId={source.id} ctx={ctx} />
      ))}
      {certs.length === 0 && (
        <p className="text-xs text-[var(--text-secondary)]">
          {gates.length > 0
            ? t("gateway.tls.group.noneFixFirst", undefined, "No certificate yet: fix the step above first.")
            : t("gateway.tls.group.none", undefined, "No certificate yet.")}
        </p>
      )}
    </>
  );
}

/** Fallback for a source type without a registered group. */
function GenericSourceGroup(props: TlsSourceGroupProps) {
  const { t } = useI18n();
  return (
    <GroupFrame
      testId={`gateway-tls-source-${props.source.id}`}
      icon={mdiShieldLockOutline}
      title={props.source.id}
      meta={t("gateway.tls.group.typeMeta", { type: props.source.type }, "{type}")}
    >
      <GroupBody {...props} />
    </GroupFrame>
  );
}

/** The tailscale source's group (registered below). */
function TailscaleSourceGroup(props: TlsSourceGroupProps) {
  const { t } = useI18n();
  return (
    <GroupFrame
      testId={`gateway-tls-source-${props.source.id}`}
      icon={mdiShieldLockOutline}
      title={t("gateway.tls.group.tailscale", undefined, "Tailscale")}
      meta={t("gateway.tls.group.tailscaleMeta", undefined, "automatic · this machine's tailnet name")}
    >
      <GroupBody {...props} />
    </GroupFrame>
  );
}

registerTlsSourceGroup("tailscale", TailscaleSourceGroup);
