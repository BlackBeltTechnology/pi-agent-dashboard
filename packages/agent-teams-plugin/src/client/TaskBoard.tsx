/**
 * TaskBoard — read-only task lists: Pending · In progress · Completed (design D10).
 * Wide viewports stack the three sections; below `lg` the decided mock's GROUPED
 * LIST is used (collapsible groups with counts, Completed folded by default). Cards
 * show id, title, owner chip, `blocked` text marker (the SERVER flag decides),
 * dependency chips ("waits for #2 — pending", "#9 — missing" for a dangling id) and
 * a disclosure for description/result that mounts its text only while open. Open
 * disclosures and folded groups are keyed by stable task id / status, so a refetch
 * or a task moving sections keeps them. No drag-and-drop, no editing. Peer text is
 * plain React text. Cards are memoised by value.
 * See change: add-agent-teams-ui (design D10, D11; tasks 8.4, 13.15–13.16, 13.37).
 */
import { SettingsStatusPill } from "@blackbelt-technology/dashboard-plugin-runtime";
import { memo, type ReactElement, useCallback, useEffect, useId, useRef, useState } from "react";
import type { SnapshotTask } from "../shared/snapshot.js";
import type { TeamUiSnapshot } from "../shared/ui-protocol.js";
import { TASK_BLOCKED, taskStatusEntry } from "./status-map.js";
import { CHIP, Empty, LINKBTN, SECTION_H, TEXT, useViewT } from "./view-kit.js";

const SECTIONS = ["pending", "in_progress", "completed"] as const;
type Section = (typeof SECTIONS)[number];
type Translate = ReturnType<typeof useViewT>;

