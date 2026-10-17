/**
 * Settings → Services → All services. Rows grouped Needs attention → Running →
 * Stopped (each with its count; an empty group is not rendered). Every row says
 * what is wrong in a plain sentence; the whole row opens the detail.
 * See change: add-services-settings-ui (D1, "Service list page").
 */

import type { ServiceStatus } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { mdiAlertCircleOutline, mdiPlus } from "@mdi/js";
import { useEffect, useState } from "react";
import type { UseServices } from "../../../hooks/useServices.js";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { groupLabel, groupServices, untilText, whySentence } from "../../../lib/services/services-model.js";
import { BUTTON_CLASS, Callout, HELP_CLASS, PRIMARY_BUTTON_CLASS, VIcon } from "../vault/vault-ui.js";
import { AddServiceDialog } from "./AddServiceDialog.js";
import { PruneDialog } from "./ServiceDialogs.js";
import { Chip, ServicesOperateCallout, StatePill } from "./services-ui.js";

/** Re-render once a second while `active` (the retry countdown) — display only, no request. */
export function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function ServiceRow({ s, now, onOpen }: { s: ServiceStatus; now: number; onOpen: () => void }) {
  const why = whySentence(s);
  const endpoints = Object.entries(s.endpoints ?? {});
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`service-row-${s.id}`}
        data-state={s.state}
        className="focus-ring w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3 text-left hover:bg-[var(--bg-hover)] max-sm:min-h-[44px]"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[var(--text-primary)]">{s.id}</span>
          <StatePill state={s.state} />
          {s.mode && <Chip>{s.mode}</Chip>}
          {s.driver && <Chip>{s.driver}</Chip>}
          {s.pinned && <Chip testId="service-pinned">{i18nT("services.pinned", undefined, "Pinned")}</Chip>}
          {s.updateAvailable && (
            <Chip tone="blue" testId="service-update-badge">
              {i18nT("services.updateAvailable", undefined, "Update available")}
            </Chip>
          )}
          {s.restartRequired && (
            <Chip tone="orange" testId="service-restart-badge">
              {i18nT("services.restartRequired", undefined, "Restart to apply")}
            </Chip>
          )}
          {s.exposure === "all-interfaces" && (
            <Chip tone="orange" testId="service-exposure-badge">
              {i18nT("services.exposed", undefined, "Reachable from the network")}
            </Chip>
          )}
          {s.leases > 0 && (
            <span className={HELP_CLASS} data-testid="service-leases">
              {i18nT("services.leaseCount", { n: s.leases }, "{n} in use")}
            </span>
          )}
        </span>
        {endpoints.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
            {endpoints.map(([name, url]) => (
              <span key={name}>
                <Chip>{name}</Chip> <span className="font-mono">{url}</span>
              </span>
            ))}
          </span>
        )}
        {why && (
          <span className="mt-1 block text-sm text-[var(--text-primary)]" data-testid={`service-why-${s.id}`}>
            {why}
            {s.state === "failed" && s.retryAt && (
              <>
                {" "}
                {i18nT("services.nextRetry", undefined, "Next automatic retry")} <span data-testid="service-retry-countdown">{untilText(s.retryAt, now)}</span>.
              </>
            )}
            {s.hint && <span className={`${HELP_CLASS} block`}>{s.hint}</span>}
          </span>
        )}
      </button>
    </li>
  );
}

