import { SlotPill } from "@blackbelt-technology/dashboard-plugin-runtime";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { OpenSpecData, OpenSpecReadiness, OpenSpecReadinessReason } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClipboardTextOutline, mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  addOpenSpecOptOut,
  OpenSpecInitError,
  type OpenSpecInitResult,
  runOpenSpecInit,
  runOpenSpecUpdate,
} from "../../lib/openspec/openspec-config-api.js";

/**
 * Folder-card OpenSpec slot. Single-line navigation entry to the full-page
 * OpenSpec board (`/folder/:encodedCwd/openspec`) when READY, and a one-line
 * readiness pill in every other acted-on state (ABSENT offer, BROKEN repair,
 * STALE update) — driven by the server-derived `readiness` fold, never
 * re-derived here. The inline collapsible change tree, group pills, in-section
 * search, and DnD moved to the board.
 *
 * The section is STATE-ONLY apart from its ONE recovery action per state:
 * Refresh / Specs / Archive controls are items in the folder actions menu,
 * contributed HOST-side by `SessionList`. Every variant keeps the READY
 * pill's height and chrome (SlotPill) so section height parity holds — a
 * missing/broken directory is not blocked from proceeding, so no banner.
 *
 * `BROKEN` · `cli-failed` renders NO action at all (D9): re-running init
 * cannot fix a failing CLI, and the invocation carries `--force`, which
 * auto-cleans files in a directory that may hold real proposals.
 *
 * Legacy servers (no `readiness` on the payload) degrade to the previous
 * `initialized || pending` gate — never to an offer or a broken/stale pill.
 *
 * See change: redesign-openspec-board (openspec-folder-section spec),
 * add-openspec-init-affordances; move-slot-actions-to-menu.
 */
interface Props {
  data: OpenSpecData;
  cwd: string;
  /** Navigate to the full-page board for this cwd. */
  onOpenBoard?: (cwd: string) => void;
  /**
   * Fleet-level ABSENT-offer switch (`openspec.offerInitialization`, default
   * `true`). When `false`, the ABSENT offer is suppressed everywhere while
   * BROKEN/STALE/READY keep rendering. See change:
   * add-openspec-init-affordances (D3).
   */
  offerInitialization?: boolean;
  /** Surface CLI stdout (info) / failure stderr (error) as a toast. */
  onToast?: (message: string, variant: "info" | "error") => void;
}

type ConfirmKind = "repair" | "init-over";

/** One-line reason label per non-READY state (openspec-folder-section table). */
function stateLabel(state: "ABSENT" | "BROKEN" | "STALE", reason?: OpenSpecReadinessReason): string {
  if (state === "ABSENT") return i18nT("openspec.sectionAbsent", undefined, "not set up");
  if (state === "BROKEN") {
    return reason === "missing-changes-dir"
      ? i18nT("openspec.sectionBrokenChangesDir", undefined, "not initialized properly")
      : i18nT("openspec.sectionCliFailed", undefined, "OpenSpec command failed");
  }
  return reason === "missing-skills"
    ? i18nT("openspec.sectionStaleSkills", undefined, "skills missing")
    : i18nT("openspec.sectionStaleProfile", undefined, "needs update");
}

