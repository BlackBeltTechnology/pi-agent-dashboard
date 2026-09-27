import { statusAriaLabel, statusPresentation } from "@blackbelt-technology/pi-dashboard-client-utils/statusPresentation";
import type { OpenSpecArtifact, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useI18n } from "../../lib/i18n/i18n.js";

/**
 * OpenSpec lifecycle bar — 5 segments (Proposal · Design · Specs · Tasks ·
 * Archive). Each segment is a 6 px track + label; interactive segments are
 * `<button>`s (≥24 px hit row), inert ones plain `<div>`s (out of tab order).
 *
 * Segment states derive in `deriveStepperState` — shared with the composer
 * `ArtifactChip`s so the two never drift. The Tasks segment absorbs the old
 * Apply node and fills by `completedTasks/totalTasks`.
 *
 * See change: compact-openspec-lifecycle-bar (supersedes the 7-node stepper
 * of redesign-session-card-and-composer).
 */

export type SegmentState = "done" | "current" | "todo" | "skipped";
export type SegmentId = "proposal" | "design" | "specs" | "tasks" | "archive";

export interface DeriveStepperInput {
  artifacts: OpenSpecArtifact[];
  completedTasks: number;
  totalTasks: number;
  changeState: ChangeState | null;
}

export type StepperStateMap = Record<SegmentId, SegmentState>;

export function deriveStepperState(input: DeriveStepperInput): StepperStateMap {
  const { artifacts, changeState } = input;

  function artifactState(id: SegmentId): SegmentState {
    const a = artifacts.find((x) => x.id === id);
    if (!a) return "todo";
    if (a.status === "done") return "done";
    // `skip_specs` changes: satisfied declaration of absence, rendered distinctly.
    if (a.status === "skipped") return "skipped";
    if (a.status === "ready") return "current";
    return "todo";
  }

  // Tasks absorbs Apply: active through READY/IMPLEMENTING regardless of the
  // ticked count (an all-ticked IMPLEMENTING change still needs a current step).
  let tasks: SegmentState = "todo";
  if (changeState === ChangeState.COMPLETE) tasks = "done";
  else if (changeState === ChangeState.READY || changeState === ChangeState.IMPLEMENTING) tasks = "current";

  return {
    proposal: artifactState("proposal"),
    design: artifactState("design"),
    specs: artifactState("specs"),
    tasks,
    archive: changeState === ChangeState.COMPLETE ? "current" : "todo",
  };
}

const SEGMENTS: Array<{ id: SegmentId; label: string; letter: string }> = [
  { id: "proposal", label: "Proposal", letter: "P" },
  { id: "design", label: "Design", letter: "D" },
  { id: "specs", label: "Specs", letter: "S" },
  { id: "tasks", label: "Tasks", letter: "T" },
  { id: "archive", label: "Archive", letter: "A" },
];

/** `skipped` reuses `done`'s token (no new StatusKind) plus its own glyph. */
function presentation(state: SegmentState): { tokenVar: string; glyph: string; label: string } {
  if (state === "skipped") return { ...statusPresentation("done"), glyph: "–", label: "skipped" };
  return statusPresentation(state);
}

interface StepperProps {
  /** `compact` (board) never renders actions of its own; the caller omits handlers. */
  variant?: "sidebar" | "compact";
  change?: OpenSpecChange | null;
  /** Makes Proposal/Design/Specs interactive (artifact preview). */
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  /** Makes Tasks interactive (TasksPopover) when `totalTasks > 0`. */
  onOpenTasks?: () => void;
  /** Makes Archive interactive. Caller passes it only when archiving is allowed. */
  onArchive?: () => void;
}

export function OpenSpecStepper({ variant = "sidebar", change, onReadArtifact, onOpenTasks, onArchive }: StepperProps) {
  const { t } = useI18n();
  const completedTasks = change?.completedTasks ?? 0;
  const totalTasks = change?.totalTasks ?? 0;
  const states = deriveStepperState({
    artifacts: change?.artifacts ?? [],
    completedTasks,
    totalTasks,
    changeState: change ? deriveChangeState(change) : null,
  });

  return (
    <div
      role="group"
      aria-label={t("openspec.lifecycle", undefined, "OpenSpec lifecycle")}
      className="openspec-lifecycle-bar"
      data-testid="openspec-stepper"
      data-variant={variant}
    >
      {SEGMENTS.map((seg) => {
        const state = states[seg.id];
        const name = t(`openspec.node.${seg.id}`, undefined, seg.label);
        const pres = presentation(state);
        const isTasks = seg.id === "tasks";

        let onClick: (() => void) | undefined;
        if (change?.name && (seg.id === "proposal" || seg.id === "design" || seg.id === "specs") && onReadArtifact) {
          onClick = () => onReadArtifact(change.name, seg.id);
        } else if (isTasks && totalTasks > 0) {
          onClick = onOpenTasks;
        } else if (seg.id === "archive") {
          onClick = onArchive;
        }

        const count = totalTasks > 0 ? `${completedTasks}/${totalTasks}` : "—";
        const ariaLabel = isTasks
          ? totalTasks > 0
            ? t("openspec.segment.tasksCount", { done: completedTasks, total: totalTasks }, `Tasks ${completedTasks} of ${totalTasks} done`)
            : t("openspec.segment.noTasks", undefined, "Tasks, none yet")
          : statusAriaLabel(name, state === "skipped" ? "done" : state, t(`openspec.segmentState.${state}`, undefined, pres.label));
        const fillPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const segStyle = { "--seg-color": pres.tokenVar } as React.CSSProperties;

        const content = (
          <>
            <span className="openspec-seg-track" aria-hidden="true">
              {isTasks && totalTasks > 0 && (
                <span className="openspec-seg-fill" data-testid="stepper-tasks-fill" style={{ width: `${fillPct}%` }} />
              )}
            </span>
            <span className="openspec-seg-label" aria-hidden="true">
              {isTasks ? (
                <>
                  <span className="openspec-seg-full">{name} </span>
                  <span className="openspec-seg-count">{count}</span>
                </>
              ) : (
                <>
                  {state === "done" || state === "skipped" ? `${pres.glyph} ` : ""}
                  <span className="openspec-seg-full">{name}</span>
                  <span className="openspec-seg-short">{seg.letter}</span>
                </>
              )}
            </span>
          </>
        );

        const common = {
          className: `openspec-seg${isTasks ? " openspec-seg-tasks" : ""}`,
          "data-testid": `stepper-segment-${seg.id}`,
          "data-state": state,
          style: segStyle,
          title: ariaLabel,
        };

        if (!onClick) {
          return (
            <div key={seg.id} {...common} role="img" aria-label={ariaLabel} data-inert="true">
              {content}
            </div>
          );
        }
        const handler = onClick;
        return (
          <button
            key={seg.id}
            type="button"
            {...common}
            aria-label={ariaLabel}
            onClick={(e) => { e.stopPropagation(); handler(); }}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
