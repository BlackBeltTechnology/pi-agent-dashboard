import React from "react";
import { Icon } from "@mdi/react";
import {
  mdiCompassOutline,
  mdiPlay,
  mdiArchiveOutline,
  mdiCheck,
} from "@mdi/js";
import type { OpenSpecChange, OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * OpenSpec workflow stepper — 7 nodes (Explore → Proposal → Design → Specs →
 * Tasks → Apply → Archive) joined by short progress lines.
 *
 * Pure presentational component; node states derive in `deriveStepperState`
 * from `(attached, artifacts, completedTasks, totalTasks, changeState)`.
 *
 * See change: redesign-session-card-and-composer.
 */

export type NodeState = "done" | "current" | "todo" | "disabled";
export type NodeId = "explore" | "proposal" | "design" | "specs" | "tasks" | "apply" | "archive";

export interface DeriveStepperInput {
  attached: string | null;
  artifacts: OpenSpecArtifact[];
  completedTasks: number;
  totalTasks: number;
  changeState: ChangeState | null;
  /** Whether any OpenSpecChange exists in the cwd (any active proposal). */
  hasAnyChanges: boolean;
}

export type StepperStateMap = Record<NodeId, NodeState>;

export function deriveStepperState(input: DeriveStepperInput): StepperStateMap {
  const { attached, artifacts, completedTasks, totalTasks, changeState, hasAnyChanges } = input;

  // Explore
  let explore: NodeState;
  if (attached) explore = "disabled";
  else if (hasAnyChanges) explore = "done";
  else explore = "current";

  function artifactState(id: NodeId): NodeState {
    const a = artifacts.find((x) => x.id === id);
    if (!a) return "todo";
    if (a.status === "done") return "done";
    if (a.status === "ready") return "current";
    return "todo";
  }
  const proposal = artifactState("proposal");
  const design = artifactState("design");
  const specs = artifactState("specs");

  // Tasks
  let tasks: NodeState;
  if (totalTasks > 0 && completedTasks === totalTasks) tasks = "done";
  else if (completedTasks < totalTasks && changeState === ChangeState.IMPLEMENTING) tasks = "current";
  else tasks = "todo";

  // Apply
  let apply: NodeState;
  if (changeState === ChangeState.COMPLETE && totalTasks > 0 && completedTasks === totalTasks) apply = "done";
  else if (changeState === ChangeState.READY || changeState === ChangeState.IMPLEMENTING) apply = "current";
  else apply = "todo";

  // Archive
  let archive: NodeState;
  if (!attached) archive = "disabled";
  else if (changeState === ChangeState.COMPLETE) archive = "current";
  else archive = "todo";

  return { explore, proposal, design, specs, tasks, apply, archive };
}

interface NodeDef {
  id: NodeId;
  label: string;
  /** Letter to render (artifact nodes) — has priority over icon when state !== done. */
  letter?: string;
  /** Icon to render for non-letter nodes. */
  icon?: string;
}

const NODE_ORDER: NodeDef[] = [
  { id: "explore", label: "Explore", icon: mdiCompassOutline },
  { id: "proposal", label: "Proposal", letter: "P" },
  { id: "design", label: "Design", letter: "D" },
  { id: "specs", label: "Specs", letter: "S" },
  { id: "tasks", label: "Tasks", letter: "T" },
  { id: "apply", label: "Apply", icon: mdiPlay },
  { id: "archive", label: "Archive", icon: mdiArchiveOutline },
];

interface StepperProps {
  variant?: "sidebar" | "compact";
  change?: OpenSpecChange | null;
  attached: string | null;
  /** Whether the cwd has any OpenSpecChanges (drives Explore done-state). */
  hasAnyChanges?: boolean;
  /**
   * Click handler for artifact nodes (Proposal, Design, Specs) and Tasks.
   * When provided, the corresponding nodes become buttons that open the
   * artifact preview (or task list). See change:
   * redesign-session-card-and-composer (stepper-click-to-open).
   */
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  /** Optional Tasks-node click — opens the TasksPopover. */
  onOpenTasks?: () => void;
}

export function OpenSpecStepper({ variant = "sidebar", change, attached, hasAnyChanges = false, onReadArtifact, onOpenTasks }: StepperProps) {
  const artifacts = change?.artifacts ?? [];
  const completedTasks = change?.completedTasks ?? 0;
  const totalTasks = change?.totalTasks ?? 0;
  const changeState = change ? deriveChangeState(change) : null;

  const states = deriveStepperState({
    attached,
    artifacts,
    completedTasks,
    totalTasks,
    changeState,
    hasAnyChanges,
  });

  const isCompact = variant === "compact";
  const nodeSize = isCompact ? 18 : 22;

  return (
    <div
      className="flex items-stretch w-full"
      data-testid="openspec-stepper"
      data-variant={variant}
      style={isCompact ? { transform: "scale(0.92)", transformOrigin: "left center" } : undefined}
    >
      {NODE_ORDER.map((node, idx) => {
        const state = states[node.id];
        const prev = idx > 0 ? states[NODE_ORDER[idx - 1]!.id] : undefined;
        const lineActive = prev && (prev === "done" || prev === "current") && (state === "done" || state === "current");
        const isFirst = idx === 0;

        // Click handlers — only artifact + tasks nodes are interactive.
        let onClick: (() => void) | undefined;
        if (change?.name) {
          if (node.id === "proposal" || node.id === "design" || node.id === "specs") {
            onClick = onReadArtifact ? () => onReadArtifact(change.name, node.id) : undefined;
          } else if (node.id === "tasks") {
            onClick = onOpenTasks;
          }
        }

        return (
          <StepperNode
            key={node.id}
            node={node}
            state={state}
            nodeSize={nodeSize}
            variant={variant}
            isFirst={isFirst}
            lineActive={!!lineActive}
            onClick={onClick}
            taskSub={node.id === "tasks" && totalTasks > 0 ? `${completedTasks}/${totalTasks}` : undefined}
          />
        );
      })}
    </div>
  );
}

function StepperNode({
  node,
  state,
  nodeSize,
  variant,
  isFirst,
  lineActive,
  onClick,
  taskSub,
}: {
  node: NodeDef;
  state: NodeState;
  nodeSize: number;
  variant: "sidebar" | "compact";
  isFirst: boolean;
  lineActive: boolean;
  onClick?: () => void;
  taskSub?: string;
}) {
  const isCompact = variant === "compact";
  const showLabel = !isCompact;

  // State-dependent border + text colors.
  const colorClass =
    state === "done" ? "border-green-500 text-green-400"
    : state === "current" ? "border-orange-400 text-orange-400"
    : state === "disabled" ? "border-[var(--border-secondary)] text-[var(--text-muted)] opacity-40"
    : "border-[var(--border-secondary)] text-[var(--text-muted)]";

  // For done/current nodes the spec calls for an inner tint stacked over the
  // opaque base. We layer the tint via inline style (semi-transparent gradient)
  // while keeping the opaque base from the class.
  const tintStyle: React.CSSProperties = state === "done"
    ? { backgroundImage: "linear-gradient(rgba(74,222,128,0.18), rgba(74,222,128,0.18))" }
    : state === "current"
    ? { backgroundImage: "linear-gradient(rgba(251,146,60,0.18), rgba(251,146,60,0.18))" }
    : {};

  const renderContent = () => {
    // Done artifact nodes show the check (per design.md §6); todo/current keep
    // the artifact letter so the workflow position remains readable.
    if (state === "done" && (node.id === "explore" || node.id === "apply" || node.id === "archive" || node.letter)) {
      return <Icon path={mdiCheck} size={isCompact ? 0.42 : 0.5} />;
    }
    if (node.letter) {
      return <span className="font-bold leading-none">{node.letter}</span>;
    }
    if (node.icon) {
      return <Icon path={node.icon} size={isCompact ? 0.45 : 0.55} />;
    }
    return null;
  };

  const clickable = !!onClick && state !== "disabled";
  const Wrapper = clickable ? "button" : "div";
  // Hover feedback applies ONLY to the inner node circle (via `group-hover`)
  // so the opaque-base background never goes semi-transparent and the
  // connecting line can't bleed through. Previous `hover:opacity-80` on the
  // wrapper hit the node too — visible green line inside circle on hover.
  return (
    <Wrapper
      type={clickable ? "button" : undefined as any}
      onClick={clickable ? (e: React.MouseEvent) => { e.stopPropagation(); onClick!(); } : undefined}
      className={`group flex-1 min-w-0 flex flex-col items-center gap-1 relative bg-transparent border-0 p-0 ${clickable ? "cursor-pointer" : ""}`}
      data-testid={`stepper-node-${node.id}`}
      data-state={state}
      data-clickable={clickable ? "true" : undefined}
      title={isCompact ? node.label : undefined}
    >
      {/* Connecting line from previous node — drawn behind the circle */}
      {!isFirst && (
        <span
          aria-hidden="true"
          className="absolute left-[-50%] right-1/2 top-[10px] h-[2px]"
          style={{
            backgroundColor: lineActive ? "var(--accent-green)" : "var(--border-secondary)",
            zIndex: 0,
          }}
        />
      )}
      <span
        className={`openspec-stepper-node-base inline-flex items-center justify-center rounded-full border-2 relative z-[2] ${colorClass} ${state === "current" ? "openspec-stepper-node-current" : ""} ${clickable ? "group-hover:scale-110 transition-transform" : ""}`}
        style={{ width: nodeSize, height: nodeSize, fontSize: isCompact ? 8 : 10, ...tintStyle }}
      >
        {renderContent()}
      </span>
      {showLabel && (
        <>
          <span
            className={`text-[9px] uppercase tracking-wide text-center leading-none ${
              state === "current" ? "text-orange-400 font-semibold"
              : state === "done" ? "text-green-400"
              : "text-[var(--text-tertiary)]"
            }`}
            style={{ maxWidth: 60 }}
          >
            {node.label}
          </span>
          {taskSub && (
            <sub className="text-[9px] text-[var(--text-muted)] leading-none mt-px" style={{ verticalAlign: "baseline" }}>
              {taskSub}
            </sub>
          )}
        </>
      )}
    </Wrapper>
  );
}
