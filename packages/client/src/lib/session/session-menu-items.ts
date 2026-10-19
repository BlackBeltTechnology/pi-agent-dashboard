/**
 * Pure derivation of the session actions menu (`SessionActionsMenu`).
 *
 * `deriveSessionMenu(session, ctx)` composes the existing derivers —
 * `deriveOpenSpecActions` (attached-change primary + workflow items),
 * `deriveWorktreeActions` (Push / Open PR / Merge / Close), `isMergePrimary`
 * (via `ctx.mergeIsPrimary`) and the attachment resolution — into the fixed
 * host-owned taxonomy `NEXT · SESSION · OPENSPEC · GIT · VIEW`. The `PLUGINS`
 * group is not derived here: its content is plugin-rendered React, hosted by
 * the menu component between GIT and VIEW.
 *
 * Holds no closures over React state: every side effect is a callback on
 * `ctx.actions`, so the derivation unit-tests without a DOM.
 *
 * Rules enforced here:
 * - NEXT holds at most one item — the ONLY emphasised item in the whole menu:
 *   Merge when the Merge-emphasis rule holds (the OpenSpec primary is then kept
 *   in OPENSPEC, un-emphasised), else the OpenSpec primary.
 * - an item placed in NEXT is not repeated in its home group.
 * - archived / missing / unresolved / main-checkout attachments offer only
 *   artifact letters (where known) and Detach.
 * - the OPENSPEC group follows the OPENSPEC subcard's readiness gate.
 * - `rare` items fold behind one `More…` expander per group (`partitionRare`).
 *
 * See change: add-session-actions-flyout (D1, D2, D8, D13).
 */

import type { UiTone } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import {
  ChangeState,
  type DashboardSession,
  deriveChangeState,
  type OpenSpecChange,
  type OpenSpecReadiness,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArchiveArrowUp,
  mdiArchiveOutline,
  mdiArrowUpBoldOutline,
  mdiCardsOutline,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiCloseBoxOutline,
  mdiCloseCircleOutline,
  mdiCompassOutline,
  mdiFastForward,
  mdiLightbulbOnOutline,
  mdiLinkOff,
  mdiOpenInNew,
  mdiPaperclip,
  mdiPencilOutline,
  mdiPlayCircleOutline,
  mdiPlus,
  mdiSourceBranch,
  mdiSourceBranchPlus,
  mdiSourceCommit,
  mdiSourceFork,
  mdiSourceMerge,
  mdiSourcePull,
  mdiTune,
} from "@mdi/js";
import { deriveStepperState, type SegmentId, type SegmentState } from "../../components/openspec/OpenSpecStepper.js";
import { type ActionSpec, deriveOpenSpecActions, type OpenSpecActionKey } from "../../components/openspec/openspec-actions.js";
import { artifactLetter } from "../../components/openspec/openspec-helpers.js";
import { deriveWorktreeActions } from "../../components/worktree/worktree-actions.js";
import { t as i18nT } from "../i18n/i18n.js";
import { buildArchiveArtifactUrl, buildOpenSpecPreviewUrl } from "../nav/route-builders.js";
import type { AttachmentResolution } from "../openspec/resolve-attachment.js";
import { isAcpSession, isRemoteOrigin } from "./session-origin-view.js";

export type SessionMenuGroupId = "next" | "session" | "openspec" | "git" | "view";

/** Dialogs the per-card dialog host (`SessionCardDialogs`) can open. */
export type SessionDialogKind =
  | "explore"
  | "archive"
  | "archive-anyway"
  | "tasks"
  | "new-change"
  | "propose"
  | "attach"
  | "bulk-archive"
  | "merge"
  | "close-worktree"
  | "commit"
  | "switch-branch";

interface SessionMenuSegment {
  id: SegmentId;
  label: string;
  letter: string;
  state: SegmentState;
  /** Absent ⇒ inert status (not focusable, not a `menuitem`). */
  onSelect?: () => void;
}

