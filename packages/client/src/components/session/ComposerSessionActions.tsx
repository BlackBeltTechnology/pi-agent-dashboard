import { SettingsActionError } from "@blackbelt-technology/dashboard-plugin-runtime";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type {
  DashboardSession,
  ImageContent,
  OpenSpecChange,
  OpenSpecConfig,
  OpenSpecGroup,
  OpenSpecReadiness,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, DEFAULT_OPENSPEC_CONFIG, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiCheckCircle,
  mdiCircleOutline,
  mdiFileDocumentOutline,
  mdiPaperclip,
  mdiRefresh,
  mdiTextBoxCheckOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { fetchTasks, type OpenSpecTask } from "../../lib/openspec/openspec-tasks-api.js";
import type { AttachmentResolution } from "../../lib/openspec/resolve-attachment.js";
import { useAttachmentResolution } from "../../lib/openspec/useAttachmentResolution.js";
import { type DockLane, dockLaneLabel } from "../chat/composer-dock-model.js";
import { AttachmentTrace, isLiveActive } from "../openspec/AttachmentTrace.js";
import { LazyAttachChangePicker, LazyExploreDialog, LazyNewChangeDialog, LazyProposeDialog, LazyTasksPopover } from "../openspec/lazy-openspec-dialogs.js";
import { OpenSpecStepper } from "../openspec/OpenSpecStepper.js";
import { type ActionSpec, blockedReasonText, deriveOpenSpecActions, type OpenSpecActionKey } from "../openspec/openspec-actions.js";
import { type OverflowItem, OverflowMenu } from "../openspec/SessionOpenSpecActions.js";
import { DialogPortal } from "../primitives/DialogPortal.js";

/**
 * OpenSpec lane of the composer dock (the former composer strip's OpenSpec
 * group, split out of `ComposerSessionActions`). The file keeps the readiness
 * gate (`isOpenSpecLaneVisible`) and the `showTrace` rule that
 * `session-card-subcards` cites.
 *
 * - Gate: the lane renders for READY / PENDING readiness (else
 *   `hasOpenspecDir !== false || pending`) while the session has not ended, and
 *   for a traceable attachment (archived / missing / main checkout) on running
 *   and ended sessions alike (`showTrace`).
 * - Unattached: `Attach change…`, `Explore` and a `⋯` (New/Propose per workflow
 *   config, plus Refresh). Not expandable.
 * - Attached: title `name`, meta `done/total tasks`; the lifecycle bar (letters),
 *   at most one primary and `⋯` are header actions (siblings of the disclosure
 *   control). `⋯` = the card's remaining items (incl. Explore…), Open proposal,
 *   Refresh and Detach, all from the same `deriveOpenSpecActions` as the card.
 * - Traceable: name, trace badge + letters, `⋯` holding only Detach; no
 *   lifecycle bar, primary or workflow action.
 * - Working = streaming ∨ retrying: the primary, the `⋯` workflow items and
 *   Explore are `aria-disabled` (focusable, reason in the tooltip) and the
 *   Tasks segment is inert; segments P/D/S, Open proposal, Attach, Detach and
 *   Refresh stay enabled.
 * - One filled primary for the whole dock: when Merge qualifies
 *   (`mergeIsPrimary`, decided once by `useComposerDockLanes`), this primary
 *   renders outlined.
 * - Expanded body: the next open tasks from `fetchTasks(cwd, change)`, cached
 *   per change and invalidated when `done/total` changes.
 *
 * See changes: redesign-composer-session-strip, resolve-archived-attached-proposal,
 *              add-composer-dock (tasks 5.1–5.3, design D6).
 */

/** How many next open tasks the expanded body lists before `N more`. */
const NEXT_TASKS_SHOWN = 5;

/** The attached change as the lane sees it: one computation, shared with the Merge-emphasis rule. */
export interface OpenSpecAttachment {
  /** `session.attachedProposal` (null/undefined = unattached). */
  attached: string | null;
  resolution: AttachmentResolution | null;
  /** The live-active change in the session's own cwd (lifecycle UI applies), else undefined. */
  change: OpenSpecChange | undefined;
  changeState: ChangeState | undefined;
  /** Archived / missing / main-checkout attachment: traceable even when the cwd's OpenSpec state would hide the lane. */
  showTrace: boolean;
}

export function useOpenSpecAttachment(session: DashboardSession | undefined, changes?: OpenSpecChange[]): OpenSpecAttachment {
  // active (own cwd) | archived | missing | unresolved. See change: resolve-archived-attached-proposal.
  const resolution = useAttachmentResolution(session, changes);
  const attached = session?.attachedProposal ?? null;
  const cwd = session?.cwd ?? "";
  const change = resolution?.kind === "active" && isLiveActive(resolution, cwd) ? resolution.change : undefined;
  const showTrace = !!attached && !!resolution && resolution.kind !== "unresolved" && !isLiveActive(resolution, cwd);
  return { attached, resolution, change, changeState: change ? deriveChangeState(change) : undefined, showTrace };
}

/** Readiness gate of the OpenSpec lane. See change: add-openspec-init-affordances (D6/D7). */
export function isOpenSpecLaneVisible(input: {
  isEnded: boolean;
  showTrace: boolean;
  openspecReadiness?: OpenSpecReadiness;
  openspecHasDir?: boolean;
  openspecPending?: boolean;
}): boolean {
  if (input.showTrace) return true;
  if (input.isEnded) return false;
  return input.openspecReadiness
    ? input.openspecReadiness.state === "READY" || input.openspecReadiness.state === "PENDING"
    : input.openspecHasDir !== false || input.openspecPending === true;
}

type Tone = "primary" | "success" | "info" | "accent" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  primary: "text-blue-400 hover:text-blue-300",
  success: "text-green-400 hover:text-green-300",
  info: "text-cyan-400 hover:text-cyan-300",
  accent: "text-purple-400 hover:text-purple-300",
  neutral: "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
};

