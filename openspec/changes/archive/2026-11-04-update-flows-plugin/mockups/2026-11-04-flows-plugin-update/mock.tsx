// Flows plugin update: pi-flows 0.10 (fan-out, multi-route decisions, skipped) + flows fully
// decoupled from core. Real flows-plugin components (FlowGraph, FlowAgentCard) + the REAL
// flow reducer drive both panes from one scripted pi-flows 0.10 run (scenario.ts):
//   Current  = today's path: core FLOW_EVENT_MAP forward -> reduceFlowEvent as-is.
//   Proposed = plugin-declared forward -> reducer extended for items / decisions / skipped.
// Step / Play advance BOTH panes (shared store). Abort / Auto show the command route.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { mdiChevronDown, mdiChevronRight, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { FlowDashboard } from "@flows/client/FlowDashboard.tsx";
import { SettingsStatusPill, UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FlowAgentState, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { reduceFlowEvent } from "@flows/flow-reducer.ts";
import { FlowAgentCard } from "@flows/client/FlowAgentCard.tsx";
import { FlowGraph, flowStateToGraphSteps, type FlowGraphStep } from "@flows/client/FlowGraph.tsx";
import { FLOW_CARD_GRID_CLASS, FLOW_CARD_GRID_CONTAINER_CLASS } from "@flows/client/flow-card-grid.ts";
import { Fix, Issue, type Mock } from "mock-site/kit";
import { SCENARIO, toEvent, type WireStep } from "./scenario.ts";

type Variant = "current" | "proposed";
type Cmd = "abort" | "autonomous";

// ---------------------------------------------------------------- shared player store
// Auto-play loop, no buttons: one event per tick, scripted user commands at fixed
// points, hold on the final state, then restart. One loop per document (each phone
// iframe runs its own). Reduced motion: show the final state, no loop.
const TICK_MS = 900;
const HOLD_TICKS = 5; // ticks to hold the finished run before restarting
const CMD_AT: Array<[number, Cmd]> = [[6, "autonomous"], [SCENARIO.length + 1, "abort"]];
const store = { cursor: 0, tick: 0, cmds: [] as Cmd[] };
const listeners = new Set<() => void>();
let snap = { ...store };
const emit = () => { snap = { ...store, cmds: [...store.cmds] }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
function advance() {
  store.tick++;
  if (store.tick > SCENARIO.length + HOLD_TICKS) { store.tick = 0; store.cursor = 0; store.cmds = []; emit(); return; }
  store.cursor = Math.min(store.tick, SCENARIO.length);
  for (const [at, c] of CMD_AT) if (store.tick === at) store.cmds = [...store.cmds, c];
  emit();
}
let started = false;
function usePlayer() {
  const s = useSyncExternalStore(subscribe, () => snap);
  useEffect(() => {
    if (started) return;
    started = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      store.tick = store.cursor = SCENARIO.length;
      store.cmds = CMD_AT.map(([, c]) => c);
      emit();
      return;
    }
    setInterval(advance, TICK_MS);
  }, []);
  return s;
}

// ---------------------------------------------------------------- wire routes
const CORE_MAPPED = new Set([
  "flow:flow-started", "flow:agent-started", "flow:agent-complete", "flow:agent-error", "flow:subagent-tool-call",
  "flow:subagent-tool-result", "flow:assistant-text", "flow:thinking-text", "flow:loop-iteration", "flow:auto-decision",
  "flow:complete", "flow:summary-started", "flow:summary-ready", "flow:summary-dismissed", "flow:autonomous-mode-changed",
]);
interface WireRow { step: WireStep; route: string; dropped?: boolean }

const COMMAND_ROUTES: Record<Variant, Record<Cmd, string[]>> = {
  current: {
    abort: [
      "browser -> server  flow_control {action: abort}  (core protocol type)",
      "server  browser-gateway.ts -> session-action-handler.ts",
      "server -> bridge  flow_control",
      "bridge  dispatch.ts -> pi.events flow:abort + flow:architect-abort",
    ],
    autonomous: [
      "browser -> server  flow_control {action: toggle_autonomous}",
      "server -> bridge  flow_control",
      "bridge  dispatch.ts -> pi.events flow:toggle-autonomous",
    ],
  },
  proposed: {
    abort: [
      "browser -> server  plugin_action {pluginId: flows, action: flow.abort}",
      "flows-plugin server  ctx.emitEventToSession(sid, flow:abort)",
      "server -> bridge  plugin_emit_event  (core: event-agnostic)",
      "bridge -> pi.events flow:abort",
    ],
    autonomous: [
      "browser -> server  plugin_action {pluginId: flows, action: flow.toggle-autonomous}",
      "flows-plugin server  ctx.emitEventToSession(sid, flow:toggle-autonomous)",
      "bridge -> pi.events flow:toggle-autonomous",
    ],
  },
};

// ---------------------------------------------------------------- reducers
interface Decision { labels: string[]; routes: Array<{ branch: string; items?: unknown[] }> }
interface Run {
  state: FlowState | null;
  wire: WireRow[];
  decisions: Map<string, Decision>;
  skipped: Set<string>;
  groups: Map<string, string[]>; // fan-out step -> item keys
}

function runCurrent(n: number): Run {
  let state: FlowState | null = null;
  const wire: WireRow[] = [];
  SCENARIO.slice(0, n).forEach((s, i) => {
    if (!CORE_MAPPED.has(s.channel)) {
      wire.push({ step: s, route: "not in core FLOW_EVENT_MAP", dropped: true });
      return;
    }
    wire.push({ step: s, route: "via core FLOW_EVENT_MAP" });
    state = reduceFlowEvent(state, toEvent(s, i));
  });
  return { state, wire, decisions: new Map(), skipped: new Set(), groups: new Map() };
}

function runProposed(n: number): Run {
  let state: FlowState | null = null;
  const wire: WireRow[] = [];
  const decisions = new Map<string, Decision>();
  const skipped = new Set<string>();
  const groups = new Map<string, string[]>();
  SCENARIO.slice(0, n).forEach((s, i) => {
    wire.push({ step: s, route: "via flows-plugin declaration" });
    if (s.eventType === "flow_decision") {
      const d = s.data as unknown as Decision & { stepId: string };
      decisions.set(d.stepId, d);
      const step = state?.dagSteps?.find((x) => x.id === d.stepId);
      for (const [label, target] of Object.entries(step?.branches ?? {})) if (!d.labels.includes(label)) skipped.add(target);
      return;
    }
    const idx = s.data.itemIndex as number | undefined;
    let ev = toEvent(s, i);
    if (idx !== undefined) {
      const base = s.data.stepId as string;
      const key = `${base}[${idx}]`;
      const keys = groups.get(base) ?? [];
      if (!keys.includes(key)) groups.set(base, [...keys, key]);
      ev = toEvent({ ...s, data: { ...s.data, stepId: key, agentName: key } }, i);
    }
    state = reduceFlowEvent(state, ev);
    if (idx !== undefined && state) {
      const key = `${s.data.stepId as string}[${idx}]`;
      const a = state.agents.get(key);
      if (a) state.agents.set(key, { ...a, label: `${s.data.stepId as string} [${idx + 1}/${s.data.itemCount as number}]` });
    }
  });
  return { state, wire, decisions, skipped, groups };
}

function groupStatus(run: Run, base: string): { status: FlowAgentState["status"]; ok: number; failed: number; total: number } {
  const items = (run.groups.get(base) ?? []).map((k) => run.state?.agents.get(k)).filter(Boolean) as FlowAgentState[];
  const ok = items.filter((a) => a.status === "complete").length;
  const failed = items.filter((a) => a.status === "error").length;
  const status = items.some((a) => a.status === "running") ? "running" : failed ? "error" : items.length ? "complete" : "pending";
  return { status, ok, failed, total: items.length };
}

function proposedGraph(run: Run): FlowGraphStep[] {
  if (!run.state) return [];
  return flowStateToGraphSteps(run.state).map((g) => {
    if (run.skipped.has(g.id)) return { ...g, label: `${g.id} (skipped)` };
    if (run.groups.has(g.id)) {
      const gs = groupStatus(run, g.id);
      return { ...g, status: gs.status, label: `${g.id} x${gs.total}${gs.failed ? ` (${gs.failed} failed)` : ""}` };
    }
    const d = run.decisions.get(g.id);
    return d ? { ...g, label: `${g.id} -> ${d.labels.join(" + ")}` } : g;
  });
}

// ---------------------------------------------------------------- UI parts
// Read-only progress strip: what the auto-play is doing right now (no controls).
function Progress({ cursor, cmds }: { cursor: number; cmds: Cmd[] }) {
  const done = cursor >= SCENARIO.length;
  const now = cursor > 0 ? SCENARIO[cursor - 1] : undefined;
  const lastCmd = cmds[cmds.length - 1];
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-dashed border-[var(--border-secondary)] px-2 py-1.5">
      <div className="flex items-center gap-2 text-[11px] min-w-0">
        <span className="font-semibold text-[var(--text-secondary)] shrink-0">{done ? "Run finished, replaying soon" : "Auto-playing"}</span>
        <span className="font-mono text-[var(--text-primary)] truncate">{now ? `${now.channel}  ${now.note}` : "waiting for flow:flow-started"}</span>
        {lastCmd ? <span className="shrink-0"><Chip>user: {lastCmd === "abort" ? "Abort" : "Toggle Auto"}</Chip></span> : null}
        <span className="ml-auto shrink-0 tabular-nums text-[var(--text-secondary)]">event {cursor}/{SCENARIO.length}</span>
      </div>
      <div className="h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden" role="progressbar" aria-label="Scenario progress" aria-valuemin={0} aria-valuemax={SCENARIO.length} aria-valuenow={cursor}>
        <div className="h-full bg-[var(--accent-primary)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(cursor / SCENARIO.length) * 100}%` }} />
      </div>
    </div>
  );
}