export interface SessionMenuItem {
  /** Stable id — drives `session-menu-item-<id>` and focus preservation. */
  id: string;
  label: string;
  icon?: string;
  onSelect?: () => void;
  /** `aria-disabled` + focusable; `onSelect` is never invoked. */
  disabled?: boolean;
  reason?: string;
  /** Semantic tone: icon colour (danger also tints hover/focus). Stripped on the NEXT copy. */
  tone?: UiTone;
  /** Primary emphasis — only ever set on the NEXT item. */
  emphasis?: boolean;
  /** Folds behind the group's `More…` expander when ≥ 2 rare items. */
  rare?: boolean;
  /** Overrides `session-menu-item-<id>` (legacy ids). */
  testId?: string;
  /** `segments`: the lifecycle artifact row (mirrors the card's lifecycle bar). */
  kind?: "item" | "segments";
  segments?: SessionMenuSegment[];
}

export interface SessionMenuGroup {
  id: SessionMenuGroupId;
  title: string;
  subtitle?: string;
  items: SessionMenuItem[];
}

/** Callbacks the menu items invoke. Optional ones gate their item's presence. */
export interface SessionMenuActions {
  resume?: (mode: "continue" | "fork") => void;
  spawnSibling?: () => void;
  spawnWorktree?: () => void;
  rename?: () => void;
  archiveSession?: () => void;
  exit?: () => void;
  openDialog: (kind: SessionDialogKind) => void;
  /** Send `/skill:<skill> <attachedProposal>` to the session. */
  sendSkill: (skill: string) => void;
  detach: () => void;
  readArtifact?: (changeName: string, artifactId: string) => void;
  navigate: (url: string) => void;
  push: () => void;
  openPr: () => void;
  openUrl: (url: string) => void;
  openCardSections: () => void;
  openCardDefaults: () => void;
}

export interface SessionMenuCtx {
  /** streaming ∨ retrying. */
  working: boolean;
  mergeIsPrimary: boolean;
  isHidden: boolean;
  /** Section visibility `spawn` (D8). */
  showSpawn: boolean;
  canRename: boolean;
  canArchive: boolean;
  /** Whether an Exit handler is wired. */
  canExit: boolean;
  /** OpenSpec handlers wired (the card's gate: changes + send + attach + detach). */
  openspecWired: boolean;
  changes: readonly OpenSpecChange[] | undefined;
  readiness?: OpenSpecReadiness;
  hasDir?: boolean;
  initialized?: boolean;
  pending?: boolean;
  /** Workflow enabled? (`openspecConfig.workflows.includes`). */
  wf: (workflow: string) => boolean;
  resolution: AttachmentResolution | null;
  /** Bulk archive handler wired. */
  canBulkArchive: boolean;
  ghAvailable?: boolean;
  dirtyCount: number;
  actions: SessionMenuActions;
}

const tr = (key: string, fallback: string, params?: Record<string, string | number>) => i18nT(key, params, fallback);

const CWD_MISSING = () => tr("session.cwdMissing", "session's directory no longer exists");
const STREAMING = () => tr("session.sessionIsStreaming", "Session is streaming");

/** OpenSpec action keys that fold behind `More…` (design D1 / spec "rare set"). */
const OPENSPEC_RARE: ReadonlySet<OpenSpecActionKey> = new Set<OpenSpecActionKey>(["ff", "explore", "archiveAnyway", "detach"]);

const OPENSPEC_LABEL: Record<OpenSpecActionKey, () => string> = {
  continue: () => tr("sessionMenu.continue", "Continue"),
  ff: () => tr("sessionMenu.fastForward", "Fast-forward"),
  apply: () => tr("sessionMenu.apply", "Apply"),
  archive: () => tr("sessionMenu.archiveChange", "Archive change"),
  verify: () => tr("sessionMenu.verify", "Verify"),
  archiveAnyway: () => tr("sessionMenu.archiveAnyway", "Archive anyway…"),
  explore: () => tr("sessionMenu.explore", "Explore…"),
  detach: () => tr("sessionMenu.detach", "Detach"),
  new: () => tr("sessionMenu.newChange", "New change…"),
  propose: () => tr("sessionMenu.propose", "Propose…"),
};

