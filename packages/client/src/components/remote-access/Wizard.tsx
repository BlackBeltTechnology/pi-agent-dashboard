/**
 * Wizard host: renders a task's {@link planTask} rows — satisfied steps
 * collapsed with a check (re-openable, runs of 2+ folded into one row), the
 * first unsatisfied step expanded, later ones as numbered non-interactive rows.
 *
 * See change: add-remote-access-wizard (design D1).
 */
import { mdiCheck } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { foldRows, type Plan, type PlanRow, type StepId, unknownLabel } from "../../lib/remote-access/steps.js";
import { AskBody, type ConnectMachine, FinishBody, MachineBody, ReachBody } from "./ConnectMachine.js";
import type { StepCtx } from "./ra-context.js";
import { SmallButton } from "./ra-ui.js";
import {
  AcceptBody,
  AddressBody,
  ApproveBody,
  type ApproveTrack,
  BindBody,
  ConnectBody,
  DoorBody,
  ProviderBody,
  ProviderSetupBody,
  QrBody,
  RoadBody,
} from "./StepBodies.js";

function stepTitle(id: StepId, t: ReturnType<typeof useI18n>["t"]): string {
  const T = (k: string, fb: string) => t(`remoteAccess.step.${k}`, undefined, fb);
  switch (id) {
    case "provider":
      return T("provider", "Choose provider");
    case "install":
      return T("install", "Install");
    case "enable":
      return T("enable", "Enable");
    case "address":
      return T("address", "Public address");
    case "connect":
      return T("connect", "Go online");
    case "bind":
      return T("bind", "Listen on network");
    case "accept":
      return T("accept", "Let devices ask");
    case "door":
      return T("door", "Who may enter");
    case "road":
      return T("road", "Where is the device");
    case "qr":
      return T("qr", "Open it on the device");
    case "approve":
      return T("approve", "Approve with the code");
    case "machine":
      return T("machine", "Which machine");
    case "reach":
      return T("reach", "Check it can be reached");
    case "ask":
      return T("ask", "Ask that machine for access");
    case "finish":
      return T("finish", "Finish");
  }
}

function StepBody({
  id,
  ctx,
  cm,
  approve,
  onStartOver,
}: {
  id: StepId;
  ctx: StepCtx;
  cm: ConnectMachine;
  approve: ApproveTrack | null;
  onStartOver: () => void;
}) {
  switch (id) {
    case "provider":
      return <ProviderBody ctx={ctx} />;
    case "install":
      return <ProviderSetupBody ctx={ctx} part="install" />;
    case "enable":
      return <ProviderSetupBody ctx={ctx} part="enable" />;
    case "address":
      return <AddressBody ctx={ctx} />;
    case "connect":
      return <ConnectBody ctx={ctx} />;
    case "bind":
      return <BindBody ctx={ctx} />;
    case "accept":
      return <AcceptBody ctx={ctx} />;
    case "door":
      return <DoorBody ctx={ctx} />;
    case "road":
      return <RoadBody ctx={ctx} />;
    case "qr":
      return <QrBody ctx={ctx} />;
    case "approve":
      return <ApproveBody ctx={ctx} tracked={approve} onStartOver={onStartOver} />;
    case "machine":
      return <MachineBody ctx={ctx} cm={cm} />;
    case "reach":
      return <ReachBody ctx={ctx} cm={cm} />;
    case "ask":
      return <AskBody ctx={ctx} cm={cm} />;
    case "finish":
      return <FinishBody ctx={ctx} cm={cm} />;
  }
}

function Marker({ row, index }: { row: PlanRow; index: number }) {
  const collapsed = row.state === "skipped" || row.state === "done";
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-bold ${
        collapsed
          ? "border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]"
          : row.state === "current"
            ? "border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]"
            : "border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
      }`}
    >
      {collapsed ? <Icon path={mdiCheck} size={0.5} /> : index + 1}
    </span>
  );
}

export function Wizard({
  plan,
  ctx,
  cm,
  approve,
  onStartOver,
}: {
  plan: Plan;
  ctx: StepCtx;
  cm: ConnectMachine;
  approve: ApproveTrack | null;
  onStartOver: () => void;
}) {
  const { t } = useI18n();
  const [showSkipped, setShowSkipped] = useState(false);
  const items = foldRows(plan.rows, showSkipped);
  const indexOf = (id: StepId) => plan.rows.findIndex((r) => r.id === id);

  const renderRow = (row: PlanRow) => {
    const index = indexOf(row.id);
    const title = stepTitle(row.id, t);
    const collapsed = row.state === "skipped" || row.state === "done";
    return (
      <li key={row.id} data-testid={`remote-access-step-${row.id}`} data-state={row.state} className="flex gap-2.5 py-2">
        <Marker row={row} index={index} />
        <div className="min-w-0 flex-1">
          {collapsed ? (
            <button
              type="button"
              data-testid={`remote-access-step-open-${row.id}`}
              className="flex w-full flex-wrap items-center gap-x-2 text-left text-[12.5px] text-[var(--text-secondary)]"
              onClick={() => ctx.patchRun({ open: row.id })}
            >
              <span className="font-medium text-[var(--text-primary)]">{title}</span>
              {row.value && <span className="font-mono text-xs">{row.value}</span>}
              <span className="text-xs">
                {row.state === "done" ? t("remoteAccess.fold.done", undefined, "done") : t("remoteAccess.alreadySet", undefined, "already set")}
              </span>
              <span className="ml-auto text-xs underline">{t("remoteAccess.change", undefined, "Change")}</span>
            </button>
          ) : (
            <>
              <div className={`flex items-center gap-2 text-[12.5px] ${row.state === "current" ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                <span>{title}</span>
                {row.sat === "unknown" && (
                  <span className="text-xs font-normal">{unknownLabel(row.pending) === "unknown" ? t("remoteAccess.unknown", undefined, "unknown") : t("remoteAccess.checking", undefined, "Checking…")}</span>
                )}
              </div>
              {row.state === "current" && (
                <div className="mt-2 space-y-2" data-testid={`remote-access-step-body-${row.id}`}>
                  <StepBody id={row.id} ctx={ctx} cm={cm} approve={approve} onStartOver={onStartOver} />
                  {ctx.run.open === row.id && (
                    <SmallButton testId="remote-access-step-close" onClick={() => ctx.patchRun({ open: undefined })}>
                      {t("remoteAccess.keepAsIs", undefined, "Keep as is")}
                    </SmallButton>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <ol className="divide-y divide-[var(--border-primary)]" data-testid="remote-access-wizard">
      {items.map((item) =>
        item.kind === "row" ? (
          renderRow(item.row)
        ) : (
          <li key={`fold-${item.rows[0].id}`} data-testid="remote-access-fold" className="flex gap-2.5 py-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]">
              <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
            </span>
            <button type="button" className="flex-1 text-left text-[12.5px] text-[var(--text-secondary)]" onClick={() => setShowSkipped(true)}>
              {item.anyDone
                ? t("remoteAccess.fold.doneN", { n: String(item.rows.length) }, `${item.rows.length} steps done`)
                : t("remoteAccess.fold.setN", { n: String(item.rows.length) }, `${item.rows.length} steps already set`)}
            </button>
          </li>
        ),
      )}
    </ol>
  );
}
