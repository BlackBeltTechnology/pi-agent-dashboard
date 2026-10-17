/**
 * Settings → Services → Runtimes: what container runtimes and hypervisors this
 * machine has, and what the dashboard may do with them. Read-only: there is no
 * control that starts or stops a host VM or hypervisor.
 * See change: add-services-settings-ui ("Runtimes page").
 */
import type { RuntimeReport } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { mdiAlertCircleOutline, mdiRefresh } from "@mdi/js";
import { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { getRuntimes, type ServicesResult } from "../../../lib/services/services-api.js";
import { BUTTON_CLASS, Callout, HELP_CLASS, VIcon } from "../vault/vault-ui.js";

const yesNo = (v: boolean | undefined): string =>
  v === undefined ? "—" : v ? i18nT("common.yes", undefined, "Yes") : i18nT("common.no", undefined, "No");

const CAPABILITY_EN: Record<string, string> = {
  ok: "ok",
  "ok-destructive": "ok (can delete)",
  "cli-present": "tool present",
  "needs-secret": "needs a secret",
  unavailable: "unavailable",
  unsupported: "not supported",
};
const capText = (v: string): string => i18nT(`services.capability.${v}`, undefined, CAPABILITY_EN[v] ?? v);

const HOST_VM_EN: Record<string, string> = { running: "running", stopped: "stopped", none: "none", unknown: "unknown" };

export function RuntimesPage() {
  const [reports, setReports] = useState<RuntimeReport[] | null>(null);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const res = await getRuntimes();
    setBusy(false);
    if (res.ok && res.data) {
      setReports(res.data);
      setFailure(null);
    } else setFailure(res);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open
  useEffect(() => {
    void load();
  }, []);

  const caps = [...new Set((reports ?? []).flatMap((r) => Object.keys(r.capabilities)))];

  return (
    <div className="space-y-3" data-testid="runtimes-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`${HELP_CLASS} m-0 max-w-[60ch]`}>
          {i18nT("services.runtimes.lead", undefined, "Detected on this machine. The dashboard reports virtual machines and never starts or stops them.")}
        </p>
        <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={load} data-testid="runtimes-refresh">
          <VIcon path={mdiRefresh} size={0.6} />
          {i18nT("services.refresh", undefined, "Refresh")}
        </button>
      </div>
      {failure && (
        <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId="runtimes-error">
          {failure.error}
        </Callout>
      )}
      {!reports && !failure && <p className={HELP_CLASS}>{i18nT("services.runtimes.loading", undefined, "Detecting runtimes…")}</p>}
      {reports && (
        // The matrix scrolls inside its card on a phone (WCAG 1.4.10 data-table exemption).
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
          <table className="w-full min-w-max border-collapse text-sm" data-testid="runtimes-table">
            <thead>
              <tr className="text-left text-xs text-[var(--text-secondary)]">
                <th scope="col" className="p-2">{i18nT("services.runtimes.runtime", undefined, "Runtime")}</th>
                <th scope="col" className="p-2">{i18nT("services.runtimes.installed", undefined, "Installed")}</th>
                <th scope="col" className="p-2">{i18nT("services.runtimes.version", undefined, "Version")}</th>
                <th scope="col" className="p-2">{i18nT("services.runtimes.reachable", undefined, "Reachable")}</th>
                <th scope="col" className="p-2">{i18nT("services.runtimes.hostVm", undefined, "Host VM")}</th>
                {caps.map((c) => (
                  <th key={c} scope="col" className="p-2">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} data-testid={`runtime-${r.id}`} className="border-t border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <th scope="row" className="p-2 text-left font-semibold">
                    {r.id}
                    <span className={`${HELP_CLASS} block font-normal`}>{r.kind}</span>
                  </th>
                  <td className="p-2" data-testid={`runtime-${r.id}-installed`}>{yesNo(r.installed)}</td>
                  <td className="p-2 font-mono text-xs">{r.version ?? "—"}</td>
                  <td className="p-2" data-testid={`runtime-${r.id}-reachable`}>{r.kind === "container" ? yesNo(r.reachable) : "—"}</td>
                  <td className="p-2">
                    {r.hostVm ? i18nT(`services.hostVm.${r.hostVm}`, undefined, HOST_VM_EN[r.hostVm] ?? r.hostVm) : "—"}
                  </td>
                  {caps.map((c) => (
                    <td key={c} className="p-2" data-testid={`runtime-${r.id}-cap-${c}`}>
                      {r.capabilities[c] ? capText(r.capabilities[c]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