const OPENSPEC_TONE: Partial<Record<OpenSpecActionKey, UiTone>> = {
  verify: "go",
  new: "create",
  propose: "create",
  archiveAnyway: "caution",
};

const OPENSPEC_ICON: Partial<Record<OpenSpecActionKey, string>> = {
  continue: mdiChevronRight,
  ff: mdiFastForward,
  apply: mdiPlayCircleOutline,
  archive: mdiArchiveOutline,
  verify: mdiCheckCircleOutline,
  archiveAnyway: mdiArchiveArrowUp,
  explore: mdiCompassOutline,
  detach: mdiLinkOff,
  new: mdiPlus,
  propose: mdiLightbulbOnOutline,
};

export type OpenSpecGroupMode = "full" | "detach-only" | "none";

/**
 * Readiness gate for the OPENSPEC group — mirrors the OPENSPEC subcard's gate
 * (`SessionCard.tsx`): GLOBAL_OFF / OPTED_OUT / ABSENT / PENDING hide the group;
 * BROKEN / STALE keep only Detach (when attached); READY is full. A payload with
 * no `readiness` degrades like the subcard's legacy `hasDir || initialized ||
 * pending` heuristic. An ABSENT cwd keeps the group for an attachment that is
 * NOT live-active (a removed worktree's archived / missing / main-checkout
 * trace), so such a session can still be detached.
 */
export function openspecGroupMode(
  ctx: Pick<SessionMenuCtx, "openspecWired" | "readiness" | "hasDir" | "initialized" | "pending">,
  attached: boolean,
  liveActive: boolean,
): OpenSpecGroupMode {
  if (!ctx.openspecWired) return "none";
  if (!ctx.readiness) return legacyOpen(ctx) || attached ? "full" : "none";
  switch (ctx.readiness.state) {
    case "BROKEN":
    case "STALE":
      return attached ? "detach-only" : "none";
    case "GLOBAL_OFF":
    case "OPTED_OUT":
    case "PENDING":
      return "none";
    case "ABSENT":
      return attached && !liveActive ? "full" : "none";
    default:
      return "full";
  }
}

/** The OPENSPEC subcard's legacy visibility heuristic for a payload with no `readiness`. */
function legacyOpen(ctx: Pick<SessionMenuCtx, "hasDir" | "initialized" | "pending">): boolean {
  if (ctx.hasDir !== undefined) return Boolean(ctx.hasDir) || Boolean(ctx.pending);
  if (ctx.initialized === undefined) return true;
  return Boolean(ctx.initialized) || Boolean(ctx.pending);
}

function spec2item(a: ActionSpec, onSelect: () => void): SessionMenuItem {
  return {
    id: `openspec-${a.key}`,
    label: OPENSPEC_LABEL[a.key](),
    icon: OPENSPEC_ICON[a.key],
    tone: OPENSPEC_TONE[a.key],
    onSelect,
    disabled: a.blocked,
    reason: a.blocked ? STREAMING() : undefined,
    rare: OPENSPEC_RARE.has(a.key),
  };
}

interface OpenSpecBuild {
  items: SessionMenuItem[];
  /** The OpenSpec primary (promoted to NEXT unless Merge wins). */
  primary?: SessionMenuItem;
  subtitle?: string;
}

const detachItem = (actions: SessionMenuActions): SessionMenuItem => ({
  id: "openspec-detach",
  label: OPENSPEC_LABEL.detach(),
  icon: mdiLinkOff,
  onSelect: actions.detach,
  rare: true,
});