function Header({ run }: { run: Run }) {
  const st = run.state?.status ?? "idle";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm font-semibold text-[var(--text-primary)]">{run.state?.flowName ?? "review-pr"}</span>
      <span className="text-xs text-[var(--text-tertiary)] truncate">{run.state?.task ?? "not started"}</span>
      <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]">{st}</span>
    </div>
  );
}

// Status pill = the one ui-contract implementation (severity triple + word + icon).
const Chip = ({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "bad" | "muted" }) => (
  <SettingsStatusPill tone={tone === "ok" ? "success" : tone === "bad" ? "error" : "neutral"}>{children}</SettingsStatusPill>
);

// `plain`: same cards without rings (reused inside the flow-slot frames).
const Plain = ({ children }: { children: ReactNode; n?: number; tip?: string; block?: boolean }) => <>{children}</>;
function Cards({ run, variant, compact, plain, selected }: { run: Run; variant: Variant; compact?: boolean; plain?: boolean; selected?: string | null }) {
  const IssueR = plain ? Plain : Issue;
  const FixR = plain ? Plain : Fix;
  if (!run.state) return <div className="text-xs text-[var(--text-secondary)] p-3">Starting run...</div>;
  const agents = Array.from(run.state.agents.entries());
  const itemKeys = new Set([...run.groups.values()].flat());
  const out: ReactNode[] = [];
  for (const [key, a] of agents) {
    if (itemKeys.has(key)) continue;
    const card = <div data-step={key}><FlowAgentCard agent={a} sessionId="mock" selected={selected === key} /></div>;
    if (variant === "current") {
      if (key === "sec-review") out.push(<IssueR key={key} n={1} tip="3 item runs merge into 1 card" block>{card}</IssueR>);
      else if (key === "perf-review") out.push(<IssueR key={key} n={2} tip="Never chosen: stuck pending" block>{card}</IssueR>);
      else if (key === "route") out.push(<IssueR key={key} n={3} tip="No items or untaken branches shown" block>{card}</IssueR>);
      else out.push(<div key={key}>{card}</div>);
      continue;
    }
    if (run.groups.has(key)) {
      const gs = groupStatus(run, key);
      out.push(
        <div key={key} data-step={key} className="col-span-full"><FixR n={1} tip="One parent, one card per item" block>
          <div className="rounded-xl border border-[var(--border-secondary)] p-2 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[var(--text-primary)]">{key}</span>
              <Chip>fan-out x{gs.total}</Chip>
              {gs.ok ? <Chip tone="ok">{gs.ok} ok</Chip> : null}
              {gs.failed ? <Chip tone="bad">{gs.failed} failed</Chip> : null}
              <span className="ml-auto text-[var(--text-tertiary)]">result.{key}.items</span>
            </div>
            <div className={compact ? "grid gap-2 grid-cols-1" : "grid gap-2 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]"}>
              {(run.groups.get(key) ?? []).map((k) => { const ia = run.state!.agents.get(k); return ia ? <FlowAgentCard key={k} agent={ia} sessionId="mock" selected={selected === key} /> : null; })}
            </div>
          </div>
        </FixR></div>,
      );
      continue;
    }
    if (run.skipped.has(key)) {
      out.push(
        <FixR key={key} n={2} tip="Untaken branch reads skipped" block>
          <div className="relative opacity-50">{card}<span className="absolute top-1.5 right-1.5"><Chip>skipped</Chip></span></div>
        </FixR>,
      );
      continue;
    }
    const d = run.decisions.get(key);
    if (key === "route") {
      out.push(
        <FixR key={key} n={3} tip="flow_decision shows chosen routes" block>
          <div className="flex flex-col gap-1">
            {card}
            {d ? (
              <div className="flex flex-wrap gap-1 px-1">
                {d.routes.map((r) => <Chip key={r.branch} tone="ok">{r.branch}{Array.isArray(r.items) ? ` x${r.items.length}` : ""}</Chip>)}
                {Object.keys(run.state!.dagSteps?.find((x) => x.id === key)?.branches ?? {}).filter((l) => !d.labels.includes(l)).map((l) => <Chip key={l}>{l}: not taken</Chip>)}
              </div>
            ) : null}
          </div>
        </FixR>,
      );
      continue;
    }
    out.push(<div key={key}>{card}</div>);
  }
  return <div className={FLOW_CARD_GRID_CONTAINER_CLASS}><div className={FLOW_CARD_GRID_CLASS}>{out}</div></div>;
}

