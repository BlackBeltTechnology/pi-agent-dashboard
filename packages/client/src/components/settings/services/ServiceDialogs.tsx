/**
 * The destructive-action dialogs of the Services pages. Each one names what it
 * will do, defaults to the safe choice, and reports a server refusal inline:
 *
 * - Remove: lists what goes; "also delete data volumes" is UNCHECKED and names
 *   each volume; without the tick the request carries no `purgeData`.
 * - Reset data: the confirm stays disabled until the service id is typed.
 * - Force stop: explains the safety check it overrides.
 * - Prune: always a dry-run first (candidates, skipped, runtimes that could not
 *   be checked); the confirm sends exactly the previewed ids.
 *
 * See change: add-services-settings-ui (D10).
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { PruneResult, ServiceStatus, VolumeOutcome } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { useEffect, useId, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { prune, removeService, resetData, runVerb, type ServicesResult } from "../../../lib/services/services-api.js";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS } from "../vault/vault-ui.js";
import { ActionFailure } from "./services-ui.js";

const volumeReason = (reason: VolumeOutcome["reason"]): string => {
  switch (reason) {
    case "volume-shared":
      return i18nT("services.volume.shared", undefined, "kept: another service declares the same volume");
    case "volume-in-use":
      return i18nT("services.volume.inUse", undefined, "kept: a container of another project uses it");
    case "remove-failed":
      return i18nT("services.volume.removeFailed", undefined, "kept: the runtime could not remove it");
    default:
      return i18nT("services.volume.kept", undefined, "kept");
  }
};

/** Per-volume outcome list (reset-data and remove with purge). */
function VolumeReport({ volumes, testId }: { volumes: VolumeOutcome[]; testId: string }) {
  return (
    <ul data-testid={testId} className="m-0 list-none space-y-1 p-0 text-xs">
      {volumes.map((v) => (
        <li key={v.name} data-removed={v.removed} className="text-[var(--text-primary)]">
          <code className="font-mono">{v.name}</code> — {v.removed ? i18nT("services.volume.removed", undefined, "removed") : volumeReason(v.reason)}
        </li>
      ))}
    </ul>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-1">{children}</div>;
}

// ── Remove ─────────────────────────────────────────────────────────────────

export function RemoveDialog({ service, onClose, onDone }: { service: ServiceStatus; onClose: () => void; onDone: () => void }) {
  const volumes = service.volumes ?? [];
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [report, setReport] = useState<VolumeOutcome[] | null>(null);
  const purgeId = useId();

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    const res = await removeService(service.id, purge);
    setBusy(false);
    if (!res.ok) return setFailure(res);
    const kept = res.data?.volumes ?? [];
    if (kept.some((v) => !v.removed)) return setReport(kept);
    onDone();
  };

  return (
    <Dialog open onClose={report ? onDone : onClose} title={i18nT("services.remove.title", { id: service.id }, "Remove {id}?")} size="md" testId="service-remove-dialog">
      {report ? (
        <>
          <p className="text-sm text-[var(--text-primary)]">{i18nT("services.remove.done", undefined, "The service was removed. Some data volumes were kept:")}</p>
          <VolumeReport volumes={report} testId="service-remove-volumes" />
          <Footer>
            <button type="button" className={BUTTON_CLASS} onClick={onDone} data-testid="service-remove-close">
              {i18nT("common.close", undefined, "Close")}
            </button>
          </Footer>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--text-secondary)]">
            {i18nT("services.remove.lead", undefined, "This stops the service if the dashboard runs it and removes:")}
          </p>
          <ul className="m-0 list-disc space-y-0.5 pl-5 text-sm text-[var(--text-primary)]">
            <li>{i18nT("services.remove.entry", undefined, "its entry in services.json")}</li>
            <li>{i18nT("services.remove.container", undefined, "its container or process records and run directory")}</li>
            <li>{i18nT("services.remove.secrets", undefined, "its stored secrets")}</li>
          </ul>
          {volumes.length > 0 && (
            <div className="rounded border border-[var(--border-subtle)] p-2">
              <label htmlFor={purgeId} className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <input id={purgeId} type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} data-testid="service-remove-purge" className="mt-1" />
                <span>
                  {i18nT("services.remove.purge", undefined, "Also delete data volumes")}
                  <span className={`${HELP_CLASS} block`}>
                    {volumes.map((v) => (
                      <code key={v} className="mr-2 font-mono">
                        {v}
                      </code>
                    ))}
                  </span>
                </span>
              </label>
              <p className={`${HELP_CLASS} mt-1`}>{i18nT("services.remove.keepsByDefault", undefined, "Without this the data volumes are kept.")}</p>
            </div>
          )}
          <ActionFailure failure={failure} />
          <Footer>
            <button type="button" className={BUTTON_CLASS} onClick={onClose} data-testid="service-remove-cancel">
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button type="button" className={DANGER_BUTTON_CLASS} disabled={busy} onClick={confirm} data-testid="service-remove-confirm">
              {i18nT("services.remove.confirm", undefined, "Remove service")}
            </button>
          </Footer>
        </>
      )}
    </Dialog>
  );
}