/** The attached, live-active change: lifecycle row, Open change, primary + workflow items. */
function liveChangeItems(ctx: SessionMenuCtx, change: OpenSpecChange, isEnded: boolean): OpenSpecBuild {
  const { actions } = ctx;
  const state = deriveChangeState(change);
  const allDone = change.artifacts.length > 0 && change.artifacts.every((a) => a.status === "done" || a.status === "skipped");
  const showArchiveAnyway = state === ChangeState.IMPLEMENTING && change.isComplete === true && allDone;
  const { primary, overflow } = deriveOpenSpecActions({
    attached: true, found: true, state, wf: ctx.wf, isEnded, working: ctx.working, showArchiveAnyway, includeDetach: true, idPrefix: "",
  });
  const handlers: Record<OpenSpecActionKey, () => void> = {
    continue: () => actions.sendSkill("openspec-continue-change"),
    ff: () => actions.sendSkill("openspec-ff-change"),
    apply: () => actions.sendSkill("openspec-apply-change"),
    archive: () => actions.openDialog("archive"),
    verify: () => actions.sendSkill("openspec-verify-change"),
    archiveAnyway: () => actions.openDialog("archive-anyway"),
    explore: () => actions.openDialog("explore"),
    detach: actions.detach,
    new: () => actions.openDialog("new-change"),
    propose: () => actions.openDialog("propose"),
  };
  // Lifecycle artifact row — the same five segments, states and per-segment
  // actions as the card's lifecycle bar (`OpenSpecStepper`).
  const hasTasks = change.totalTasks > 0;
  const canArchive = state === ChangeState.COMPLETE && !ctx.working && !isEnded && ctx.wf("archive");
  const states = deriveStepperState({
    artifacts: change.artifacts,
    completedTasks: change.completedTasks,
    totalTasks: change.totalTasks,
    changeState: state,
  });
  const seg = (id: SegmentId, label: string, onSelect?: () => void): SessionMenuSegment => ({
    id,
    label,
    letter: id === "archive" ? "A" : artifactLetter(id),
    state: states[id],
    onSelect,
  });
  const artifactSelect = (id: SegmentId) => (actions.readArtifact ? () => actions.readArtifact?.(change.name, id) : undefined);
  const items: SessionMenuItem[] = [
    {
      id: "openspec-lifecycle",
      kind: "segments",
      label: tr("sessionMenu.lifecycle", "OpenSpec lifecycle"),
      segments: [
        seg("proposal", tr("openspec.node.proposal", "Proposal"), artifactSelect("proposal")),
        seg("design", tr("openspec.node.design", "Design"), artifactSelect("design")),
        seg("specs", tr("openspec.node.specs", "Specs"), artifactSelect("specs")),
        seg("tasks", tr("openspec.node.tasks", "Tasks"), hasTasks && !ctx.working ? () => actions.openDialog("tasks") : undefined),
        seg("archive", tr("openspec.node.archive", "Archive"), canArchive ? () => actions.openDialog("archive") : undefined),
      ],
    },
  ];
  if (actions.readArtifact) {
    items.push({
      id: "open-change",
      label: tr("sessionMenu.openChange", "Open change"),
      icon: mdiOpenInNew,
      onSelect: () => actions.readArtifact?.(change.name, "proposal"),
    });
  }
  const primaryItem = primary ? spec2item(primary, handlers[primary.key]) : undefined;
  if (primaryItem) items.push(primaryItem);
  for (const a of overflow) items.push(spec2item(a, handlers[a.key]));
  return { items, primary: primaryItem, subtitle: change.name };
}

/** An attachment that is not live-active in this cwd: letters where known, then Detach. */
function traceItems(ctx: SessionMenuCtx, attached: string): OpenSpecBuild {
  const { actions, resolution } = ctx;
  const letter = (id: string, navigateTo: () => void): SessionMenuItem => ({
    id: `openspec-letter-${id}`,
    label: `${artifactLetter(id)} · ${id}`,
    icon: mdiPaperclip,
    onSelect: navigateTo,
  });
  const items: SessionMenuItem[] = [];
  if (resolution?.kind === "archived") {
    const { entry, cwd } = resolution;
    for (const a of entry.artifacts) items.push(letter(a.id, () => actions.navigate(buildArchiveArtifactUrl(cwd, entry.name, a.id))));
  } else if (resolution?.kind === "active") {
    // Active, but in the main checkout rather than this session's own cwd.
    const { change, cwd } = resolution;
    for (const a of change.artifacts) items.push(letter(a.id, () => actions.navigate(buildOpenSpecPreviewUrl(cwd, change.name, a.id))));
  }
  items.push(detachItem(actions));
  return { items, subtitle: attached };
}