export function FolderOpenSpecSection({ data, cwd, onOpenBoard, offerInitialization, onToast }: Props) {
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [busy, setBusy] = useState(false);

  function firstLine(text: string | undefined): string {
    const line = (text ?? "").trim().split("\n", 1)[0];
    return line.length > 0 ? ` — ${line}` : "";
  }

  function surfaceError(prefix: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = err instanceof OpenSpecInitError && err.stderr ? `\n${err.stderr}` : "";
    onToast?.(`${prefix}: ${message}${stderr}`, "error");
  }

  async function handleInit(confirm: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const r: OpenSpecInitResult = await runOpenSpecInit(cwd, confirm);
      // D5 guard 1: surface the CLI's stdout rather than a bare success toast.
      onToast?.(
        i18nT("openspec.initDoneToast", undefined, "OpenSpec initialized") + firstLine(r.stdout),
        "info",
      );
    } catch (err) {
      // The server found legacy/existing openspec files and refused without
      // confirmation — only possible on the ABSENT fast path. Ask, then retry
      // with confirm:true (task 4.2 / D5 guard 3).
      if (err instanceof OpenSpecInitError && (err.needsConfirmation || err.message.includes("without confirmation"))) {
        setConfirmKind("init-over");
      } else {
        surfaceError(i18nT("openspec.initFailedToast", undefined, "OpenSpec init failed"), err);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await addOpenSpecOptOut(cwd);
      // Readiness rebroadcast (OPTED_OUT) re-renders the section away.
    } catch (err) {
      surfaceError(i18nT("openspec.dismissFailedToast", undefined, "Could not dismiss the OpenSpec offer"), err);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const results = await runOpenSpecUpdate({ cwd });
      const failed = results.find((r) => !r.success);
      if (failed) {
        onToast?.(
          `${i18nT("openspec.updateFailedToast", undefined, "OpenSpec update failed")}: ${failed.error ?? failed.cwd}`,
          "error",
        );
      } else {
        onToast?.(i18nT("openspec.updateDoneToast", undefined, "OpenSpec updated"), "info");
      }
    } catch (err) {
      surfaceError(i18nT("openspec.updateFailedToast", undefined, "OpenSpec update failed"), err);
    } finally {
      setBusy(false);
    }
  }

  const readiness = data.readiness;

  // Legacy server (no readiness): previous gate verbatim — spinner while
  // pending, null when not initialized, READY pill otherwise. NEVER an offer
  // or a disabled variant.
  if (!readiness) {
    if (!data.initialized && data.pending) return <Pending cwd={cwd} />;
    if (!data.initialized) return null;
    return <ReadyPill cwd={cwd} data={data} onOpenBoard={onOpenBoard} />;
  }

  function renderVariant(r: OpenSpecReadiness) {
    switch (r.state) {
    case "GLOBAL_OFF":
    case "OPTED_OUT":
      return null;
    case "ABSENT":
      // Fleet-level suppression of the offer (D3): BROKEN/STALE/READY keep
      // rendering; only the offer hides.
      if (offerInitialization === false) return null;
      return (
        <div
          className="flex items-center gap-1"
          data-testid="folder-openspec-section-absent"
          data-folder-openspec-section={cwd}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-1 min-w-0">
            <SlotPill
              glyph={mdiClipboardTextOutline}
              accent="purple"
              label={i18nT("openspec.openspec", undefined, "OpenSpec")}
              activateTestId="folder-openspec-initialize"
              activateTitle={i18nT("openspec.initializeAction", undefined, "Initialize")}
              onActivate={() => void handleInit(false)}
            >
              <span data-testid="folder-openspec-state">{stateLabel("ABSENT")}</span>
            </SlotPill>
          </div>
          <button
            type="button"
            data-testid="folder-openspec-dismiss"
            aria-label={i18nT("openspec.dismissOffer", undefined, "Dismiss the OpenSpec offer for this directory")}
            title={i18nT("openspec.dismissOffer", undefined, "Dismiss the OpenSpec offer for this directory")}
            onClick={(e) => {
              e.stopPropagation();
              void handleDismiss();
            }}
            className="focus-ring shrink-0 rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            <Icon path={mdiClose} size={0.5} />
          </button>
        </div>
      );
    case "PENDING":
      return <Pending cwd={cwd} />;
    case "BROKEN":
      if (r.reason === "missing-changes-dir") {
        return (
          <SectionShell testId="folder-openspec-section-broken" cwd={cwd}>
            <SlotPill
              glyph={mdiClipboardTextOutline}
              accent="purple"
              label={i18nT("openspec.openspec", undefined, "OpenSpec")}
              activateTestId="folder-openspec-repair"
              activateTitle={i18nT("openspec.repairAction", undefined, "Repair")}
              onActivate={() => setConfirmKind("repair")}
            >
              <span data-testid="folder-openspec-state">{stateLabel("BROKEN", r.reason)}</span>
            </SlotPill>
          </SectionShell>
        );
      }
      // cli-failed (or unknown): report, offer NOTHING. SlotPill renders an
      // unconditional role="button" root, so it cannot be reused inert — the
      // chrome below is a mirrored copy. Keep in sync with SlotPill (raised).
      return (
        <SectionShell testId="folder-openspec-section-broken" cwd={cwd}>
          <div className="relative flex items-center gap-2 min-w-0 px-2.5 pt-2.5 pb-1.5 rounded-[11px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-[0_1px_2px_var(--shadow-card)]">
            <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 max-w-[calc(100%-12px)] truncate px-1.5 py-px rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[9px] font-semibold tracking-wider uppercase text-[var(--text-secondary)] leading-none">
              {i18nT("openspec.openspec", undefined, "OpenSpec")}
            </span>
            <span className="shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center bg-purple-500/10 text-purple-400">
              <Icon path={mdiClipboardTextOutline} size={0.62} />
            </span>
            <span
              data-testid="folder-openspec-state"
              className="text-[13px] font-extrabold text-[var(--text-primary)] flex items-baseline gap-1.5 min-w-0 flex-1 leading-tight truncate"
            >
              {stateLabel("BROKEN", r.reason)}
            </span>
          </div>
        </SectionShell>
      );
    case "STALE":
      return (
        <SectionShell testId="folder-openspec-section-stale" cwd={cwd}>
          <SlotPill
            glyph={mdiClipboardTextOutline}
            accent="purple"
            label={i18nT("openspec.openspec", undefined, "OpenSpec")}
            activateTestId="folder-openspec-update"
            activateTitle={i18nT("openspec.updateAction", undefined, "Update")}
            onActivate={() => void handleUpdate()}
          >
            <span data-testid="folder-openspec-state">{stateLabel("STALE", r.reason)}</span>
          </SlotPill>
        </SectionShell>
      );
    case "READY":
      return <ReadyPill cwd={cwd} data={data} onOpenBoard={onOpenBoard} />;
    }
  }

  return (
    <>
      {renderVariant(readiness)}
      {confirmKind !== null && (
        <OpenSpecConfirmDialog
          kind={confirmKind}
          cwd={cwd}
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => {
            setConfirmKind(null);
            void handleInit(true);
          }}
        />
      )}
    </>
  );
}