/** Borderless header segment (≥ 24 px target, 44 px on phones). Blocked = aria-disabled, focusable. */
function SegmentButton({
  icon,
  label,
  onClick,
  blocked,
  disabled,
  title,
  testId,
  tone = "neutral",
  emphasis,
  ariaHasPopup,
  dashed,
}: {
  icon: string;
  label?: React.ReactNode;
  onClick: () => void;
  blocked?: boolean;
  disabled?: boolean;
  title?: string;
  testId?: string;
  tone?: Tone;
  emphasis?: "filled" | "outlined";
  ariaHasPopup?: "dialog" | "menu";
  dashed?: boolean;
}) {
  const filled = emphasis === "filled" && !blocked && !disabled;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!blocked && !disabled) onClick();
      }}
      disabled={disabled}
      aria-disabled={blocked ? "true" : undefined}
      aria-haspopup={ariaHasPopup}
      title={title}
      data-testid={testId}
      data-tone={tone}
      data-emphasis={emphasis && (filled ? "filled" : "outlined")}
      className={`focus-ring inline-flex items-center gap-0.5 rounded min-h-6 min-w-6 px-2 text-xs bg-transparent hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:cursor-not-allowed max-md:min-h-11 max-md:min-w-11 max-md:justify-center ${TONE_TEXT[tone]}${
        dashed ? " outline-1 outline-dashed -outline-offset-4 outline-[var(--border-secondary)]" : ""
      }${filled ? " font-semibold !bg-[var(--accent-soft)] !text-[var(--text-primary)]" : ""}`}
    >
      <Icon path={icon} size={0.5} />
      {label !== undefined && <span className="truncate">{label}</span>}
    </button>
  );
}

const OVERFLOW_BTN_CLASS =
  "focus-ring inline-flex items-center justify-center rounded min-h-6 min-w-6 px-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-md:min-h-11 max-md:min-w-11";