/** No attached change: Attach, New / Propose / Explore (as configured) and Bulk archive. */
function unattachedItems(ctx: SessionMenuCtx, isEnded: boolean): OpenSpecBuild {
  const { actions } = ctx;
  const noChanges = !ctx.changes || ctx.changes.length === 0;
  const items: SessionMenuItem[] = [
    {
      id: "openspec-attach",
      label: tr("sessionMenu.attachChange", "Attach change…"),
      icon: mdiPaperclip,
      onSelect: () => actions.openDialog("attach"),
      disabled: noChanges,
      reason: noChanges ? tr("openspec.noChanges", "No changes") : undefined,
    },
  ];
  const { unattached } = deriveOpenSpecActions({
    attached: false, found: false, wf: ctx.wf, isEnded, working: ctx.working, showArchiveAnyway: false, includeDetach: true, idPrefix: "",
  });
  const handlers: Partial<Record<OpenSpecActionKey, () => void>> = {
    new: () => actions.openDialog("new-change"),
    propose: () => actions.openDialog("propose"),
    explore: () => actions.openDialog("explore"),
  };
  for (const a of unattached) items.push(spec2item(a, handlers[a.key] ?? (() => undefined)));
  const hasCompleted = (ctx.changes ?? []).some((c) => c.status === "complete");
  if (hasCompleted && ctx.canBulkArchive && ctx.wf("bulk-archive")) {
    items.push({
      id: "openspec-bulk-archive",
      label: tr("sessionMenu.bulkArchive", "Bulk archive…"),
      icon: mdiArchiveArrowUp,
      onSelect: () => actions.openDialog("bulk-archive"),
      disabled: ctx.working,
      reason: ctx.working ? STREAMING() : undefined,
    });
  }
  return { items };
}

function buildOpenSpec(session: DashboardSession, ctx: SessionMenuCtx, isEnded: boolean): OpenSpecBuild {
  const attached = session.attachedProposal || undefined;
  const { resolution } = ctx;
  const liveChange = attached && resolution?.kind === "active" && resolution.cwd === session.cwd ? resolution.change : undefined;
  const mode = openspecGroupMode(ctx, !!attached, !!liveChange);
  if (mode === "none") return { items: [] };
  if (mode === "detach-only" && attached) {
    const d = deriveOpenSpecActions({
      attached: true, found: false, wf: ctx.wf, isEnded, working: ctx.working, showArchiveAnyway: false, includeDetach: true, idPrefix: "",
    });
    return { items: d.overflow.map((a) => spec2item(a, ctx.actions.detach)), subtitle: attached };
  }
  if (mode === "detach-only") return { items: [] };
  if (!attached) return unattachedItems(ctx, isEnded);
  return liveChange ? liveChangeItems(ctx, liveChange, isEnded) : traceItems(ctx, attached);
}

interface GitBuild {
  items: SessionMenuItem[];
  mergeItem?: SessionMenuItem;
}

