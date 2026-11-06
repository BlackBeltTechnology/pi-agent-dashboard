/**
 * Step card renderer shared by the live panel's Agent cards section:
 *
 * - a fan-out step renders as ONE group card (header: name, `fan-out xN`,
 *   ok / failed pills) holding one `FlowAgentCard` per item;
 * - a decision step shows its chosen routes (with item counts) and a
 *   "not taken" chip per unchosen branch, or its route error;
 * - a skipped step carries a `skipped` pill and a dimmed card.
 *
 * Pills are the one ui-contract status pill (`SettingsStatusPill`), so state
 * is never colour-only. Approved mock: mockups/2026-11-04-flows-plugin-update
 * frame 1. See change: update-flows-plugin (D6, task 4.5).
 */
import { SettingsStatusPill, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React from "react";
import type { FlowAgentState, FlowState } from "../types.js";
import { FlowAgentCard } from "./FlowAgentCard.js";
import { FLOW_CARD_GRID_CLASS, FLOW_CARD_GRID_CONTAINER_CLASS } from "./flow-card-grid.js";

interface CardCommon {
  session?: Pick<DashboardSession, "uiDecorators">;
  sessionId?: string;
  selectedStepId: string | null;
  onSelect: (stepId: string) => void;
}

/** Branch labels of a decision step that were not chosen. */
function notTakenLabels(state: FlowState, stepId: string): string[] {
  const d = state.decisions?.[stepId];
  if (!d || d.routeError) return [];
  const branches = state.dagSteps?.find((s) => s.id === stepId)?.branches ?? {};
  const chosen = new Set((d.routes ?? []).map((r) => r.branch));
  return Object.keys(branches).filter((label) => !chosen.has(label));
}

function DecisionRoutes({ state, stepId }: { state: FlowState; stepId: string }) {
  const t = useT();
  const d = state.decisions?.[stepId];
  if (!d) return null;
  if (d.routeError) {
    return (
      <div data-testid="flow-decision-error" className="flex flex-wrap gap-1 px-1">
        <SettingsStatusPill tone="error">{d.routeError}</SettingsStatusPill>
      </div>
    );
  }
  return (
    <div data-testid="flow-decision-routes" className="flex flex-wrap gap-1 px-1">
      {(d.routes ?? []).map((r) => (
        <SettingsStatusPill key={r.branch} tone="success">
          {r.itemCount !== undefined ? `${r.branch} x${r.itemCount}` : r.branch}
        </SettingsStatusPill>
      ))}
      {notTakenLabels(state, stepId).map((label) => (
        <SettingsStatusPill key={label} tone="neutral">
          {t("routeNotTaken", { label }, `${label}: not taken`)}
        </SettingsStatusPill>
      ))}
    </div>
  );
}

function GroupCard({
  parent,
  items,
  state,
  ...common
}: CardCommon & { parent: FlowAgentState; items: FlowAgentState[]; state: FlowState }) {
  const t = useT();
  const stepId = parent.stepId || parent.agentName;
  const present = items.filter(Boolean);
  const total = Math.max(present.length, parent.itemCount ?? 0);
  const ok = present.filter((i) => i.status === "complete").length;
  const failed = present.filter((i) => i.status === "error").length;
  const selected = common.selectedStepId === stepId;
  return (
    <div
      data-step={stepId}
      data-testid="flow-group-card"
      className={`col-span-full rounded-xl border p-2 flex flex-col gap-2 ${
        selected ? "border-[var(--accent-primary)]" : "border-[var(--border-secondary)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          className="font-medium text-[var(--text-primary)] focus-ring rounded"
          onClick={() => common.onSelect(stepId)}
        >
          {parent.label || stepId}
        </button>
        <SettingsStatusPill tone="neutral">{t("fanOutCount", { n: total }, `fan-out x${total}`)}</SettingsStatusPill>
        <SettingsStatusPill tone="success">{t("itemsOk", { n: ok }, `${ok} ok`)}</SettingsStatusPill>
        {failed > 0 && <SettingsStatusPill tone="error">{t("itemsFailed", { n: failed }, `${failed} failed`)}</SettingsStatusPill>}
        {parent.status === "skipped" && <SettingsStatusPill tone="neutral">{t("stepSkipped", undefined, "skipped")}</SettingsStatusPill>}
      </div>
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {present.map((item) => (
          <div key={item.itemKey} data-item={item.itemKey}>
            <FlowAgentCard
              agent={{ ...item, label: item.label ?? item.itemKey }}
              session={common.session}
              sessionId={common.sessionId}
            />
          </div>
        ))}
      </div>
      <DecisionRoutes state={state} stepId={stepId} />
    </div>
  );
}

function StepCard({ agent, state, ...common }: CardCommon & { agent: FlowAgentState; state: FlowState }) {
  const t = useT();
  const stepId = agent.stepId || agent.agentName;
  const card = (
    <FlowAgentCard
      agent={agent}
      session={common.session}
      sessionId={common.sessionId}
      selected={common.selectedStepId === stepId}
      onSelect={common.onSelect}
    />
  );
  if (agent.status === "skipped") {
    return (
      <div data-testid="flow-skipped-card" className="relative">
        <div className="opacity-60">{card}</div>
        <span className="absolute top-1.5 right-1.5">
          <SettingsStatusPill tone="neutral">{t("stepSkipped", undefined, "skipped")}</SettingsStatusPill>
        </span>
      </div>
    );
  }
  if (state.decisions?.[stepId]) {
    return (
      <div className="flex flex-col gap-1">
        {card}
        <DecisionRoutes state={state} stepId={stepId} />
      </div>
    );
  }
  return card;
}

/** Every step card of `state`, in step order (a fan-out group is one entry). */
export function FlowStepCards({ state, agents, ...common }: CardCommon & { state: FlowState; agents: FlowAgentState[] }) {
  return (
    <div className={FLOW_CARD_GRID_CONTAINER_CLASS}>
      <div className={FLOW_CARD_GRID_CLASS}>
        {agents.map((agent) => {
          const stepId = agent.stepId || agent.agentName;
          const items = state.groups?.[stepId];
          if (items && (items.length > 0 || agent.itemCount !== undefined)) {
            return <GroupCard key={stepId} parent={agent} items={items} state={state} {...common} />;
          }
          return <StepCard key={stepId} agent={agent} state={state} {...common} />;
        })}
      </div>
    </div>
  );
}

/** Header summary of the Agent cards section: step count + state counts. */
export function stepStateCounts(agents: readonly FlowAgentState[]): {
  steps: number;
  done: number;
  running: number;
  failed: number;
  skipped: number;
} {
  return {
    steps: agents.length,
    done: agents.filter((a) => a.status === "complete").length,
    running: agents.filter((a) => a.status === "running").length,
    failed: agents.filter((a) => a.status === "error").length,
    skipped: agents.filter((a) => a.status === "skipped").length,
  };
}
