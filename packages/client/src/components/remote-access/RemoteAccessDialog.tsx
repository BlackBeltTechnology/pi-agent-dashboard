/**
 * **Remote access** dialog — a status landing ("who can reach this machine
 * right now") plus four scenario wizards sharing one step engine. Replaces the
 * tabbed Gateway dialog; Settings ▸ Network ▸ Gateway stays the expert view and
 * composes the same section components.
 *
 * See change: add-remote-access-wizard.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useI18n } from "../../lib/i18n/i18n.js";
import { listPairedDevices } from "../../lib/pairing/paired-devices-api.js";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";
import { newRun, planTask, type RunState, type StepId, type TaskId } from "../../lib/remote-access/steps.js";
import { useRemoteAccessSnapshot } from "../../lib/remote-access/use-remote-access-snapshot.js";
import { useConnectMachine } from "./ConnectMachine.js";
import { Landing, taskTitle } from "./Landing.js";
import type { StepCtx } from "./ra-context.js";
import type { ApproveTrack } from "./StepBodies.js";
import { Wizard } from "./Wizard.js";

/** Steps whose outcome depends on provider state — the only ones that poll readiness. */
const PROVIDER_STEPS = new Set<StepId>(["provider", "install", "enable", "connect"]);

export function RemoteAccessDialog({ onClose, initialRun }: { onClose: () => void; initialRun?: RunState | null }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [run, setRun] = useState<RunState | null>(initialRun ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pollActive, setPollActive] = useState(false);
  const [approve, setApprove] = useState<ApproveTrack | null>(null);
  const cm = useConnectMachine();
  const ra = useRemoteAccessSnapshot(true, pollActive);
  const { snapshot, refresh } = ra;

  const plan = run ? planTask(run.task, snapshot, run) : null;
  const current = plan?.current ?? null;

  useEffect(() => {
    setPollActive(current !== null && PROVIDER_STEPS.has(current));
  }, [current]);

  // A step that was KNOWN unsatisfied while current and is satisfied now was
  // completed during THIS run ("done", not "already set"). A step that merely
  // loaded as satisfied (it was unknown before) stays "already set".
  const prev = useRef<{ id: StepId | null; reopened: boolean; unsat: boolean }>({ id: null, reopened: false, unsat: false });
  useEffect(() => {
    const p = prev.current;
    if (run && p.id && p.id !== current && !p.reopened && p.unsat && !run.done.includes(p.id)) {
      const row = plan?.rows.find((r) => r.id === p.id);
      if (row?.sat === true) setRun({ ...run, done: [...run.done, p.id] });
    }
    const row = plan?.rows.find((r) => r.id === current);
    prev.current = { id: current, reopened: !!run?.open && run.open === current, unsat: row?.sat === false };
  }, [current, run, plan]);

  const patchRun = useCallback((p: Partial<RunState>) => setRun((r) => (r ? { ...r, ...p } : r)), []);
  const complete = useCallback(
    (id: StepId) =>
      setRun((r) => (r ? { ...r, done: r.done.includes(id) ? r.done : [...r.done, id], open: r.open === id ? undefined : r.open } : r)),
    [],
  );

  const toLanding = useCallback(() => {
    setRun(null);
    setError(null);
    setApprove(null);
    void refresh();
  }, [refresh]);

  // Open it on the device completes when a pairing request arrives; remember the
  // paired list so Approve can diff it (PairedDeviceView carries no pendingId).
  const pendingFirst = ra.pendingCount > 0 ? pairingApprovalStore.getState().pending[0]?.pendingId : undefined;
  useEffect(() => {
    if (run?.task !== "device" || current !== "qr" || !pendingFirst) return;
    let alive = true;
    void listPairedDevices()
      .catch(() => [])
      .then((devs) => {
        if (!alive) return;
        setApprove({ pendingId: pendingFirst, before: devs.map((d) => d.id) });
        complete("qr");
      });
    return () => {
      alive = false;
    };
  }, [run?.task, current, pendingFirst, complete]);

  const ctx: StepCtx = {
    snap: snapshot,
    ra,
    run: run ?? newRun("share"),
    refresh,
    patchRun,
    complete,
    close: onClose,
    navigate,
    setError,
    finishTask: toLanding,
  };

  const title = run && plan
    ? `${t("remoteAccess.title", undefined, "Remote access")} — ${taskTitle(run.task, t)} · ${t("remoteAccess.stepOf", { k: String(plan.k), n: String(plan.n) }, `step ${plan.k} of ${plan.n}`)}`
    : t("remoteAccess.title", undefined, "Remote access");

  return (
    <Dialog open onClose={onClose} title={title} size="lg" testId="gateway-dialog">
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {run && plan ? (
          <Wizard
            plan={plan}
            ctx={ctx}
            cm={cm}
            approve={approve}
            onStartOver={() => {
              setApprove(null);
              patchRun({ done: run.done.filter((d) => d !== "qr" && d !== "approve") });
            }}
          />
        ) : (
          <Landing
            snap={snapshot}
            ra={ra}
            onStart={(task: TaskId) => {
              setError(null);
              setRun(newRun(task));
            }}
            onClose={onClose}
            navigate={navigate}
            setError={setError}
          />
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--border-primary)] pt-3">
        {run && (
          <button
            type="button"
            data-testid="remote-access-back"
            onClick={toLanding}
            className="rounded border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t("remoteAccess.back", undefined, "← All tasks")}
          </button>
        )}
        <span className="flex-1" />
        {error && (
          <span role="alert" className="text-xs text-[var(--severity-error-fg)]" data-testid="gateway-dialog-error">
            {error}
          </span>
        )}
        <button
          type="button"
          data-testid="gateway-done"
          onClick={onClose}
          className="rounded bg-[var(--accent-solid)] px-4 py-1.5 text-sm font-semibold text-white"
        >
          {t("gateway.done", undefined, "Done")}
        </button>
      </div>
    </Dialog>
  );
}