/** Wrapper shared by the non-READY pill variants — focus target for the
 *  session-card disabled subcard's remediation control (task 4.5). */
function SectionShell({ testId, cwd, children }: { testId: string; cwd: string; children: React.ReactNode }) {
  return (
    <div
      data-testid={testId}
      data-folder-openspec-section={cwd}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function Pending({ cwd }: { cwd: string }) {
  return (
    <div
      data-testid="folder-openspec-section-pending"
      data-folder-openspec-section={cwd}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 mt-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--text-tertiary)] border-t-transparent animate-spin"
          data-testid="folder-openspec-pending-spinner"
          aria-label={i18nT("openspec.openspecLoading", undefined, "OpenSpec loading")}
        />
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">{i18nT("openspec.openspec", undefined, "OpenSpec")}</span>
      </div>
    </div>
  );
}

function ReadyPill({ cwd, data, onOpenBoard }: { cwd: string; data: OpenSpecData; onOpenBoard?: (cwd: string) => void }) {
  const count = data.changes.length;
  return (
    <div
      data-testid="folder-openspec-section"
      data-folder-openspec-section={cwd}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      <SlotPill
        glyph={mdiClipboardTextOutline}
        accent="purple"
        label={i18nT("openspec.openspec", undefined, "OpenSpec")}
        activateTestId="folder-openspec-open-board"
        activateTitle={i18nT("openspec.openOpenspecBoard", undefined, "Open OpenSpec board")}
        onActivate={() => onOpenBoard?.(cwd)}
      >
        <span data-testid="folder-openspec-count">{count}</span>
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{i18nT("openspec.changesUnit", undefined, "changes")}</span>
      </SlotPill>
    </div>
  );
}

/** Confirm dialog naming the directory (task 4.3) — shared chrome for the
 *  Repair and Initialize-over-existing confirmations. */
function OpenSpecConfirmDialog({
  kind,
  cwd,
  onCancel,
  onConfirm,
}: {
  kind: ConfirmKind;
  cwd: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isRepair = kind === "repair";
  return (
    <Dialog
      open
      onClose={onCancel}
      title={
        isRepair
          ? i18nT("openspec.repairConfirmTitle", undefined, "Repair OpenSpec setup?")
          : i18nT("openspec.initOverConfirmTitle", undefined, "Initialize over existing OpenSpec files?")
      }
      testId={isRepair ? "openspec-repair-confirm" : "openspec-init-over-confirm"}
    >
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        {isRepair
          ? i18nT(
              "openspec.repairConfirmBody",
              { dir: cwd },
              "OpenSpec is not initialized properly in {dir}. Repairing re-runs initialization and recreates missing OpenSpec files.",
            )
          : i18nT(
              "openspec.initOverConfirmBody",
              { dir: cwd },
              "{dir} already contains OpenSpec files. Initializing again may clean up or overwrite them.",
            )}
      </p>
      <Dialog.Footer>
        <Dialog.Cancel onClick={onCancel} testId={isRepair ? "openspec-repair-cancel" : "openspec-init-over-cancel"} />
        <Dialog.Action
          onClick={onConfirm}
          testId={isRepair ? "openspec-repair-confirm-action" : "openspec-init-over-confirm-action"}
        >
          {isRepair
            ? i18nT("openspec.repairAction", undefined, "Repair")
            : i18nT("openspec.initializeAction", undefined, "Initialize")}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