// ── Reset data ─────────────────────────────────────────────────────────────

export function ResetDataDialog({ service, onClose, onDone }: { service: ServiceStatus; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [report, setReport] = useState<VolumeOutcome[] | null>(null);
  const inputId = useId();

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    const res = await resetData(service.id);
    setBusy(false);
    if (!res.ok) return setFailure(res);
    setReport(res.data?.volumes ?? []);
  };

  return (
    <Dialog open onClose={report ? onDone : onClose} title={i18nT("services.reset.title", { id: service.id }, "Reset data of {id}?")} size="md" testId="service-reset-dialog">
      {report ? (
        <>
          <p className="text-sm text-[var(--text-primary)]">{i18nT("services.reset.done", undefined, "Data reset finished:")}</p>
          <VolumeReport volumes={report} testId="service-reset-volumes" />
          <Footer>
            <button type="button" className={BUTTON_CLASS} onClick={onDone} data-testid="service-reset-close">
              {i18nT("common.close", undefined, "Close")}
            </button>
          </Footer>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--text-secondary)]">
            {i18nT("services.reset.lead", undefined, "This permanently deletes the data volumes below. The definition and secrets stay.")}
          </p>
          <ul className="m-0 list-none space-y-0.5 p-0 text-sm text-[var(--text-primary)]">
            {(service.volumes ?? []).map((v) => (
              <li key={v}>
                <code className="font-mono">{v}</code>
              </li>
            ))}
          </ul>
          <div>
            <label htmlFor={inputId} className={LABEL_CLASS}>
              {i18nT("services.reset.typeId", { id: service.id }, "Type {id} to confirm")}
            </label>
            <input id={inputId} className={INPUT_CLASS} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} data-testid="service-reset-typed" />
          </div>
          <ActionFailure failure={failure} />
          <Footer>
            <button type="button" className={BUTTON_CLASS} onClick={onClose} data-testid="service-reset-cancel">
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button type="button" className={DANGER_BUTTON_CLASS} disabled={busy || typed !== service.id} onClick={confirm} data-testid="service-reset-confirm">
              {i18nT("services.reset.confirm", undefined, "Delete data")}
            </button>
          </Footer>
        </>
      )}
    </Dialog>
  );
}

// ── Force stop ─────────────────────────────────────────────────────────────

export function ForceStopDialog({ service, onClose, onDone }: { service: ServiceStatus; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const uncertain = service.reason === "adoption-uncertain";
  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    const res = await runVerb(service.id, "stop", { force: true });
    setBusy(false);
    if (!res.ok) return setFailure(res);
    onDone();
  };
  return (
    <Dialog open onClose={onClose} title={i18nT("services.force.title", { id: service.id }, "Force stop {id}?")} size="md" testId="service-force-dialog">
      <p className="text-sm text-[var(--text-secondary)]" data-testid="service-force-explain">
        {uncertain
          ? i18nT(
              "services.force.uncertain",
              undefined,
              "After the restart, a process is still running but the dashboard cannot prove it is this service. Force stop signals the recorded process group anyway, skipping the check that guards against a reused process id.",
            )
          : i18nT(
              "services.force.external",
              undefined,
              "The dashboard did not start this instance. A plain stop is refused for that reason; Force stop stops it anyway.",
            )}
      </p>
      <ActionFailure failure={failure} />
      <Footer>
        <button type="button" className={BUTTON_CLASS} onClick={onClose} data-testid="service-force-cancel">
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
        <button type="button" className={DANGER_BUTTON_CLASS} disabled={busy} onClick={confirm} data-testid="service-force-confirm">
          {i18nT("services.force.confirm", undefined, "Force stop")}
        </button>
      </Footer>
    </Dialog>
  );
}