function buildGit(session: DashboardSession, ctx: SessionMenuCtx): GitBuild {
  const { actions } = ctx;
  const wt = deriveWorktreeActions(session, { ghAvailable: ctx.ghAvailable, working: ctx.working });
  const items: SessionMenuItem[] = [];
  let mergeItem: SessionMenuItem | undefined;
  if (ctx.dirtyCount > 0) {
    items.push({
      id: "commit",
      label: tr("sessionMenu.commit", "Commit {count} changes…", { count: ctx.dirtyCount }),
      icon: mdiSourceCommit,
      tone: "caution",
      onSelect: () => actions.openDialog("commit"),
    });
  }
  if (session.gitBranch) {
    items.push({ id: "switch-branch", label: tr("sessionMenu.switchBranch", "Switch branch…"), icon: mdiSourceBranch, onSelect: () => actions.openDialog("switch-branch") });
  }
  if (!wt) return { items };
  const blocked = (b: boolean) => (b ? { disabled: true, reason: STREAMING() } : {});
  if (wt.push) items.push({ id: "push", label: tr("worktree.push", "Push"), icon: mdiArrowUpBoldOutline, onSelect: actions.push, ...blocked(wt.push.blocked) });
  if (wt.openPr) items.push({ id: "open-pr", label: tr("worktree.openPr", "Open PR"), icon: mdiSourcePull, tone: "create", onSelect: actions.openPr, ...blocked(wt.openPr.blocked) });
  // A PR with no known URL has nothing to open (the card shows plain `#N` text), so no dead item.
  const prUrl = wt.hasPr ? (session.gitPrUrl ?? undefined) : undefined;
  if (prUrl) {
    items.push({
      id: "view-pr",
      label: tr("sessionMenu.viewPr", "View PR #{number}", { number: session.gitPrNumber ?? 0 }),
      icon: mdiSourcePull,
      onSelect: () => actions.openUrl(prUrl),
    });
  }
  if (wt.merge) {
    mergeItem = { id: "merge", label: tr("worktree.merge", "Merge"), icon: mdiSourceMerge, tone: "go", onSelect: () => actions.openDialog("merge"), ...blocked(wt.merge.blocked) };
  }
  items.push({ id: "close-worktree", label: tr("sessionMenu.closeWorktree", "Close worktree…"), icon: mdiCloseBoxOutline, tone: "danger", onSelect: () => actions.openDialog("close-worktree"), rare: true });
  return { items, mergeItem };
}

/** Disabled-with-reason props shared by the session-level items. */
const goneProps = (gone: boolean) => (gone ? { disabled: true, reason: CWD_MISSING() } : { disabled: false });

/** Resume (ended / hidden) and Fork — local sessions with a transcript only. */
function resumeItems(session: DashboardSession, ctx: SessionMenuCtx, isEnded: boolean): SessionMenuItem[] {
  const { actions } = ctx;
  if (!actions.resume || !session.sessionFile || isRemoteOrigin(session) || isAcpSession(session)) return [];
  const gone = session.cwdMissing === true;
  const blocked = { ...goneProps(gone), disabled: session.resuming === true || gone };
  const items: SessionMenuItem[] = [];
  if (isEnded || ctx.isHidden) {
    items.push({ id: "resume", label: tr("session.resume", "Resume"), icon: mdiPlayCircleOutline, tone: "go", onSelect: () => actions.resume?.("continue"), ...blocked });
  }
  items.push({ id: "fork", label: tr("session.fork", "Fork"), icon: mdiSourceFork, tone: "create", onSelect: () => actions.resume?.("fork"), ...blocked });
  return items;
}

/** New session and New worktree session (gated by the `spawn` card section). */
function spawnItems(session: DashboardSession, ctx: SessionMenuCtx): SessionMenuItem[] {
  const { actions } = ctx;
  if (!ctx.showSpawn) return [];
  const gone = goneProps(session.cwdMissing === true);
  const items: SessionMenuItem[] = [];
  if (actions.spawnSibling) {
    items.push({ id: "spawn-sibling", testId: "session-card-spawn-sibling", label: tr("sessionMenu.newSession", "New session"), icon: mdiPlus, tone: "go", onSelect: actions.spawnSibling, ...gone });
  }
  if (actions.spawnWorktree && !session.gitWorktree && session.isGitRepo !== false) {
    items.push({
      id: "spawn-worktree",
      testId: "session-card-spawn-worktree",
      label: tr("sessionMenu.newWorktreeSession", "New worktree session"),
      icon: mdiSourceBranchPlus,
      tone: "caution",
      onSelect: actions.spawnWorktree,
      ...gone,
    });
  }
  return items;
}