function WireLog({ run, variant, cmds }: { run: Run; variant: Variant; cmds: Cmd[] }) {
  const rows = run.wire;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [run.wire.length]);
  const dropped = run.wire.filter((r) => r.dropped).length;
  const log = (
    <div ref={logRef} className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-2 pt-4 pl-5 font-mono text-[10.5px] leading-[1.5] min-h-[150px] max-h-[220px] overflow-y-auto">
      <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-1">
        <span>pi-flows emit -&gt; dashboard ({run.wire.length} events)</span>
        {dropped ? <Chip tone="bad">{dropped} dropped</Chip> : run.wire.length ? <Chip tone="ok">0 dropped</Chip> : null}
      </div>
      {rows.map((r, i) => (
        <div key={`${run.wire.length}-${i}`} className={r.dropped ? "rounded border px-1 bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]" : "text-[var(--text-secondary)]"}>
          {r.dropped ? <strong>DROPPED </strong> : null}
          <span className={r.dropped ? "" : "text-[var(--text-primary)]"}>{r.step.channel}</span> {r.step.note} <span className={r.dropped ? "" : "text-[var(--text-tertiary)]"}>| {r.route}</span>
        </div>
      ))}
    </div>
  );
  const cmdLog = (
    <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-2 pt-4 pl-5 font-mono text-[10.5px] leading-[1.5] min-h-[150px]">
      <div className="text-[var(--text-secondary)] mb-1">dashboard command -&gt; pi-flows (scripted user clicks)</div>
      {cmds.slice(-2).flatMap((c, j) => COMMAND_ROUTES[variant][c].map((line, i) => (
        <div key={`${j}-${i}`} className={i === 0 ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] pl-2"}>{line}</div>
      )))}
    </div>
  );
  const Ring = variant === "current" ? Issue : Fix;
  return (
    <div className="grid gap-2 grid-cols-1 @min-[720px]:grid-cols-[3fr_2fr] items-start">
      <Ring n={4} tip={variant === "current" ? "Core owns the flow event map" : "Plugin declares its own channels"} block>{log}</Ring>
      <Ring n={5} tip={variant === "current" ? "flow_control is a core message" : "plugin_action, core never sees flows"} block>{cmdLog}</Ring>
    </div>
  );
}