export interface OpenSpecLaneInput {
  session: DashboardSession | undefined;
  /** The attached change (from `useOpenSpecAttachment`). */
  attachment: OpenSpecAttachment;
  changes?: OpenSpecChange[];
  openspecHasDir?: boolean;
  openspecPending?: boolean;
  /** Server-derived readiness for the session's cwd; `undefined` (older server) degrades to `hasDir !== false || pending`. */
  openspecReadiness?: OpenSpecReadiness;
  /** OpenSpec workflow config — gates which actions render. */
  openspecConfig?: OpenSpecConfig;
  /** Folder groups for the grouped attach picker (same source as the card). */
  groups?: OpenSpecGroup[];
  assignments?: Record<string, string>;
  /** streaming ∨ retrying. Defaults to `status === "streaming"`. */
  working?: boolean;
  /** Merge is the dock's one filled primary → this lane's primary renders outlined. */
  mergeIsPrimary: boolean;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onAttach?: (changeName: string) => void;
  onDetach?: () => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  /** Re-read the folder's OpenSpec state (the strip's former leading Refresh button). */
  onRefresh?: () => void;
}

interface LaneActionsProps extends Omit<OpenSpecLaneInput, "session" | "attachment"> {
  session: DashboardSession;
  attachment: OpenSpecAttachment;
  working: boolean;
}

/** One modal at a time: the dialogs the header actions open. */
type LaneDialog = "tasks" | "explore" | "archive" | "archiveAnyway" | "new" | "propose" | "attach";

/** Action derivation + handlers shared by the three header shapes (attached, unattached, traceable). */
interface ActionModel {
  actions: ReturnType<typeof deriveOpenSpecActions>;
  toItem: (a: ActionSpec) => OverflowItem;
  segment: (a: ActionSpec, emphasis?: "filled" | "outlined") => React.ReactNode;
  refresh: OverflowItem | null;
  openProposal: OverflowItem | null;
  setDialog: (d: LaneDialog | null) => void;
}

function useActionModel(props: LaneActionsProps, setDialog: (d: LaneDialog | null) => void): ActionModel {
  const { session, attachment, openspecConfig, working, onSendPrompt, onDetach, onReadArtifact, onRefresh } = props;
  const { attached, resolution, change, changeState } = attachment;
  const cfg = openspecConfig ?? DEFAULT_OPENSPEC_CONFIG;
  const allArtifactsDone =
    !!change && change.artifacts.length > 0 && change.artifacts.every((a) => a.status === "done" || a.status === "skipped");
  const actions = deriveOpenSpecActions({
    attached: !!attached,
    found: !!change,
    state: changeState,
    wf: (name) => cfg.workflows.includes(name),
    isEnded: session.status === "ended",
    working,
    showArchiveAnyway: changeState === ChangeState.IMPLEMENTING && change?.isComplete === true && allArtifactsDone,
    includeDetach: true,
    idPrefix: "composer-",
    error: change?.error?.message,
  });
  const send = (skill: string) => () => onSendPrompt?.(`/skill:${skill} ${attached}`);
  const handlers: Record<OpenSpecActionKey, () => void> = {
    continue: send("openspec-continue-change"),
    ff: send("openspec-ff-change"),
    apply: send("openspec-apply-change"),
    archive: () => setDialog("archive"),
    verify: send("openspec-verify-change"),
    archiveAnyway: () => setDialog("archiveAnyway"),
    explore: () => setDialog("explore"),
    detach: () => onDetach?.(),
    new: () => setDialog("new"),
    propose: () => setDialog("propose"),
  };
  const label = (a: ActionSpec) => i18nT(a.labelKey, undefined, a.labelFallback);
  const reason = (a: ActionSpec) => blockedReasonText(a, i18nT);
  const toItem = (a: ActionSpec): OverflowItem => ({
    testId: a.testId,
    label: label(a),
    icon: a.icon,
    onSelect: handlers[a.key],
    disabled: a.blocked,
    disabledReason: reason(a),
    dividerBefore: a.dividerBefore,
  });
  const segment = (a: ActionSpec, emphasis?: "filled" | "outlined") => (
    <SegmentButton
      key={a.key}
      icon={a.icon}
      label={label(a)}
      onClick={handlers[a.key]}
      blocked={a.blocked}
      title={reason(a)}
      testId={a.testId}
      tone={a.variant}
      emphasis={emphasis}
    />
  );
  const openProposal: OverflowItem | null =
    isLiveActive(resolution, session.cwd) && onReadArtifact && attached
      ? {
          testId: "composer-open-proposal-btn",
          label: i18nT("openspec.openProposal", undefined, "Open proposal"),
          icon: mdiFileDocumentOutline,
          onSelect: () => onReadArtifact(attached, "proposal"),
        }
      : null;
  const refresh: OverflowItem | null = onRefresh
    ? { testId: "composer-refresh-btn", label: i18nT("common.refresh", undefined, "Refresh"), icon: mdiRefresh, onSelect: onRefresh }
    : null;
  return { actions, toItem, segment, refresh, openProposal, setDialog };
}