export function ServicesListPage({
  services,
  navigate,
  notFoundId,
}: {
  services: UseServices;
  navigate: (to: string) => void;
  /** A detail URL named an unknown service: show the list with a notice. */
  notFoundId?: string | null;
}) {
  const { list, loading, error, canOperate } = services;
  const [adding, setAdding] = useState(false);
  const [pruning, setPruning] = useState(false);
  const groups = groupServices(list?.services ?? []);
  const failedWithRetry = (list?.services ?? []).some((s) => s.state === "failed" && s.retryAt);
  const now = useTicker(failedWithRetry);

  return (
    <div className="space-y-4" data-testid="services-list-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`${HELP_CLASS} m-0 max-w-[60ch]`}>
          {i18nT("services.list.lead", undefined, "Shared services such as document converters that dashboard add-ons use. The dashboard starts them on demand and stops them when idle.")}
        </p>
        <div className="flex gap-2">
          <button type="button" className={BUTTON_CLASS} disabled={!canOperate} onClick={() => setPruning(true)} data-testid="services-prune-open">
            {i18nT("services.prune.open", undefined, "Clean up leftovers")}
          </button>
          <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={!canOperate} onClick={() => setAdding(true)} data-testid="services-add-open">
            <VIcon path={mdiPlus} size={0.6} />
            {i18nT("services.add.open", undefined, "Add service")}
          </button>
        </div>
      </div>

      {list && !canOperate && (
        <ServicesOperateCallout
          testId="services-readonly-banner"
          title={i18nT("services.readOnly.title", undefined, "You can look, not change")}
          why={i18nT("services.readOnly.why", undefined, "Starting, stopping and editing services — and reading their output — needs operate access, which this connection does not have.")}
        />
      )}
      {notFoundId && (
        <Callout tone="warning" icon={mdiAlertCircleOutline} role="status" testId="services-not-found">
          {i18nT("services.notFound", { id: notFoundId }, "There is no service named “{id}”. Showing all services.")}
        </Callout>
      )}
      {list?.definitionsCorrupt && (
        <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId="services-definitions-corrupt">
          {i18nT("services.definitionsCorrupt", undefined, "services.json could not be read, so no service can be changed.")}{" "}
          {list.backupPath && (
            <>
              {i18nT("services.backup", undefined, "A backup was kept at")} <code className="font-mono">{list.backupPath}</code>
            </>
          )}
        </Callout>
      )}
      {list?.secretsCorrupt && (
        <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId="services-secrets-corrupt">
          {i18nT("services.secretsCorrupt", undefined, "The secret store could not be read, so no secret can be saved.")}{" "}
          {list.secretsBackupPath && (
            <>
              {i18nT("services.backup", undefined, "A backup was kept at")} <code className="font-mono">{list.secretsBackupPath}</code>
            </>
          )}
        </Callout>
      )}
      {loading && !list && <p className={HELP_CLASS}>{i18nT("services.loading", undefined, "Loading services…")}</p>}
      {error && !list && (
        <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId="services-load-error">
          {error.error}
        </Callout>
      )}

      {list && !list.definitionsCorrupt && list.services.length === 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4" data-testid="services-empty">
          <h3 className="m-0 text-sm font-semibold text-[var(--text-primary)]">{i18nT("services.empty.title", undefined, "No services yet")}</h3>
          <p className={`${HELP_CLASS} mt-1`}>
            {i18nT("services.empty.body", undefined, "Add one from a package that offers it, or paste a definition. On the command line:")}{" "}
            <code className="font-mono">pi-dashboard service add &lt;id&gt;</code>
          </p>
        </div>
      )}

      {groups.map(({ group, services: rows }) => (
        <section key={group} aria-labelledby={`services-group-${group}`} data-testid={`services-group-${group}`}>
          <h3 id={`services-group-${group}`} className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {groupLabel(group)} <span data-testid={`services-group-count-${group}`}>({rows.length})</span>
          </h3>
          <ul className="m-0 list-none space-y-2 p-0">
            {rows.map((s) => (
              <ServiceRow key={s.id} s={s} now={now} onOpen={() => navigate(`/settings/services/${encodeURIComponent(s.id)}`)} />
            ))}
          </ul>
        </section>
      ))}

      {adding && (
        <AddServiceDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            void services.refetch();
            navigate(`/settings/services/${encodeURIComponent(id)}`);
          }}
        />
      )}
      {pruning && (
        <PruneDialog
          onClose={() => setPruning(false)}
          onDone={() => {
            setPruning(false);
            void services.refetch();
          }}
        />
      )}
    </div>
  );
}
