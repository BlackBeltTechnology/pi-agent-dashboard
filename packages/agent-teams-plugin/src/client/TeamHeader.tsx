/**
 * TeamHeader — Back control, team name, lifecycle pill, mode / parallelism / counts
 * line, "viewing from <member>" (teammate route), Shut down team (control ∧ status ∈
 * starting | active | orphaned; confirmation through `ui:confirm-dialog`; a closing
 * team shows a disabled "Closing…" indicator; a closed team shows no control) and
 * the team-level notices (`persist_degraded`, orphaned, starting, closing, closed)
 * as `SettingsNotice`s. Test ids `team-header-mode`, `team-header-parallel` are the
 * contract of change 5.
 * See change: add-agent-teams-ui (design D8, D10, D14; tasks 8.4, 8.6).
 */
import { SettingsActionError, SettingsNotice, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { type ReactElement, useCallback, useRef, useState } from "react";
import type { TeamUiSnapshot } from "../shared/ui-protocol.js";
import { type ControlNote, noteKey } from "./team-controls.js";
import { BTN, BTN_DANGER, formatTime, TEXT, TeamStatusPill, useViewT } from "./view-kit.js";

export interface TeamHeaderProps {
  snap: TeamUiSnapshot;
  /** Name of the member whose session is being viewed (teammate route only). */
  viewedFrom?: string;
  shutdownPending: boolean;
  shutdownNote: ControlNote | undefined;
  onShutdown: () => void | Promise<void>;
  onBack: () => void;
}

const LIVE = new Set(["starting", "active", "orphaned"]);

export function TeamHeader({ snap, viewedFrom, shutdownPending, shutdownNote, onShutdown, onBack }: TeamHeaderProps): ReactElement {
  const t = useViewT();
  const ConfirmDialog = useUiPrimitive("ui:confirm-dialog");
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useCallback(() => queueMicrotask(() => trigger.current?.focus()), []);
  const working = snap.members.filter((m) => m.status === "busy").length;
  const showShutdown = snap.viewerCanControl && LIVE.has(snap.status);
  const started = formatTime(snap.createdAt);
  const banners: ReactElement[] = [];
  if (snap.persist_degraded)
    banners.push(
      <SettingsNotice key="persist" tone="warning" testId="team-persist-degraded">
        <span className="font-semibold">{t("banner.persist.title")}</span> {t("banner.persist.hint")}
      </SettingsNotice>,
    );
  if (snap.status === "orphaned")
    banners.push(
      <SettingsNotice key="orphaned" tone="info" role="status" testId="team-orphaned">
        <span className="font-semibold">{t("banner.orphaned.title")}</span> {t("banner.orphaned.hint")}
      </SettingsNotice>,
    );
  if (snap.status === "starting")
    banners.push(
      <SettingsNotice key="starting" tone="info" role="status" testId="team-starting">
        <span className="font-semibold">{t("banner.starting.title")}</span> {t("banner.starting.hint")}
      </SettingsNotice>,
    );
  if (snap.status === "closing")
    banners.push(
      <SettingsNotice key="closing" tone="warning" role="status" testId="team-closing">
        <span className="font-semibold">{t("banner.closing.title")}</span> {t("banner.closing.hint")}
      </SettingsNotice>,
    );
  if (snap.status === "closed")
    banners.push(
      <SettingsNotice key="closed" tone="info" role="status" testId="team-closed">
        <span className="font-semibold">{t("banner.closed.title")}</span> {t("banner.closed.hint")}
      </SettingsNotice>,
    );

  return (
    <>
      <header className="shrink-0 border-b border-[var(--border-primary)] px-3 py-2" data-testid="team-header">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" className={BTN} onClick={onBack} data-testid="team-back">
            <span aria-hidden="true">←</span>
            {t("common.back")}
          </button>
          <h2 className={`${TEXT} min-w-0 grow basis-[10ch] text-lg font-semibold text-[var(--text-primary)]`} data-testid="team-name">
            {snap.name}
          </h2>
          <TeamStatusPill status={snap.status} />
          {showShutdown ? (
            <button ref={trigger} type="button" className={BTN_DANGER} data-testid="team-shutdown" disabled={shutdownPending} onClick={() => setConfirming(true)}>
              {shutdownPending ? t("header.closing") : t("header.shutdown")}
            </button>
          ) : null}
          {snap.status === "closing" ? (
            <button type="button" className={BTN} disabled data-testid="team-shutdown-closing">
              {t("header.closing")}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          <span data-testid="team-header-mode" className={TEXT}>
            {t("header.mode", { mode: snap.mode })}
          </span>{" "}
          · <span data-testid="team-header-parallel">{t("header.parallel", { n: working })}</span> · {t("header.members", { n: snap.members.length })} · {t("header.tasks", { n: snap.tasks.length })}
          {started !== undefined ? <> · {t("header.started", { time: started })}</> : null}
        </p>
        {viewedFrom !== undefined ? (
          <p className={`${TEXT} mt-0.5 text-[12px] text-[var(--text-primary)]`} data-testid="team-viewed-from">
            {t("header.viewedFrom", { name: viewedFrom })}
          </p>
        ) : null}
        {shutdownNote !== undefined ? <SettingsActionError id="team-shutdown-error" testId="team-shutdown-error">{t(noteKey(shutdownNote))}</SettingsActionError> : null}
      </header>
      {banners.length > 0 ? <div className="flex shrink-0 flex-col gap-2 px-3 pt-2">{banners}</div> : null}
      {confirming ? (
        <ConfirmDialog
          message={t("confirm.message")}
          confirmLabel={t("confirm.confirm")}
          onConfirm={() => {
            setConfirming(false);
            returnFocus();
            void onShutdown();
          }}
          onCancel={() => {
            setConfirming(false);
            returnFocus();
          }}
        />
      ) : null}
    </>
  );
}