function buildSession(session: DashboardSession, ctx: SessionMenuCtx, isEnded: boolean): SessionMenuItem[] {
  const { actions } = ctx;
  const items = [...resumeItems(session, ctx, isEnded), ...spawnItems(session, ctx)];
  if (ctx.canRename && actions.rename) {
    items.push({ id: "rename", label: tr("sessionMenu.rename", "Rename…"), icon: mdiPencilOutline, onSelect: actions.rename });
  }
  if (ctx.canArchive && actions.archiveSession) {
    items.push({ id: "archive-session", label: tr("session.archiveSession", "Archive session"), icon: mdiArchiveOutline, onSelect: actions.archiveSession });
  }
  if (!isEnded && ctx.canExit && actions.exit) {
    items.push({
      id: "exit",
      label: tr("session.exitPiSession", "Exit pi session"),
      icon: mdiCloseCircleOutline,
      tone: "danger",
      onSelect: actions.exit,
      disabled: session.closing === true,
      reason: session.closing ? tr("session.closing", "Closing…") : undefined,
    });
  }
  return items;
}

export function deriveSessionMenu(session: DashboardSession, ctx: SessionMenuCtx): SessionMenuGroup[] {
  const { actions } = ctx;
  const isEnded = session.status === "ended";
  const openspec = buildOpenSpec(session, ctx, isEnded);
  const git = buildGit(session, ctx);

  // NEXT — exactly one emphasised item: Merge when its emphasis rule holds (the
  // OpenSpec primary then stays in OPENSPEC, un-emphasised), else the OpenSpec primary.
  let next: SessionMenuItem | undefined;
  let mergeItem = git.mergeItem;
  if (ctx.mergeIsPrimary && mergeItem) {
    next = { ...mergeItem, tone: undefined, emphasis: !mergeItem.disabled };
    mergeItem = undefined;
  } else if (openspec.primary) {
    next = { ...openspec.primary, tone: undefined, emphasis: !openspec.primary.disabled };
    openspec.items.splice(openspec.items.indexOf(openspec.primary), 1);
  }
  if (mergeItem) {
    // Merge sits right before Close worktree… in the worktree actions.
    const closeIdx = git.items.findIndex((i) => i.id === "close-worktree");
    git.items.splice(closeIdx < 0 ? git.items.length : closeIdx, 0, mergeItem);
  }

  const viewItems: SessionMenuItem[] = [
    { id: "card-sections", label: tr("sessionMenu.cardSections", "Card sections…"), icon: mdiCardsOutline, onSelect: actions.openCardSections },
    { id: "card-defaults", label: tr("sessionMenu.cardDefaults", "Card section defaults…"), icon: mdiTune, onSelect: actions.openCardDefaults },
  ];
  const groups: SessionMenuGroup[] = [
    { id: "next", title: tr("sessionMenu.groupNext", "Next"), items: next ? [next] : [] },
    { id: "session", title: tr("sessionMenu.groupSession", "Session"), items: buildSession(session, ctx, isEnded) },
    { id: "openspec", title: tr("sessionMenu.groupOpenspec", "OpenSpec"), subtitle: openspec.subtitle, items: openspec.items },
    { id: "git", title: tr("sessionMenu.groupGit", "Git"), subtitle: session.gitBranch ?? undefined, items: git.items },
    { id: "view", title: tr("sessionMenu.groupView", "View"), items: viewItems },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Split a group's items into the always-visible ones and those folded behind
 * `More…`. Folding applies only with ≥ 2 rare items; exactly one stays inline.
 */
export function partitionRare(items: readonly SessionMenuItem[]): { inline: SessionMenuItem[]; hidden: SessionMenuItem[] } {
  const rare = items.filter((i) => i.rare);
  if (rare.length < 2) return { inline: [...items], hidden: [] };
  return { inline: items.filter((i) => !i.rare), hidden: rare };
}