/** Open proposal and Refresh sit between the workflow items and Detach. */
function withExtras(items: OverflowItem[], extras: (OverflowItem | null)[]): OverflowItem[] {
  const detach = items.find((i) => i.testId === "composer-detach-btn");
  const rest = items.filter((i) => i !== detach);
  const added = extras.filter((i): i is OverflowItem => i !== null);
  return [
    ...rest,
    ...added.map((item, i) => (i === 0 ? { ...item, dividerBefore: rest.length > 0 } : item)),
    ...(detach ? [{ ...detach, dividerBefore: rest.length + added.length > 0 }] : []),
  ];
}

const overflowMenu = (items: OverflowItem[]) => (
  <OverflowMenu items={items} idPrefix="composer-" ariaDisabled buttonClassName={OVERFLOW_BTN_CLASS} />
);

/** Archived / missing / main checkout: trace + a `⋯` with Detach only. */
function TraceActions({ props, model }: { props: LaneActionsProps; model: ActionModel }) {
  return (
    <>
      <AttachmentTrace resolution={props.attachment.resolution} sessionCwd={props.session.cwd} />
      {overflowMenu(model.actions.overflow.map(model.toItem))}
    </>
  );
}

function AttachedActions({ props, model }: { props: LaneActionsProps; model: ActionModel }) {
  const { session, working, mergeIsPrimary, onReadArtifact } = props;
  const { change, changeState } = props.attachment;
  const wf = (name: string) => (props.openspecConfig ?? DEFAULT_OPENSPEC_CONFIG).workflows.includes(name);
  const canArchive = changeState === ChangeState.COMPLETE && !working && session.status !== "ended" && wf("archive");
  const items = withExtras(model.actions.overflow.map(model.toItem), [model.openProposal, model.refresh]);
  return (
    <>
      {change && (
        <div
          data-testid="composer-lifecycle"
          className="flex flex-shrink-0 items-center px-1 self-stretch"
          style={{ width: "var(--composer-lifecycle-w)" }}
        >
          <OpenSpecStepper
            variant="sidebar"
            testIdPrefix="composer-"
            change={change}
            onReadArtifact={onReadArtifact}
            onOpenTasks={change.totalTasks > 0 && !working ? () => model.setDialog("tasks") : undefined}
            onArchive={canArchive ? () => model.setDialog("archive") : undefined}
          />
        </div>
      )}
      {model.actions.primary && model.segment(model.actions.primary, mergeIsPrimary ? "outlined" : "filled")}
      {items.length > 0 && overflowMenu(items)}
    </>
  );
}

