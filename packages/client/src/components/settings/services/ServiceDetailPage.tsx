/**
 * Settings → Services → <id>. State, why-callout (reason, hint, drivers tried,
 * retry countdown), the action bar (only what is legal for the state — design
 * D9; the server stays the authority and a refusal shows at the action), lease
 * holders as plain text, update diff, secrets, output, and the danger zone.
 *
 * The detail renders from the LIST entry (kept fresh by `services_changed`). The
 * probing `GET /api/services/:id` runs only when the detail opens and on an
 * explicit Refresh — never on a ping.
 * See change: add-services-settings-ui (D1, D3, D9, D11).
 */

import type { ServiceStatus } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { mdiAlertCircleOutline, mdiArrowLeft, mdiRefresh } from "@mdi/js";
import { useCallback, useEffect, useId, useState } from "react";
import type { UseServices } from "../../../hooks/useServices.js";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { addService, getService, runVerb, type ServicesResult, type ServiceVerb } from "../../../lib/services/services-api.js";
import { actionsFor, reasonSentence, stateMeta, untilText, whySentence } from "../../../lib/services/services-model.js";
import { BUTTON_CLASS, Callout, DANGER_BUTTON_CLASS, GHOST_BUTTON_CLASS, HELP_CLASS, PRIMARY_BUTTON_CLASS, VIcon } from "../vault/vault-ui.js";
import { ForceStopDialog, RemoveDialog, ResetDataDialog } from "./ServiceDialogs.js";
import { ServiceLogsPanel } from "./ServiceLogsPanel.js";
import { ServiceSecretsSection } from "./ServiceSecretsSection.js";
import { useTicker } from "./ServicesListPage.js";
import { ActionFailure, Chip, SectionTitle, ServicesOperateCallout, StatePill } from "./services-ui.js";

type Dialog = "remove" | "reset" | "force" | null;

const show = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

