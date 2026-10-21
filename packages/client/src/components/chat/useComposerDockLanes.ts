/**
 * `useComposerDockLanes` — assembles every non-Processes lane of the composer
 * dock (Changes, OpenSpec, Queue, Context) from the session and the same
 * callbacks the composer strip, `QueuePanel` and `StatusBar` area used, so the
 * shell only passes session data and callbacks:
 *
 * ```tsx
 * const lanes = useComposerDockLanes({ session, working, ...callbacks });
 * <ComposerDock session={session} lanes={lanes} processes={…} … />
 * ```
 *
 * Processes is built into `ComposerDock` itself (it owns the always-mounted
 * claim summaries). Merge emphasis is decided ONCE here (`isMergePrimary`) and
 * handed to both the Changes lane (fills Merge) and the OpenSpec lane (outlines
 * its primary), so the dock shows at most one filled primary.
 *
 * Must run under the plugin context and OpenSpec map providers (it resolves the
 * attachment and reads slot claims) — the same place `ComposerSessionActions` ran.
 *
 * See change: add-composer-dock (tasks 4–6; design D6).
 */
import type {
  DashboardSession,
  ImageContent,
  OpenSpecChange,
  OpenSpecConfig,
  OpenSpecGroup,
  OpenSpecReadiness,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { normalizeFollowUpEntries } from "../../lib/chat/followup-entries.js";
import { isMergePrimary } from "../../lib/git/merge-primary.js";
import { useOpenSpecAttachment, useOpenSpecLane } from "../session/ComposerSessionActions.js";
import { useChangesLane } from "./ChangesLane.js";
import { useContextLane } from "./ContextLane.js";
import type { MaybeDockLane } from "./composer-dock-model.js";
import { buildQueueLane } from "./QueueLane.js";

export interface ComposerDockLanesInput {
  /** Bound session; `undefined` → no lanes. */
  session: DashboardSession | undefined;
  /** `isComposerWorking(status, retrying)` (streaming ∨ auto-retrying). */
  working: boolean;

  // Changes lane
  allSessions?: readonly DashboardSession[];
  onShutdownSession?: (sessionId: string) => void;
  /** Review: open the diff view. */
  onReview?: () => void;
  /** Open one changed file's diff. */
  onOpenFile?: (path: string) => void;
  /** Show the unclaimed working-tree changes (defaults to `onReview`). */
  onShowOtherChanges?: () => void;

  // OpenSpec lane (same sources as the session card)
  changes?: OpenSpecChange[];
  openspecHasDir?: boolean;
  openspecPending?: boolean;
  openspecReadiness?: OpenSpecReadiness;
  openspecConfig?: OpenSpecConfig;
  groups?: OpenSpecGroup[];
  assignments?: Record<string, string>;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onAttach?: (changeName: string) => void;
  onDetach?: () => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  /** Re-read the folder's OpenSpec state. */
  onRefresh?: () => void;

  // Queue lane (`session.pendingQueues.followUp` is normalised here)
  onEditFollowUp?: (index: number, text: string) => void;
  onRemoveFollowUp?: (index: number) => void;
  onPromoteFollowUp?: (index: number) => void;
  onClearFollowUps?: () => void;
}

export function useComposerDockLanes(input: ComposerDockLanesInput): readonly MaybeDockLane[] {
  const { session, working } = input;
  const attachment = useOpenSpecAttachment(session, input.changes);
  const mergeIsPrimary =
    !!session &&
    isMergePrimary({
      hasWorktree: !!session.gitWorktree,
      prState: session.gitPrState,
      prDraft: session.gitPrDraft,
      prChecks: session.gitPrChecks,
      prCheckedAt: session.gitPrCheckedAt,
      working,
      attached: !!attachment.attached,
      attachedChangeState: attachment.changeState,
    });

  const changes = useChangesLane({
    session,
    working,
    allSessions: input.allSessions,
    onShutdownSession: input.onShutdownSession,
    mergeIsPrimary,
    onReview: input.onReview,
    onOpenFile: input.onOpenFile,
    onShowOtherChanges: input.onShowOtherChanges,
  });
  const openspec = useOpenSpecLane({
    session,
    attachment,
    changes: input.changes,
    openspecHasDir: input.openspecHasDir,
    openspecPending: input.openspecPending,
    openspecReadiness: input.openspecReadiness,
    openspecConfig: input.openspecConfig,
    groups: input.groups,
    assignments: input.assignments,
    working,
    mergeIsPrimary,
    onSendPrompt: input.onSendPrompt,
    onAttach: input.onAttach,
    onDetach: input.onDetach,
    onReadArtifact: input.onReadArtifact,
    onRefresh: input.onRefresh,
  });
  const queue = session
    ? buildQueueLane({
        followUp: normalizeFollowUpEntries(session.pendingQueues?.followUp),
        onEdit: input.onEditFollowUp,
        onRemove: input.onRemoveFollowUp,
        onPromote: input.onPromoteFollowUp,
        onClearAll: input.onClearFollowUps,
      })
    : null;
  const context = useContextLane({ session, working });
  return [changes, openspec, queue, context];
}