function UnattachedActions({ props, model }: { props: LaneActionsProps; model: ActionModel }) {
  const { changes, onAttach } = props;
  const none = (changes?.length ?? 0) === 0;
  const items = [...model.actions.unattached.filter((a) => a.key !== "explore").map(model.toItem), ...(model.refresh ? [model.refresh] : [])];
  return (
    <>
      <SegmentButton
        icon={mdiPaperclip}
        label={none ? i18nT("openspec.noChanges", undefined, "No changes") : i18nT("openspec.attachChange", undefined, "Attach change...")}
        onClick={() => model.setDialog("attach")}
        disabled={none || !onAttach}
        testId="composer-attach-chip"
        ariaHasPopup="dialog"
        dashed
      />
      {model.actions.unattached.filter((a) => a.key === "explore").map((a) => model.segment(a))}
      {items.length > 0 && overflowMenu(items)}
    </>
  );
}

/** The modal opened by a header action (one at a time). */
function LaneDialogs({ props, dialog, close }: { props: LaneActionsProps; dialog: LaneDialog | null; close: () => void }) {
  const { session, attachment, changes, groups, assignments, onSendPrompt, onAttach } = props;
  const { attached, change } = attachment;
  const sendAndClose = (text: string, images?: ImageContent[]) => {
    onSendPrompt?.(text, images);
    close();
  };
  switch (dialog) {
    case "tasks":
      return attached ? (
        <Suspense fallback={null}>
          <LazyTasksPopover cwd={session.cwd} change={attached} onClose={close} />
        </Suspense>
      ) : null;
    case "explore":
      return (
        <DialogPortal>
          <Suspense fallback={null}>
            <LazyExploreDialog
              changeName={attached ?? ""}
              onSend={(text, images) => sendAndClose(`${attached ? `/skill:openspec-explore ${attached}\n` : "/skill:openspec-explore\n"}${text}`, images)}
              onClose={close}
            />
          </Suspense>
        </DialogPortal>
      );
    case "new":
      return (
        <DialogPortal>
          <Suspense fallback={null}>
            <LazyNewChangeDialog onSend={(prompt) => sendAndClose(prompt)} onClose={close} />
          </Suspense>
        </DialogPortal>
      );
    case "propose":
      return (
        <DialogPortal>
          <Suspense fallback={null}>
            <LazyProposeDialog onSend={(prompt) => sendAndClose(prompt)} onClose={close} />
          </Suspense>
        </DialogPortal>
      );
    case "attach":
      return onAttach ? (
        <Suspense fallback={null}>
          <LazyAttachChangePicker
            changes={changes ?? []}
            groups={groups}
            assignments={assignments}
            onSelect={(name) => {
              onAttach(name);
              close();
            }}
            onCancel={close}
          />
        </Suspense>
      ) : null;
    case "archive":
      return attached ? (
        <Confirm
          open
          title={i18nT("openspec.archiveChange", undefined, "Archive change?")}
          message={i18nT("openspec.archiveConfirmMessage", { name: attached }, 'Archive "{name}"?')}
          confirmLabel={i18nT("openspec.archive", undefined, "Archive")}
          onConfirm={() => sendAndClose(`/skill:openspec-archive-change ${attached}`)}
          onClose={close}
        />
      ) : null;
    case "archiveAnyway":
      return attached && change ? (
        <Confirm
          open
          title={i18nT("openspec.archiveAnyway2", undefined, "Archive anyway?")}
          message={i18nT(
            "openspec.archiveAnywayMessage",
            { unchecked: Math.max(0, change.totalTasks - change.completedTasks), total: change.totalTasks },
            "{unchecked} of {total} tasks are unchecked. Archive anyway?",
          )}
          confirmLabel={i18nT("openspec.archiveAnyway", undefined, "Archive anyway")}
          onConfirm={() => sendAndClose(`/skill:openspec-archive-change ${attached}`)}
          onClose={close}
        />
      ) : null;
    default:
      return null;
  }
}