// ── Prune ──────────────────────────────────────────────────────────────────

type DryRun = Extract<PruneResult, { dryRun: true }>;
type Applied = Extract<PruneResult, { dryRun: false }>;

export function PruneDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void prune({ dryRun: true }).then((res) => {
      if (!live) return;
      if (res.ok && res.data?.dryRun) setPreview(res.data);
      else setFailure(res);
    });
    return () => {
      live = false;
    };
  }, []);

  const ids = preview ? [...new Set(preview.candidates.map((c) => c.id))] : [];
  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    // Exactly the previewed ids — nothing the user has not seen.
    const res = await prune({ dryRun: false, ids });
    setBusy(false);
    if (res.ok && res.data && !res.data.dryRun) setApplied(res.data);
    else setFailure(res);
  };

  return (
    <Dialog open onClose={applied ? onDone : onClose} title={i18nT("services.prune.title", undefined, "Clean up leftovers")} size="md" testId="service-prune-dialog">
      {applied ? (
        <>
          <p className="text-sm text-[var(--text-primary)]" data-testid="service-prune-removed">
            {i18nT("services.prune.removed", { n: applied.removed.length }, "Removed {n} leftovers.")}
          </p>
          {applied.skipped.length > 0 && (
            <div>
              <p className={LABEL_CLASS}>{i18nT("services.prune.skipped", undefined, "Skipped")}</p>
              <ul data-testid="service-prune-skipped" className="m-0 list-none space-y-0.5 p-0 text-xs text-[var(--text-primary)]">
                {applied.skipped.map((s) => (
                  <li key={`${s.kind}-${s.id}`}>
                    <code className="font-mono">{s.id}</code> — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Footer>
            <button type="button" className={BUTTON_CLASS} onClick={onDone} data-testid="service-prune-close">
              {i18nT("common.close", undefined, "Close")}
            </button>
          </Footer>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--text-secondary)]">
            {i18nT("services.prune.lead", undefined, "Containers and run directories of services that are no longer defined. Volumes are never removed.")}
          </p>
          {!preview && !failure && <p className={HELP_CLASS}>{i18nT("services.prune.looking", undefined, "Looking for leftovers…")}</p>}
          {preview && (
            <>
              {preview.unreachableRuntimes.length > 0 && (
                <p className="text-xs text-[var(--severity-warning-fg)]" role="status" data-testid="service-prune-unreachable">
                  {i18nT("services.prune.unreachable", { runtimes: preview.unreachableRuntimes.join(", ") }, "Could not check: {runtimes}. Its leftovers are not listed.")}
                </p>
              )}
              {preview.candidates.length === 0 ? (
                <p className="text-sm text-[var(--text-primary)]" data-testid="service-prune-none">
                  {i18nT("services.prune.none", undefined, "Nothing to clean up.")}
                </p>
              ) : (
                <ul data-testid="service-prune-candidates" className="m-0 list-none space-y-0.5 p-0 text-sm text-[var(--text-primary)]">
                  {preview.candidates.map((c) => (
                    <li key={`${c.kind}-${c.id}`}>
                      <code className="font-mono">{c.id}</code> —{" "}
                      {c.kind === "container" ? i18nT("services.prune.container", undefined, "stopped container") : i18nT("services.prune.runDir", undefined, "run directory")}
                    </li>
                  ))}
                </ul>
              )}
              {preview.skipped.length > 0 && (
                <ul data-testid="service-prune-preview-skipped" className="m-0 list-none space-y-0.5 p-0 text-xs text-[var(--text-secondary)]">
                  {preview.skipped.map((s) => (
                    <li key={`${s.kind}-${s.id}`}>
                      <code className="font-mono">{s.id}</code> — {i18nT("services.prune.running", undefined, "running, left alone")}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <ActionFailure failure={failure} />
          <Footer>
            <button type="button" className={BUTTON_CLASS} onClick={onClose} data-testid="service-prune-cancel">
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button type="button" className={DANGER_BUTTON_CLASS} disabled={busy || ids.length === 0} onClick={confirm} data-testid="service-prune-confirm">
              {i18nT("services.prune.confirm", undefined, "Remove leftovers")}
            </button>
          </Footer>
        </>
      )}
    </Dialog>
  );
}
