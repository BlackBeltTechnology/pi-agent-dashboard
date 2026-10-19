/**
 * Per-card dialog host for the session actions menu.
 *
 * Menu items that open a dialog only set `dialog` on the card; the dialogs render
 * from HERE, not from inside the menu — the menu closes on select, and a dialog
 * must outlive it. They paint at `z-dialog`, above the menu's `z-popover`.
 *
 * Covers the OpenSpec set (Explore, Archive / Archive-anyway confirms, Tasks,
 * New change, Propose, Attach picker, Bulk-archive confirm) and the worktree /
 * git set (Merge, Close worktree, Switch branch). Commit uses the app-level
 * `useCommitDialog`, so it needs no host entry.
 *
 * See change: add-session-actions-flyout (D3).
 */
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type {
  DashboardSession,
  ImageContent,
  OpenSpecChange,
  OpenSpecGroup,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { Suspense } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { SessionDialogKind } from "../../lib/session/session-menu-items.js";
import {
  LazyAttachChangePicker,
  LazyExploreDialog,
  LazyNewChangeDialog,
  LazyProposeDialog,
  LazyTasksPopover,
} from "../openspec/lazy-openspec-dialogs.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { BranchSwitchDialog } from "../worktree/BranchSwitchDialog.js";
import { LazyCloseWorktreeDialog, LazyMergeConfirmDialog } from "../worktree/lazy-worktree-dialogs.js";

interface Props {
  session: DashboardSession;
  dialog: SessionDialogKind | null;
  onClose: () => void;
  changes?: OpenSpecChange[];
  /** The attached change, when it is live-active in this cwd (Archive anyway / Tasks need its numbers). */
  attachedChange?: OpenSpecChange;
  groups?: OpenSpecGroup[];
  assignments?: Record<string, string>;
  allSessions: DashboardSession[];
  onShutdownSession: (sessionId: string) => void;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onAttach?: (changeName: string) => void;
  onBulkArchive?: () => void;
  /** Surface the "Worktree removed." outcome. */
  onWorktreeRemoved?: () => void;
}

export function SessionCardDialogs({
  session,
  dialog,
  onClose,
  changes,
  attachedChange,
  groups,
  assignments,
  allSessions,
  onShutdownSession,
  onSendPrompt,
  onAttach,
  onBulkArchive,
  onWorktreeRemoved,
}: Props) {
  if (!dialog) return null;
  const attached = session.attachedProposal || undefined;
  const send = (text: string, images?: ImageContent[]) => onSendPrompt?.(text, images);

  switch (dialog) {
    case "explore":
      return (
        <DialogPortal>
          <Suspense fallback={null}>
            <LazyExploreDialog
              changeName={attached ?? ""}
              onSend={(text, images) => {
                send(attached ? `/skill:openspec-explore ${attached}\n${text}` : `/skill:openspec-explore\n${text}`, images);
                onClose();
              }}
              onClose={onClose}
            />
          </Suspense>
        </DialogPortal>
      );
    case "archive":
      return (
        <Confirm
          open
          testId="archive-confirm"
          title={i18nT("openspec.archiveChange", undefined, "Archive change?")}
          message={i18nT("openspec.archiveConfirmMessage", { name: attached ?? "" }, 'Archive "{name}"?')}
          confirmLabel={i18nT("openspec.archive", undefined, "Archive")}
          onConfirm={() => {
            send(`/skill:openspec-archive-change ${attached}`);
            onClose();
          }}
          onClose={onClose}
        />
      );
    case "archive-anyway": {
      const total = attachedChange?.totalTasks ?? 0;
      const unchecked = Math.max(0, total - (attachedChange?.completedTasks ?? 0));
      return (
        <Confirm
          open
          testId="archive-anyway-confirm"
          title={i18nT("openspec.archiveAnyway2", undefined, "Archive anyway?")}
          message={i18nT("openspec.archiveAnywayMessage", { unchecked, total }, "{unchecked} of {total} tasks are unchecked. Archive anyway?")}
          confirmLabel={i18nT("openspec.archiveAnyway", undefined, "Archive anyway")}
          onConfirm={() => {
            send(`/skill:openspec-archive-change ${attached}`);
            onClose();
          }}
          onClose={onClose}
        />
      );
    }
    case "tasks":
      return attached ? (
        <Suspense fallback={null}>
          <LazyTasksPopover cwd={session.cwd} change={attached} onClose={onClose} />
        </Suspense>
      ) : null;
    case "new-change":
      return (
        <DialogPortal>
          <Suspense fallback={null}>
            <LazyNewChangeDialog
              onSend={(prompt) => {
                send(prompt);
                onClose();
              }}
              onClose={onClose}
            />
          </Suspense>
        </DialogPortal>
      );
    case "propose":
      return (
        <DialogPortal>
          <Suspense fallback={null}>
            <LazyProposeDialog
              onSend={(prompt) => {
                send(prompt);
                onClose();
              }}
              onClose={onClose}
            />
          </Suspense>
        </DialogPortal>
      );
    case "attach":
      return (
        <Suspense fallback={null}>
          <LazyAttachChangePicker
            changes={changes ?? []}
            groups={groups}
            assignments={assignments}
            onSelect={(value) => {
              onAttach?.(value);
              onClose();
            }}
            onCancel={onClose}
          />
        </Suspense>
      );
    case "bulk-archive":
      return (
        <Confirm
          open
          title={i18nT("openspec.bulkArchiveChanges", undefined, "Bulk archive changes?")}
          message={i18nT("openspec.bulkArchiveAllMessage", undefined, "Bulk archive all completed changes?")}
          confirmLabel={i18nT("openspec.bulkArchive", undefined, "Bulk Archive")}
          onConfirm={() => {
            onBulkArchive?.();
            onClose();
          }}
          onClose={onClose}
        />
      );
    case "merge":
      return (
        <Suspense fallback={null}>
          <LazyMergeConfirmDialog
            cwd={session.cwd}
            onClose={onClose}
            prNumber={session.gitPrNumber ?? undefined}
            prState={session.gitPrState ?? undefined}
            prChecks={session.gitPrChecks ?? undefined}
            prCheckedAt={session.gitPrCheckedAt ?? undefined}
          />
        </Suspense>
      );
    case "close-worktree":
      return (
        <Suspense fallback={null}>
          <LazyCloseWorktreeDialog
            cwd={session.cwd}
            allSessions={allSessions}
            onShutdownSession={onShutdownSession}
            onClose={onClose}
            onRemoved={() => onWorktreeRemoved?.()}
          />
        </Suspense>
      );
    case "switch-branch":
      return <BranchSwitchDialog cwd={session.cwd} onClose={onClose} />;
    default:
      // `commit` is app-level (`useCommitDialog`); nothing to host.
      return null;
  }
}