function WhyCallout({ s, now }: { s: ServiceStatus; now: number }) {
  const sentence = whySentence(s, true);
  if (!sentence) return null;
  return (
    <Callout tone={s.state === "blocked" ? "warning" : "error"} icon={mdiAlertCircleOutline} role="status" testId="service-why">
      <strong data-testid="service-why-sentence">{sentence}</strong>
      {s.state === "failed" && s.retryAt && (
        <p className="m-0 mt-1">
          {i18nT("services.nextRetry", undefined, "Next automatic retry")} <span data-testid="service-retry-countdown">{untilText(s.retryAt, now)}</span>.
        </p>
      )}
      {s.hint && (
        <p className="m-0 mt-1" data-testid="service-why-hint">
          {s.hint}
        </p>
      )}
      {s.tried && s.tried.length > 0 && (
        <div className="mt-2">
          <p className="m-0 font-semibold">{i18nT("services.tried", undefined, "Drivers tried")}</p>
          <ul className="m-0 list-none space-y-0.5 p-0" data-testid="service-tried">
            {s.tried.map((t) => (
              <li key={t.driver}>
                <code className="font-mono">{t.driver}</code>: {reasonSentence(t.reason)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Callout>
  );
}

function LeaseHolders({ holders }: { holders: NonNullable<ServiceStatus["leaseHolders"]> }) {
  if (holders.length === 0) return <>{i18nT("services.leases.none", undefined, "nothing right now")}</>;
  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {holders.map((h, i) => (
        <li key={i}>
          {/* Holder text is caller-supplied: rendered as text, never as markup. */}
          <span data-testid="service-lease-holder">{h.holder ?? i18nT("services.leases.unnamed", undefined, "(unnamed)")}</span>{" "}
          <span className={HELP_CLASS}>
            {i18nT("services.leases.until", undefined, "until")} {new Date(h.expiresAt).toLocaleTimeString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

const EXPOSURE_EN: Record<string, string> = {
  "all-interfaces": "the network (all interfaces)",
  loopback: "this computer only",
};

function StatusSection({ s }: { s: ServiceStatus }) {
  const endpoints = Object.entries(s.endpoints ?? {});
  return (
    <section aria-labelledby="service-status-title" data-testid="service-status">
      <SectionTitle id="service-status-title">{i18nT("services.status.title", undefined, "Status")}</SectionTitle>
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
        {endpoints.length > 0 && (
          <>
            <dt className="font-semibold text-[var(--text-secondary)]">{i18nT("services.endpoints", undefined, "Endpoints")}</dt>
            <dd className="m-0 space-y-0.5" data-testid="service-endpoints">
              {endpoints.map(([name, url]) => (
                <div key={name}>
                  <Chip>{name}</Chip> <span className="font-mono text-xs">{url}</span>
                </div>
              ))}
            </dd>
          </>
        )}
        {s.exposure && (
          <>
            <dt className="font-semibold text-[var(--text-secondary)]">{i18nT("services.exposure", undefined, "Reachable from")}</dt>
            <dd className="m-0">{i18nT(`services.exposure.${s.exposure}`, undefined, EXPOSURE_EN[s.exposure] ?? "unknown")}</dd>
          </>
        )}
        <dt className="font-semibold text-[var(--text-secondary)]">{i18nT("services.leases", undefined, "In use by")}</dt>
        <dd className="m-0" data-testid="service-lease-holders">
          <LeaseHolders holders={s.leaseHolders ?? []} />
        </dd>
      </dl>
    </section>
  );
}

function UpdateSection({ s, disabled, onApply }: { s: ServiceStatus; disabled: boolean; onApply: () => void }) {
  if (!s.updateAvailable || !s.diff) return null;
  return (
    <section aria-labelledby="service-update-title" data-testid="service-update">
      <SectionTitle id="service-update-title">{i18nT("services.update.title", undefined, "A newer template is available")}</SectionTitle>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-[var(--text-secondary)]">
            <th className="py-1 pr-2">{i18nT("services.update.path", undefined, "Field")}</th>
            <th className="py-1 pr-2">{i18nT("services.update.from", undefined, "Now")}</th>
            <th className="py-1">{i18nT("services.update.to", undefined, "New")}</th>
          </tr>
        </thead>
        <tbody>
          {s.diff.map((d) => (
            <tr key={d.path} className="border-t border-[var(--border-subtle)] align-top">
              <td className="py-1 pr-2 font-mono">{d.path}</td>
              <td className="py-1 pr-2 font-mono break-all">{show(d.from)}</td>
              <td className="py-1 font-mono break-all">{show(d.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2">
        <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={disabled} onClick={onApply} data-testid="service-update-apply">
          {i18nT("services.update.apply", undefined, "Apply update")}
        </button>
      </div>
    </section>
  );
}

function ActionBar({
  s,
  disabled,
  onVerb,
  onForce,
  failed,
}: {
  s: ServiceStatus;
  disabled: boolean;
  onVerb: (v: ServiceVerb) => void;
  onForce: () => void;
  /** The verb whose refusal is on screen and the id of that error, so the button is described by it. */
  failed?: { verb: string; id: string } | null;
}) {
  const a = actionsFor(s);
  const desc = (verb: string) => (failed?.verb === verb ? failed.id : undefined);
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={i18nT("services.actions", undefined, "Actions")} data-testid="service-actions">
      {a.start && (
        <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={disabled} aria-describedby={desc("start")} onClick={() => onVerb("start")} data-testid={`service-action-${a.start}`}>
          {a.start === "try-again" ? i18nT("services.action.tryAgain", undefined, "Try again") : i18nT("services.action.start", undefined, "Start")}
        </button>
      )}
      {a.retry && (
        <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={disabled} aria-describedby={desc("retry")} onClick={() => onVerb("retry")} data-testid="service-action-retry">
          {i18nT("services.action.retry", undefined, "Retry now")}
        </button>
      )}
      {a.prefetch && (
        <button type="button" className={BUTTON_CLASS} disabled={disabled} aria-describedby={desc("prefetch")} onClick={() => onVerb("prefetch")} data-testid="service-action-prefetch">
          {i18nT("services.action.prefetch", undefined, "Download package")}
        </button>
      )}
      {a.stop && (
        <button type="button" className={BUTTON_CLASS} disabled={disabled} aria-describedby={desc("stop")} onClick={() => onVerb("stop")} data-testid="service-action-stop">
          {i18nT("services.action.stop", undefined, "Stop")}
        </button>
      )}
      {a.forceStop && (
        <button type="button" className={DANGER_BUTTON_CLASS} disabled={disabled} onClick={onForce} data-testid="service-action-force-stop">
          {i18nT("services.action.forceStop", undefined, "Force stop")}
        </button>
      )}
      {a.pin && (
        <button type="button" className={BUTTON_CLASS} disabled={disabled} aria-describedby={desc("pin")} onClick={() => onVerb("pin")} data-testid="service-action-pin">
          {i18nT("services.action.pin", undefined, "Keep running (pin)")}
        </button>
      )}
      {a.unpin && (
        <button type="button" className={BUTTON_CLASS} disabled={disabled} aria-describedby={desc("unpin")} onClick={() => onVerb("unpin")} data-testid="service-action-unpin">
          {i18nT("services.action.unpin", undefined, "Unpin")}
        </button>
      )}
    </div>
  );
}

export function ServiceDetailPage({ id, services, navigate }: { id: string; services: UseServices; navigate: (to: string) => void }) {
  const { list, canOperate } = services;
  const [probed, setProbed] = useState<ServiceStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [busyVerb, setBusyVerb] = useState<string | null>(null);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [failedVerb, setFailedVerb] = useState<string | null>(null);
  const failureId = useId();
  const [dialog, setDialog] = useState<Dialog>(null);

  // The probing GET: once on open, and on an explicit Refresh.
  const probe = useCallback(async () => {
    setProbing(true);
    const res = await getService(id);
    setProbing(false);
    if (res.ok && res.data) setProbed(res.data);
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: opens once per service id.
  useEffect(() => {
    setProbed(null);
    setFailure(null);
    setFailedVerb(null);
    void probe();
  }, [id]);

  const s: ServiceStatus | undefined = list?.services.find((x) => x.id === id) ?? probed ?? undefined;
  const now = useTicker(s?.state === "failed" && !!s.retryAt);

  const perform = async (verb: ServiceVerb) => {
    setBusyVerb(verb);
    setFailure(null);
    setFailedVerb(null);
    const res = await runVerb(id, verb);
    setBusyVerb(null);
    if (!res.ok) {
      setFailure(res);
      setFailedVerb(verb);
    }
    void services.refetch();
  };

  const applyUpdate = async () => {
    if (!s || s.origin === undefined || s.origin === "user") return;
    setBusyVerb("update");
    setFailure(null);
    setFailedVerb(null);
    const res = await addService({ offer: `${s.origin.package}#${s.id}`, update: true }, false);
    setBusyVerb(null);
    if (!res.ok) {
      setFailure(res);
      setFailedVerb("update");
    }
    void services.refetch();
  };

  if (!s) {
    return <p className={HELP_CLASS}>{i18nT("services.loading", undefined, "Loading services…")}</p>;
  }
  const a = actionsFor(s);
  const off = !canOperate || busyVerb !== null;
  const meta = stateMeta(s.state);

  return (
    <div className="space-y-4" data-testid="service-detail" data-service={s.id}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={GHOST_BUTTON_CLASS} onClick={() => navigate("/settings/services")} data-testid="service-back">
          <VIcon path={mdiArrowLeft} size={0.6} />
          {i18nT("services.backToList", undefined, "All services")}
        </button>
        <h2 className="m-0 text-base font-semibold text-[var(--text-primary)]">{s.id}</h2>
        <StatePill state={s.state} />
        {s.mode && <Chip>{s.mode}</Chip>}
        {s.driver && <Chip>{s.driver}</Chip>}
        {s.startedBy === "external" && <Chip>{i18nT("services.startedExternally", undefined, "Not started by the dashboard")}</Chip>}
        {s.restartRequired && <Chip tone="orange">{i18nT("services.restartRequired", undefined, "Restart to apply")}</Chip>}
        <span className="grow" />
        <button type="button" className={BUTTON_CLASS} disabled={probing} onClick={() => void probe().then(() => services.refetch())} data-testid="service-refresh">
          <VIcon path={mdiRefresh} size={0.6} />
          {i18nT("services.refresh", undefined, "Refresh")}
        </button>
      </div>
      <span className="sr-only" role="status">
        {meta.label}
      </span>

      {!canOperate && (
        <ServicesOperateCallout
          testId="services-readonly-banner"
          title={i18nT("services.readOnly.title", undefined, "You can look, not change")}
          why={i18nT("services.readOnly.why", undefined, "Starting, stopping and editing services — and reading their output — needs operate access, which this connection does not have.")}
        />
      )}

      <WhyCallout s={s} now={now} />
      <ActionBar s={s} disabled={off} onVerb={perform} onForce={() => setDialog("force")} failed={failure && !failure.ok && failedVerb ? { verb: failedVerb, id: failureId } : null} />
      <ActionFailure failure={failure} id={failureId} />
      <StatusSection s={s} />
      <UpdateSection s={s} disabled={off} onApply={applyUpdate} />
      <ServiceSecretsSection service={s} disabled={off} onSaved={() => void services.refetch()} />
      <ServiceLogsPanel serviceId={s.id} canOperate={canOperate} />

      <section aria-labelledby="service-danger-title" className="rounded-lg border border-[var(--tint-red-border)] p-3" data-testid="service-danger">
        <SectionTitle id="service-danger-title">{i18nT("services.danger.title", undefined, "Danger zone")}</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {a.resetData && (
            <button type="button" className={DANGER_BUTTON_CLASS} disabled={off} onClick={() => setDialog("reset")} data-testid="service-action-reset-data">
              {i18nT("services.action.resetData", undefined, "Reset data…")}
            </button>
          )}
          <button type="button" className={DANGER_BUTTON_CLASS} disabled={off} onClick={() => setDialog("remove")} data-testid="service-action-remove">
            {i18nT("services.action.remove", undefined, "Remove service…")}
          </button>
        </div>
      </section>

      {dialog === "remove" && (
        <RemoveDialog
          service={s}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void services.refetch();
            navigate("/settings/services");
          }}
        />
      )}
      {dialog === "reset" && <ResetDataDialog service={s} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void services.refetch(); }} />}
      {dialog === "force" && <ForceStopDialog service={s} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void services.refetch(); }} />}
    </div>
  );
}