function Panel({ variant, phone }: { variant: Variant; phone?: boolean }) {
  const s = usePlayer();
  const run = variant === "current" ? runCurrent(s.cursor) : runProposed(s.cursor);
  const steps = run.state ? (variant === "current" ? flowStateToGraphSteps(run.state) : proposedGraph(run)) : [];
  return (
    <UiPrimitiveProvider value={registry}>
      <div className="@container flex flex-col gap-3 p-3 bg-[var(--bg-primary)] min-h-[560px]">
        <Progress cursor={s.cursor} cmds={s.cmds} />
        <Header run={run} />
        <div className={phone ? "flex flex-col gap-3" : "grid gap-3 grid-cols-[340px_1fr] items-start"}>
          <div className="rounded-xl border border-[var(--border-secondary)] h-[300px] overflow-hidden">
            {steps.length ? <FlowGraph steps={steps} fit /> : <div className="p-3 text-xs text-[var(--text-tertiary)]">graph appears on flow_started</div>}
          </div>
          <Cards run={run} variant={variant} compact={phone} />
        </div>
        <WireLog run={run} variant={variant} cmds={s.cmds} />
      </div>
    </UiPrimitiveProvider>
  );
}
const registry = createHostPrimitiveRegistry();

// ---------------------------------------------------------------- ownership frame
const CORE_TODAY: Array<[string, string]> = [
  ["extension/src/flow-event-wiring.ts", "FLOW_EVENT_MAP: 15 flow:* -> flow_* renames"],
  ["extension/src/bridge.ts", "EVENT_BUS_MAP spreads FLOW_EVENT_MAP"],
  ["extension/src/bridge-handlers/dispatch.ts", "flow_management / flow_control -> pi.events flow:*"],
  ["extension/src/custom-entry-forward.ts", "flow-event custom entries special-cased"],
  ["shared/src/event-forward-declaration.ts", "RESERVED flow_*: plugin may NOT declare them"],
  ["shared/src/protocol.ts + browser-protocol.ts", "flow_control, flow_management message types"],
  ["shared/src/types.ts", "FlowState, FlowAgentState, NodeKind"],
  ["shared/src/state-replay.ts", "replays pi-flows flow-event entries"],
  ["server/src/pairing/browser-gateway.ts", "routes flow_control / flow_management"],
  ["server/src/session/session-api.ts", "REST /api/session/:id/flow-control"],
  ["server/src/identity/* + acp-guard.ts", "scopes / tiers for flow_* messages"],
  ["client/src/hooks/useSessionActions.ts", "handleFlowAction"],
];
const PLUGIN_NEXT: Array<[string, string]> = [
  ["flows-plugin/src/bridge/index.ts", "declares flow:* channels (stream, key stepId) incl. flow:decision"],
  ["flows-plugin/src/server/index.ts", "plugin_action flow.abort / toggle-autonomous / dismiss-summary / delete / set-edit-mode"],
  ["flows-plugin/src/types.ts", "FlowState & co. move out of shared"],
  ["flows-plugin/src/flow-reducer.ts", "items, flow_decision, skipped"],
  ["flows-plugin/src/client/*", "fan-out group card, decision routes, skipped state, graph labels"],
];
const CORE_NEXT: Array<[string, string]> = [
  ["register-event-forward", "+ persistedAs: plugin opts its custom entries into replay"],
  ["dashboard:commands-changed", "generic: any plugin asks for a commands_list resend"],
  ["check:plugin-boundary", "+ flags flow: / flow_ / pi-flows literals in core"],
];