/** Header actions of the lane (stepper, primary, `⋯`, attach/explore) plus the dialogs they open. */
function OpenSpecLaneActions(props: LaneActionsProps) {
  const [dialog, setDialog] = useState<LaneDialog | null>(null);
  const model = useActionModel(props, setDialog);
  const { attached, showTrace } = props.attachment;
  let Content = UnattachedActions;
  if (attached) Content = showTrace ? TraceActions : AttachedActions;
  return (
    <>
      <Content props={props} model={model} />
      <LaneDialogs props={props} dialog={dialog} close={() => setDialog(null)} />
    </>
  );
}

/** Tasks fetched for one change, valid while its `done/total` stays the same. */
interface TasksCacheEntry {
  signature: string;
  tasks: OpenSpecTask[];
}
type TasksCache = Map<string, TasksCacheEntry>;

type TasksState = { status: "loading" } | { status: "error" } | { status: "ready"; tasks: OpenSpecTask[] };

/** Expanded body: the next open tasks, fetched on expand and cached per change. */
function OpenSpecTasksBody({
  cwd,
  change,
  signature,
  cache,
  onReadArtifact,
}: {
  cwd: string;
  change: string;
  signature: string;
  cache: TasksCache;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
}) {
  const errorId = useId();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<TasksState>(() => {
    const hit = cache.get(change);
    return hit && hit.signature === signature ? { status: "ready", tasks: hit.tasks } : { status: "loading" };
  });
  useEffect(() => {
    const hit = cache.get(change);
    if (hit && hit.signature === signature && attempt === 0) {
      setState({ status: "ready", tasks: hit.tasks });
      return;
    }
    const ac = new AbortController();
    setState({ status: "loading" });
    fetchTasks(cwd, change, ac.signal).then(
      (payload) => {
        if (ac.signal.aborted) return;
        cache.set(change, { signature, tasks: payload.tasks });
        setState({ status: "ready", tasks: payload.tasks });
      },
      () => {
        if (!ac.signal.aborted) setState({ status: "error" });
      },
    );
    return () => ac.abort();
  }, [cwd, change, signature, cache, attempt]);

  const openTasksMd = onReadArtifact && (
    <button
      type="button"
      data-testid="composer-openspec-open-tasks"
      onClick={() => onReadArtifact(change, "tasks")}
      className="focus-ring inline-flex min-h-6 items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-md:min-h-11"
    >
      <Icon path={mdiTextBoxCheckOutline} size={0.55} aria-hidden="true" />
      {i18nT("dock.openspec.openTasks", undefined, "Open tasks.md")}
    </button>
  );

  if (state.status === "loading") {
    return (
      <div data-testid="composer-openspec-tasks-loading" role="status" className="px-1.5 py-1 text-xs text-[var(--text-secondary)]">
        {i18nT("dock.openspec.loadingTasks", undefined, "Loading tasks…")}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div data-testid="composer-openspec-tasks-body">
        <SettingsActionError id={errorId} testId="composer-openspec-tasks-error">
          <span className="inline-flex flex-wrap items-center gap-2">
            {i18nT("dock.openspec.tasksFailed", undefined, "Couldn't load tasks")}
            <button
              type="button"
              data-testid="composer-openspec-tasks-retry"
              aria-describedby={errorId}
              onClick={() => setAttempt((n) => n + 1)}
              className="focus-ring inline-flex min-h-6 items-center rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-md:min-h-11"
            >
              {i18nT("common.retry", undefined, "Retry")}
            </button>
            {openTasksMd}
          </span>
        </SettingsActionError>
      </div>
    );
  }

  const open = state.tasks.filter((task) => !task.done);
  const lastDone = [...state.tasks].reverse().find((task) => task.done);
  const shown = open.slice(0, NEXT_TASKS_SHOWN);
  const more = open.length - shown.length;
  const rows = lastDone ? [lastDone, ...shown] : shown;
  return (
    <div data-testid="composer-openspec-tasks-body" className="grid gap-0.5">
      {rows.length === 0 && (
        <div className="px-1.5 py-1 text-xs text-[var(--text-secondary)]">{i18nT("dock.openspec.noOpenTasks", undefined, "No open tasks")}</div>
      )}
      {rows.map((task) => (
        <div
          key={task.id}
          data-testid="composer-openspec-task"
          data-done={task.done ? "true" : "false"}
          className="flex min-h-8 items-center gap-2 pl-1.5 text-xs text-[var(--text-primary)]"
        >
          <Icon
            path={task.done ? mdiCheckCircle : mdiCircleOutline}
            size={0.6}
            aria-hidden="true"
            className={task.done ? "flex-none text-[var(--accent-green-text)]" : "flex-none text-[var(--text-secondary)]"}
          />
          <span className="flex-none tabular-nums text-[var(--text-secondary)]">{task.id}</span>
          <span className={`min-w-0 truncate ${task.done ? "text-[var(--text-secondary)] line-through" : ""}`} title={task.text}>
            {task.text}
          </span>
          <span className="sr-only">
            {task.done ? i18nT("dock.openspec.taskDone", undefined, "done") : i18nT("dock.openspec.taskTodo", undefined, "to do")}
          </span>
        </div>
      ))}
      <div className="flex min-h-8 items-center gap-2 pl-1.5 text-xs text-[var(--text-secondary)]">
        {more > 0 && (
          <span data-testid="composer-openspec-more-tasks">{i18nT("dock.openspec.moreTasks", { count: more }, "{count} more")} ·</span>
        )}
        {openTasksMd}
      </div>
    </div>
  );
}