/** `true` below the host's `lg` breakpoint (1 024 px); `false` when `matchMedia` is unavailable. */
function useNarrow(): boolean {
  const query = "(max-width: 1023.98px)";
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

interface Dep {
  text: string;
  open: boolean;
}

function depsOf(t: Translate, snap: TeamUiSnapshot, task: SnapshotTask): Dep[] {
  return task.blockedBy.map((id) => {
    const dep = snap.tasks.find((x) => x.id === id);
    if (!dep) return { text: t("tasks.waitsMissing", { id }), open: true };
    if (dep.status === "completed") return { text: t("tasks.depDone", { id }), open: false };
    return { text: t("tasks.waitsFor", { id, status: t(taskStatusEntry(dep.status).textKey).toLowerCase() }), open: true };
  });
}

export interface CardProps {
  task: SnapshotTask;
  deps: Dep[];
  /** All dependencies resolved to completed tasks. */
  depsDone: boolean;
  open: boolean;
  onToggle: (id: string) => void;
}

const depSig = (d: Dep[]): string => d.map((x) => `${x.open ? 1 : 0}${x.text}`).join("\u0000");
const sameTask = (a: SnapshotTask, b: SnapshotTask): boolean =>
  a.id === b.id && a.title === b.title && a.status === b.status && a.owner === b.owner && a.blocked === b.blocked && a.description === b.description && a.result === b.result && a.note === b.note;

/** Memo gate of a card: by value (a refetch replaces every object). */
export function sameTaskCard(a: CardProps, b: CardProps): boolean {
  return sameTask(a.task, b.task) && a.open === b.open && a.depsDone === b.depsDone && a.onToggle === b.onToggle && depSig(a.deps) === depSig(b.deps);
}

const TaskCard = memo(
  function TaskCard({ task, deps, depsDone, open, onToggle }: CardProps): ReactElement {
    const t = useViewT();
    const uid = useId();
    const panel = `${uid}-details`;
    return (
      <li id={`team-task-${task.id}`} tabIndex={-1} data-testid="team-task-card" data-task={task.id} className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-2">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">#{task.id}</span>
          <span className={`${TEXT} min-w-0 grow basis-[10ch] text-[12px] font-semibold text-[var(--text-primary)]`}>{task.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={CHIP} data-testid="team-task-owner">
            {task.owner ?? t("tasks.unassigned")}
          </span>
          {task.blocked ? (
            <SettingsStatusPill tone="warning" icon={null} status="blocked" testId="team-task-blocked">
              <span aria-hidden="true">{TASK_BLOCKED.glyph}</span>
              {t(TASK_BLOCKED.textKey)}
            </SettingsStatusPill>
          ) : null}
          {deps.map((d) => (
            <span key={d.text} data-testid="team-task-dep" className={`${CHIP} ${d.open ? "border-[var(--severity-warning-border)]" : ""}`}>
              {d.text}
            </span>
          ))}
          {task.status === "pending" && deps.length > 0 && !task.blocked && depsDone ? (
            <span className={CHIP} data-testid="team-task-unblocked">
              {t("tasks.unblocked")}
            </span>
          ) : null}
        </div>
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => onToggle(task.id)} className={`${LINKBTN} mt-0.5 font-semibold`} data-testid="team-task-toggle">
          {open ? t("tasks.hideDetails") : t("tasks.showDetails")}
        </button>
        {open ? (
          <div id={panel} className="mt-1 space-y-1.5 border-l-2 border-[var(--border-secondary)] pl-2 text-[12px] text-[var(--text-primary)]" data-testid="team-task-details">
            <div>
              <div className="text-[11px] font-semibold text-[var(--text-secondary)]">{t("tasks.description")}</div>
              <p tabIndex={0} className={`${TEXT} focus-ring max-h-[30vh] overflow-y-auto`}>
                {task.description === "" ? t("tasks.noDescription") : task.description}
              </p>
            </div>
            {task.result ? (
              <div>
                <div className="text-[11px] font-semibold text-[var(--text-secondary)]">{t("tasks.result")}</div>
                <p tabIndex={0} className={`${TEXT} focus-ring max-h-[30vh] overflow-y-auto`}>
                  {task.result}
                </p>
              </div>
            ) : null}
            {task.note ? <p className={`${TEXT} text-[11px] text-[var(--text-secondary)]`}>{t("tasks.note", { note: task.note })}</p> : null}
          </div>
        ) : (
          <span id={panel} hidden />
        )}
      </li>
    );
  },
  sameTaskCard,
);

export interface TaskBoardProps {
  snap: TeamUiSnapshot;
  /** Show only the tasks this member owns ("+N more" from the members table). */
  ownerFilter?: string;
  onClearFilter?: () => void;
  /** Focus request: scroll to the card, unfold its group. Re-sent with a new `nonce`. */
  focus?: { id: string; nonce: number };
  /** Test seam: force the layout (default: `lg` media query). */
  narrow?: boolean;
}

export function TaskBoard({ snap, ownerFilter, onClearFilter, focus, narrow: forceNarrow }: TaskBoardProps): ReactElement {
  const t = useViewT();
  const mediaNarrow = useNarrow();
  const narrow = forceNarrow ?? mediaNarrow;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [unfolded, setUnfolded] = useState<ReadonlySet<Section>>(new Set(["pending", "in_progress"]));
  const toggle = useCallback((id: string): void => {
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const focused = useRef(-1);
  useEffect(() => {
    if (!focus || focused.current === focus.nonce) return;
    const task = snap.tasks.find((x) => x.id === focus.id);
    if (!task) return;
    focused.current = focus.nonce;
    setUnfolded((s) => (s.has(task.status as Section) ? s : new Set(s).add(task.status as Section)));
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 0);
    raf(() => {
      const el = document.getElementById(`team-task-${focus.id}`);
      el?.focus();
      if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    });
  }, [focus, snap.tasks]);

  if (snap.tasks.length === 0) return <Empty testId="team-tasks-empty" title={t("tasks.empty.title")} hint={t("tasks.empty.hint")} />;

  const visible = ownerFilter === undefined ? snap.tasks : snap.tasks.filter((x) => x.owner === ownerFilter);
  const list = (status: Section): SnapshotTask[] => visible.filter((x) => x.status === status);
  const cards = (status: Section): ReactElement => {
    const items = list(status);
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t(`tasks.section.${status}`)}>
        {items.map((task) => {
          const deps = depsOf(t, snap, task);
          const depsDone = task.blockedBy.every((id) => snap.tasks.find((x) => x.id === id)?.status === "completed");
          return <TaskCard key={task.id} task={task} deps={deps} depsDone={depsDone} open={open.has(task.id)} onToggle={toggle} />;
        })}
        {items.length === 0 ? (
          <li data-testid="team-tasks-section-empty" className="rounded-lg border border-dashed border-[var(--border-secondary)] p-2 text-[12px] text-[var(--text-secondary)]">
            {t("tasks.none")}
          </li>
        ) : null}
      </ul>
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid="team-board" data-layout={narrow ? "grouped" : "stack"}>
      {ownerFilter !== undefined ? (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-primary)]" data-testid="team-board-filter">
          <span className={TEXT}>{t("tasks.filtered", { name: ownerFilter })}</span>
          <button type="button" className={`${LINKBTN} font-semibold`} onClick={onClearFilter}>
            {t("tasks.clearFilter")}
          </button>
        </p>
      ) : null}
      {SECTIONS.map((status) => {
        const count = list(status).length;
        const headId = `team-board-${status}`;
        if (!narrow) {
          return (
            <section key={status} aria-labelledby={headId} data-testid={`team-board-section-${status}`} className="flex flex-col gap-2">
              <h3 id={headId} className={`${SECTION_H} flex items-center gap-1.5`}>
                {t(`tasks.section.${status}`)}
                <span className={CHIP} data-testid="team-board-count">
                  {count}
                </span>
              </h3>
              {cards(status)}
            </section>
          );
        }
        const isOpen = unfolded.has(status);
        return (
          <section key={status} aria-labelledby={headId} data-testid={`team-board-section-${status}`} className="rounded-lg border border-[var(--border-secondary)]">
            <h3 id={headId} className="m-0">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`${headId}-body`}
                onClick={() =>
                  setUnfolded((s) => {
                    const next = new Set(s);
                    if (!next.delete(status)) next.add(status);
                    return next;
                  })
                }
                className="focus-ring flex w-full min-h-[44px] items-center gap-2 rounded-lg px-2 text-left text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <span aria-hidden="true" className="text-[var(--text-secondary)]">
                  {isOpen ? "▾" : "▸"}
                </span>
                {t(`tasks.section.${status}`)}
                <span className={CHIP} data-testid="team-board-count">
                  {count}
                </span>
              </button>
            </h3>
            <div id={`${headId}-body`} hidden={!isOpen} className="px-2 pb-2">
              {isOpen ? cards(status) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