const Rows = ({ rows, tone }: { rows: Array<[string, string]>; tone?: "bad" | "ok" }) => (
  <div className="flex flex-col divide-y divide-[var(--border-secondary)] rounded-lg border border-[var(--border-secondary)]">
    {rows.map(([f, why]) => (
      <div key={f} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 px-2 py-1 text-[11px]">
        <span className="flex items-center gap-1.5 min-w-0">
          {tone ? <Chip tone={tone}>{tone === "bad" ? "core" : "plugin"}</Chip> : <Chip>seam</Chip>}
          <span className="font-mono truncate text-[var(--text-primary)]" title={f}>{f}</span>
        </span>
        <span className="text-[var(--text-secondary)]">{why}</span>
      </div>
    ))}
  </div>
);

const Ownership = ({ variant }: { variant: Variant }) => (
  <div className="flex flex-col gap-3 p-3 bg-[var(--bg-primary)]">
    {variant === "current" ? (
      <Issue n={1} tip="12 core files know pi-flows" block>
        <div className="flex flex-col gap-1 pt-3 pl-4">
          <div className="text-xs font-medium text-[var(--text-primary)]">Core (extension / shared / server / client)</div>
          <Rows rows={CORE_TODAY} tone="bad" />
        </div>
      </Issue>
    ) : (
      <>
        <Fix n={1} tip="Core: generic seams only" block>
          <div className="flex flex-col gap-1 pt-3 pl-4">
            <div className="text-xs font-medium text-[var(--text-primary)]">Core: 0 flow references, 3 generic seams</div>
            <Rows rows={CORE_NEXT} />
          </div>
        </Fix>
        <Fix n={2} tip="Everything flow lives in the plugin" block>
          <div className="flex flex-col gap-1 pt-3 pl-4">
            <div className="text-xs font-medium text-[var(--text-primary)]">flows-plugin owns it all</div>
            <Rows rows={PLUGIN_NEXT} tone="ok" />
          </div>
        </Fix>
      </>
    )}
  </div>
);