/**
 * The OpenSpec lane, or `null` when the readiness gate hides it. Pure assembly:
 * all state that must survive a layout flip lives here (the tasks cache) or in
 * the actions component (dialogs).
 */
export function useOpenSpecLane(input: OpenSpecLaneInput): DockLane | null {
  const { session, attachment } = input;
  // Per-change tasks cache: survives collapse/expand, dropped with the session's dock.
  const cacheRef = useRef<TasksCache>(new Map());
  if (!session) return null;
  const { attached, change, showTrace } = attachment;
  const working = input.working ?? session.status === "streaming";
  const isEnded = session.status === "ended";
  if (!isOpenSpecLaneVisible({ isEnded, showTrace, ...input })) return null;

  const actions = (
    <OpenSpecLaneActions {...input} session={session} working={working} />
  );
  const base = {
    key: "openspec" as const,
    label: dockLaneLabel("openspec"),
    icon: <Icon path={mdiTextBoxCheckOutline} size={0.7} />,
    testId: "composer-openspec-container",
    actions,
  };

  if (!attached) {
    return {
      ...base,
      title: dockLaneLabel("openspec"),
      summary: i18nT("dock.openspec.attachShort", undefined, "Attach"),
      summaryText: i18nT("dock.openspec.unattached", undefined, "No change attached"),
      expandable: false,
    };
  }

  const counts = change ? i18nT("dock.openspec.tasksCount", { done: change.completedTasks, total: change.totalTasks }, "{done}/{total} tasks") : undefined;
  const signature = change ? `${change.completedTasks}/${change.totalTasks}` : "";
  return {
    ...base,
    title: <span data-testid="composer-openspec-title">{attached}</span>,
    meta: counts ? <span data-testid="composer-openspec-counts">{counts}</span> : undefined,
    summary: change ? `${change.completedTasks}/${change.totalTasks}` : attached,
    summaryText: counts ? `${attached} ${counts}` : attached,
    expandable: !!change,
    renderBody: change
      ? () => (
          <OpenSpecTasksBody
            cwd={session.cwd}
            change={attached}
            signature={signature}
            cache={cacheRef.current}
            onReadArtifact={input.onReadArtifact}
          />
        )
      : undefined,
  };
}