// ---------------------------------------------------------------- flow slot frames
// Today: the REAL FlowDashboard (the slot above the chat). One chevron: collapsed =
// header only, expanded = graph + the full card grid, so the cards push the chat down.
// Proposed: graph-first. Expanded = header + graph + a collapsible "Agent cards"
// section holding EVERY card, collapsed by default (state summary in its header).
const noop = () => {};
const CHAT: Array<["user" | "assistant", string]> = [
  ["user", "/review-pr Review PR #482"],
  ["assistant", "Started flow review-pr. The planner reads the diff, then a decision step picks the reviews to run."],
  ["user", "Also check the billing retry path when it gets there."],
  ["assistant", "Noted. I'll pass that to the security reviewer for billing.ts."],
];

function SessionShell({ slot, chatRing }: { slot: ReactNode; chatRing: (chat: ReactNode) => ReactNode }) {
  const chat = (
    <div className="flex flex-col gap-2 p-3 text-sm">
      {CHAT.map(([who, text]) => (
        <div key={text} className={who === "user"
          ? "self-end max-w-[70%] rounded-xl bg-[var(--bg-tertiary)] px-3 py-2 text-[var(--text-primary)]"
          : "max-w-[80%] rounded-xl border border-[var(--border-secondary)] px-3 py-2 text-[var(--text-secondary)]"}>{text}</div>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col h-[760px] bg-[var(--bg-primary)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)] shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">review-pr-482</span>
        <span className="text-xs text-[var(--text-secondary)]">~/work/web-app</span>
      </div>
      {/* p-2: ring outlines + badges must sit inside the scroll/clip boxes. */}
      <div className="shrink-0 max-h-[560px] overflow-y-auto p-2">{slot}</div>
      <div className="flex-1 min-h-0 overflow-hidden p-2">{chatRing(chat)}</div>
      <div className="shrink-0 m-2 rounded-xl border border-[var(--border-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">Message...</div>
    </div>
  );
}

function TodaySlot() {
  const s = usePlayer();
  const run = runCurrent(s.cursor);
  const ref = useRef<HTMLDivElement>(null);
  const expanded = useRef(false);
  // Today the panel defaults to COLLAPSED (FLOW_COLLAPSE_DEFAULT). Without a sessionId
  // the state is not persisted, so click the real chevron once, like a user would.
  useEffect(() => {
    if (!run.state) { expanded.current = false; return; } // loop restart remounts it collapsed
    if (expanded.current) return;
    const chevron = ref.current?.querySelector<HTMLElement>('[data-testid="flow-dashboard"] span.cursor-pointer');
    if (chevron) { chevron.click(); expanded.current = true; }
  });
  if (!run.state) return <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">Starting run...</div>;
  // flowSource dropped: the YAML popover would fetch from a live server.
  return <div ref={ref}><FlowDashboard flowState={{ ...run.state, flowSource: undefined }} onAbort={noop} onToggleAutonomous={noop} onDismiss={noop} /></div>;
}

// Proposed slot: header -> graph -> "Agent cards" section with EVERY card (no
// follow/selection logic). The section is collapsed by default; while collapsed its
// header still summarises card states so nothing is hidden silently.
function ProposedSlot() {
  const s = usePlayer();
  const run = runProposed(s.cursor);
  const [collapsed, setCollapsed] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false); // collapsed by default
  const [selected, setSelected] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Node click opens the section, selects the step and scrolls its card into view.
  useEffect(() => {
    if (!cardsOpen || !selected) return;
    rootRef.current?.querySelector(`[data-step="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cardsOpen, selected]);
  const onNode = (id: string) => { setSelected((cur) => (cur === id ? null : id)); setCardsOpen(true); };
  if (!run.state) return <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">Starting run...</div>;
  const steps = proposedGraph(run);
  const count = (pred: (g: FlowGraphStep) => boolean) => steps.filter(pred).length;
  const skipped = count((g) => run.skipped.has(g.id));
  const done = count((g) => g.status === "complete");
  const running = count((g) => g.status === "running");
  const failed = count((g) => g.status === "error");
  const itemKeys = new Set([...run.groups.values()].flat());
  const cardCount = [...run.state.agents.keys()].filter((k) => !itemKeys.has(k)).length; // fan-out group = 1 step
  const isRunning = run.state.status === "running";
  return (
    <div ref={rootRef} className="bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] px-3 py-2">
      <div className="flex items-center gap-2 mb-2">
        <button className="focus-ring inline-flex text-[var(--text-secondary)] rounded" aria-expanded={!collapsed} aria-label="Collapse flow panel" onClick={() => setCollapsed((c) => !c)}>
          <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.6} />
        </button>
        {isRunning ? <Icon path={mdiLoading} size={0.55} className="text-[var(--accent-primary)] animate-spin motion-reduce:animate-none shrink-0" /> : null}
        <span className="text-sm text-[var(--text-primary)] truncate flex-1">
          {run.state.flowName}<span className="text-[var(--text-secondary)] ml-1.5">{done + failed + skipped}/{steps.length} steps done</span>
        </span>
      </div>
      {collapsed ? null : (
        <div className="flex flex-col gap-2">
          <Fix n={1} tip="Click a node: opens its card" block>
            <div className="rounded-lg border border-[var(--border-secondary)] h-[220px] overflow-hidden">
              <FlowGraph steps={steps} fit selectedStepId={selected} onSelectStep={onNode} />
            </div>
          </Fix>
          <Fix n={3} tip="All cards, collapsed by default" block>
            <div className="rounded-lg border border-[var(--border-secondary)]">
              <button
                className="focus-ring w-full flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[44px] sm:min-h-[32px] rounded-lg px-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                aria-expanded={cardsOpen}
                aria-controls="flow-agent-cards"
                onClick={() => setCardsOpen((o) => !o)}
              >
                <Icon path={cardsOpen ? mdiChevronDown : mdiChevronRight} size={0.6} className="text-[var(--text-secondary)]" />
                <span>Agent cards</span>
                <span className="text-[var(--text-secondary)]">{cardCount}</span>
                <span className="flex flex-wrap items-center gap-1 font-normal">
                  {done ? <Chip tone="ok">{done} done</Chip> : null}
                  {running ? <SettingsStatusPill tone="info">{running} running</SettingsStatusPill> : null}
                  {failed ? <Chip tone="bad">{failed} failed</Chip> : null}
                  {skipped ? <Chip>{skipped} skipped</Chip> : null}
                </span>
              </button>
              {cardsOpen ? (
                <div id="flow-agent-cards" className="p-2 pt-0">
                  <Cards run={run} variant="proposed" plain selected={selected} />
                </div>
              ) : null}
            </div>
          </Fix>
        </div>
      )}
    </div>
  );
}

const SlotToday = () => (
  <UiPrimitiveProvider value={registry}>
    <SessionShell
      slot={<Issue n={1} tip="Expanded = graph + every card" block><TodaySlot /></Issue>}
      chatRing={(chat) => <Issue n={2} tip="Chat pushed below the cards" block>{chat}</Issue>}
    />
  </UiPrimitiveProvider>
);
const SlotProposed = () => (
  <UiPrimitiveProvider value={registry}>
    <SessionShell slot={<ProposedSlot />} chatRing={(chat) => <Fix n={2} tip="Chat keeps its space" block>{chat}</Fix>} />
  </UiPrimitiveProvider>
);

const mock: Mock = {
  title: "Flows plugin - pi-flows 0.10 run + decoupled from core",
  category: "Flows",
  frames: [
    { title: "Flow run - fan-out + multi-route decision (desktop)", width: 1180, current: <Panel variant="current" />, proposed: <Panel variant="proposed" /> },
    { title: "Where flow code lives", width: 900, current: <Ownership variant="current" />, proposed: <Ownership variant="proposed" /> },
    { title: "Flow slot in a session - expanded", width: 900, current: <SlotToday />, proposed: <SlotProposed /> },
    { title: "Flow run - phone", phone: true, current: <Panel variant="current" phone />, proposed: <Panel variant="proposed" phone /> },
  ],
};
export default mock;
