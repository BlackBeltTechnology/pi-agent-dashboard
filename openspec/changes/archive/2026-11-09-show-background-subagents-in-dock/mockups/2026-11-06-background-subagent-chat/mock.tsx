// Background subagents during a parent run: chat "started" card + composer-dock Processes lane (explore mock).
// Producer pi-dashboard-subagents v0.7.0: Agent({ run_in_background: true }) returns at once with
// "Started background subagent bg-… (running)…" and details { background: true, id, status, counts } --
// NO agentId. The run continues detached; its subagents:* frames carry agentId + details.background and
// land in session.subagents. The parent keeps working (here: it then runs a FOREGROUND reviewer).
//
// Direction (user):
//   - chat: the background tool call only says it STARTED (a not-running subagent card);
//   - dock: no message stream in the dock (same row style as today);
//   - dock: background subagents cleanly separated from foreground ones;
//   - dock: Open (full screen) stays -- that is how a background run is watched;
//   - dock: Stop on every subagent row, so background ones can be stopped too.
// Today: the chat card is built from the early details ({status:"running"}, no agentId) and looks like a
// frozen running subagent; the dock lists foreground and background subagents mixed under one
// "Subagents" heading with Open only -- no Stop.
// Proposed: two composer-dock-process-group claims (foreground / background) so the shell renders two
// headings; each row = shipped ComposerDockRow + Stop (real requestSubagentStop -> POST
// /api/plugins/subagents/stop, fixture-answered, Stopping… while pending) + Open (real SubagentPopoutPage).
//
// Real: ChatView, reduceEvent (real event shapes), ComposerDock + Processes lane, ComposerDockRow,
// SubagentDockGroup (current), AgentToolRenderer, SubagentPopoutPage, requestSubagentStop,
// useSubagentStopState, ui:agent-card, ui:status-pill.
import { ComposerDockRow, UiPrimitiveProvider, useSessionSubagents, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { countSteps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChatView } from "@app/components/chat/ChatView.tsx";
import { ComposerDock } from "@app/components/chat/ComposerDock.tsx";
import { ThemeProvider } from "@app/components/settings/ThemeProvider.tsx";
import type { ToolContext } from "@app/components/tool-renderers/types.ts";
import { useInflightBashTools } from "@app/hooks/useInflightBashTools.ts";
import { createInitialState, reduceEvent, type SessionState } from "@app/lib/chat/event-reducer.ts";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { AgentToolRenderer } from "../../../../../packages/subagents-plugin/src/client/AgentToolRenderer.tsx";
import { isAgentResultNotReceived } from "../../../../../packages/subagents-plugin/src/client/resultPending.ts";
import { SubagentDockGroup } from "../../../../../packages/subagents-plugin/src/client/SubagentDockGroup.tsx";
import { SubagentPopoutPage } from "../../../../../packages/subagents-plugin/src/client/SubagentPopoutPage.tsx";
import {
  agentRowStatus,
  agentStop,
  agentStopLabel,
  clearSubagentStop,
  requestSubagentStop,
  useSubagentStopState,
} from "../../../../../packages/subagents-plugin/src/client/subagentStop.ts";
import type { SubagentState, SubagentTimelineEntry } from "../../../../../packages/subagents-plugin/src/client/types.ts";
import { mdiArrowDown, mdiOpenInNew, mdiRobotOutline, mdiTrayArrowDown } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type Fixtures, Fix, Issue, type Mock } from "mock-site/kit";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToolRendererProps = Parameters<typeof AgentToolRenderer>[0];
type DockGroupProps = SlotProps<"composer-dock-process-group">;

// ---------------------------------------------------------------- scenario
const SESSION_ID = "mock-session";
const T = Date.now() - 4 * 60_000;
const BG_AGENT = "4c1e9b52-docs";
const FG_AGENT = "9a07d3e1-review";
const BG_ID = "bg-7a3f";
const TC_BG = "tc-agent-bg";
const TC_FG = "tc-agent-fg";
const CWD = "/Users/bmiller/Projects/Pi-Packages/pi-agent-dashboard";

const bgArgs = {
  subagent_type: "docs-writer",
  description: "Regenerate the API reference",
  prompt: "Regenerate docs/api-reference.md from openapi.yaml and write a diff against the committed docs to /tmp/api-diff.md.",
  run_in_background: true,
};
const fgArgs = {
  subagent_type: "code-reviewer",
  description: "Review the hub.ts lint fix",
  prompt: "Review the useOptionalChain fix in packages/server/src/ws/hub.ts:118 and report any behaviour change.",
};

const bgSteps: SubagentTimelineEntry[] = [
  { kind: "thinking", text: "Regenerate types from the spec first, then diff the reference section by section.", ts: T + 20_000 },
  { kind: "tool", toolName: "bash", input: { command: "npx openapi-typescript openapi.yaml -o types.gen.ts" }, output: "wrote 1,284 lines", ts: T + 40_000 },
  { kind: "tool", toolName: "read", input: { path: "docs/api-reference.md" }, output: "(2,101 lines)", ts: T + 60_000 },
  { kind: "error", text: "Attempt 1 failed: 503 service unavailable (pi retried in 4s)", ts: T + 90_000 },
  { kind: "tool", toolName: "write", input: { path: "/tmp/api-diff.md" }, output: "wrote 214 lines", ts: T + 150_000 },
];
const BG_TAIL = "Comparing the paths section: /sessions/{id}/fork and /flows/{id}/runs are new, /legacy/export is gone, 7 response schemas changed.";
const fgSteps: SubagentTimelineEntry[] = [
  { kind: "tool", toolName: "read", input: { path: "packages/server/src/ws/hub.ts" }, output: "(412 lines)", ts: T + 200_000 },
];

function bgSub(stopped: boolean, tailLen: number): SubagentState {
  const base = {
    id: BG_AGENT, type: "docs-writer", displayName: "docs-writer", subagentType: "docs-writer", description: bgArgs.description,
    modelName: "claude-sonnet-4-5", thinkingLevel: "medium", startedAt: T + 10_000, slotGrantedAt: T + 10_000, stoppable: true,
    // Proposed SubagentState field, from details.background (producer v0.7.0).
    background: true, backgroundId: BG_ID,
  };
  if (stopped) return { ...base, status: "stopped", stopReason: "running", durationMs: 4 * 60_000, entries: bgSteps } as SubagentState;
  return { ...base, status: "running", activity: "thinking", entries: bgSteps, toolUses: 3, liveTail: { kind: "thinking", text: BG_TAIL.slice(0, tailLen) } } as SubagentState;
}
const fgSub = (): SubagentState =>
  ({
    id: FG_AGENT, type: "code-reviewer", displayName: "code-reviewer", subagentType: "code-reviewer", description: fgArgs.description,
    modelName: "claude-sonnet-4-5", thinkingLevel: "high", startedAt: T + 195_000, slotGrantedAt: T + 195_000, stoppable: true,
    status: "running", activity: "reading packages/server/src/ws/hub.ts", entries: fgSteps, toolUses: 1,
  }) as SubagentState;

// ---- parent transcript from real event shapes (as in ChatView.streaming-text-flush.test.tsx)
let ts = T;
const at = () => (ts += 1_000);
const user = (text: string): DashboardEvent[] => [
  { eventType: "message_start", timestamp: at(), data: { message: { role: "user", content: [{ type: "text", text }] } } },
  { eventType: "message_end", timestamp: at(), data: { message: { role: "user", content: [{ type: "text", text }] } } },
];
const say = (text: string): DashboardEvent[] => [
  { eventType: "message_start", timestamp: at(), data: { message: { role: "assistant", content: [] } } },
  { eventType: "message_update", timestamp: at(), data: { message: { role: "assistant", content: [{ type: "text", text }] } } },
];
const close = (text: string): DashboardEvent => ({ eventType: "message_end", timestamp: at(), data: { message: { role: "assistant", content: [{ type: "text", text }] } } });
const start = (id: string, name: string, args: unknown): DashboardEvent => ({ eventType: "tool_execution_start", timestamp: at(), data: { toolCallId: id, toolName: name, args } });
const end = (id: string, result: string, details?: unknown): DashboardEvent => ({
  eventType: "tool_execution_end", timestamp: at(), data: { toolCallId: id, result, isError: false, ...(details ? { details } : {}) },
});

function chatState(): SessionState {
  ts = T;
  const ev: DashboardEvent[] = [
    { eventType: "agent_start", timestamp: at(), data: {} },
    ...user("Regenerate the API reference in the background, fix the lint error in packages/server, and have a reviewer check the fix."),
    ...say("Starting the docs regeneration as a background subagent, then I'll fix lint."),
    start(TC_BG, "Agent", bgArgs),
    // The producer's real early result for a background Agent call.
    end(TC_BG, `Started background subagent ${BG_ID} (running). Background: 1 running, 0 queued, 0 finished unread. Check it with AgentStatus({ ids: ["${BG_ID}"] }) (wait: "all" to block until done); nothing is sent back automatically.`, {
      background: true, id: BG_ID, status: "running", counts: { running: 1, queued: 0, unread: 0 },
    }),
    close("Starting the docs regeneration as a background subagent, then I'll fix lint."),
    ...say("Linting packages/server."),
    start("tc-lint", "bash", { command: "npx biome lint packages/server" }),
    end("tc-lint", "packages/server/src/ws/hub.ts:118 useOptionalChain\nFound 1 error."),
    start("tc-edit", "edit", { path: "packages/server/src/ws/hub.ts" }),
    end("tc-edit", "Applied 1 edit."),
    close("Linting packages/server."),
    ...say("Fixed. Asking a reviewer to check it."),
    start(TC_FG, "Agent", fgArgs),
    // Foreground run: live details arrive on tool_execution_update (structured partialResult).
    {
      eventType: "tool_execution_update", timestamp: at(),
      data: { toolCallId: TC_FG, partialResult: { content: [], details: {
        agentId: FG_AGENT, displayName: "code-reviewer", subagentType: "code-reviewer", description: fgArgs.description,
        status: "running", activity: "reading packages/server/src/ws/hub.ts", modelName: "claude-sonnet-4-5", thinkingLevel: "high",
        turnCount: 2, toolUses: 1, stoppable: true,
      } } },
    },
  ];
  return ev.reduce((acc, e) => reduceEvent(acc, e, { isLive: true }), createInitialState());
}

// ---------------------------------------------------------------- pane state (stop + popout)
interface PaneState {
  /** Opens the full-screen subagent page (what the dock's Open link routes to). */
  open: (agentId: string) => void;
}
const PaneCtx = createContext<PaneState>({ open: () => {} });

/** Stop fixture: the server accepts, then the producer's terminal `stopped` frame arrives. */
const STOPPED_EVENT = "mock:subagent-stopped";
const stopFixtures = (): Fixtures => ({
  http: {
    "POST /api/plugins/subagents/stop": (r) => {
      const { agentId } = r.json() as { agentId: string };
      setTimeout(() => window.dispatchEvent(new CustomEvent(STOPPED_EVENT, { detail: agentId })), 1600);
      return { ok: true };
    },
  },
});

// ---------------------------------------------------------------- chat: proposed "started" card
function StartedCard({ args }: { args: Record<string, unknown> }) {
  const AgentCard = useUiPrimitive(UI_PRIMITIVE_KEYS.agentCard);
  const Pill = useUiPrimitive(UI_PRIMITIVE_KEYS.statusPill);
  return (
    <Fix n={1} tip="Started, not running; points to dock" block>
      <AgentCard name={String(args.subagent_type)} status="pending">
        <div className="text-[11px] text-[var(--text-secondary)] mt-1 truncate">"{String(args.description)}"</div>
        <div data-testid="agent-bg-started" className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-tertiary)]">
          <Pill state="muted" text="Started in background" icon={mdiTrayArrowDown} tooltip="Runs detached; the result is stored, not sent back to this chat" />
          <span className="font-mono text-[var(--text-secondary)]">{BG_ID}</span>
          <span className="inline-flex items-center gap-0.5">
            <Icon path={mdiArrowDown} size={0.45} aria-hidden="true" />
            In Processes
          </span>
        </div>
      </AgentCard>
    </Fix>
  );
}
function ProposedAgentRenderer(props: ToolRendererProps) {
  return (props.toolDetails as Record<string, unknown> | undefined)?.background
    ? <StartedCard args={props.toolInput} />
    : <AgentToolRenderer {...props} />;
}
function CurrentAgentRenderer(props: ToolRendererProps) {
  if (!(props.toolDetails as Record<string, unknown> | undefined)?.background) return <AgentToolRenderer {...props} />;
  return (
    <Issue n={1} tip="Looks like a frozen running subagent" block>
      <AgentToolRenderer {...props} />
    </Issue>
  );
}

// ---------------------------------------------------------------- dock: proposed groups
// Same classes as ProcessesLaneBody's ACTION_BUTTON / KILL_BUTTON (core Kill), so Stop reads as Kill's sibling.
const ACTION_BUTTON =
  "focus-ring inline-flex items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:hover:bg-transparent";
const STOP_BUTTON = `${ACTION_BUTTON} hover:bg-[var(--tint-red-bg)] hover:text-[var(--tint-red-fg)]`;

type Bg = SubagentState & { background?: boolean; backgroundId?: string };
const isLive = (s: SubagentState) => s.status === "created" || s.status === "running";

function ProposedRow({ sessionId, sub }: { sessionId: string; sub: Bg }) {
  const t = useT();
  const { open } = useContext(PaneCtx);
  const stop = useSubagentStopState(sessionId, sub.id);
  const name = sub.displayName ?? sub.type;
  const steps = countSteps(sub.entries);
  const stepsLabel = steps === 1 ? t("dockStepOne", { count: steps }, "{count} step") : t("dockSteps", { count: steps }, "{count} steps");
  const base = sub.background ? `${sub.backgroundId} · ${stepsLabel}` : `${sub.type} · ${stepsLabel}`;
  const meta =
    stop?.phase === "pending" ? "Stopping…"
    : stop?.phase === "unconfirmed" ? "Still running"
    : stop?.phase === "error" ? "Stop failed"
    : base;
  const kind = sub.background ? "bg" : "fg";
  return (
    <ComposerDockRow
      icon={<Icon path={sub.background ? mdiTrayArrowDown : mdiRobotOutline} size={0.6} />}
      title={name}
      detail={sub.description}
      meta={meta}
      startedAt={sub.slotGrantedAt ?? sub.startedAt}
      actions={
        <>
          <button
            type="button"
            data-testid={`dock-${kind}-stop`}
            disabled={stop?.phase === "pending"}
            onClick={() => void requestSubagentStop(sessionId, sub.id)}
            aria-label={`Stop subagent ${name}`}
            title={sub.background ? "Stop this background subagent" : "Stop this subagent (the turn continues)"}
            className={STOP_BUTTON}
          >
            Stop
          </button>
          <a
            href={`/session/${encodeURIComponent(sessionId)}/subagent/${encodeURIComponent(sub.id)}`}
            data-testid={`dock-${kind}-open`}
            onClick={(e) => { e.preventDefault(); open(sub.id); }}
            aria-label={t("dockOpenSubagent", { name, task: sub.description }, "Open subagent {name}: {task}")}
            title="Open full screen"
            className={ACTION_BUTTON}
          >
            <Icon path={mdiOpenInNew} size={0.6} aria-hidden="true" />
            <span className="max-md:hidden">{t("dockOpen", undefined, "Open")}</span>
          </a>
        </>
      }
    />
  );
}

/** One claim per lane: the shell gives each claim its own heading (its reported noun). */
function makeGroup(background: boolean, nouns: [string, string], ring: { n: number; tip: string }) {
  return function Group({ session, mode, reportSummary }: DockGroupProps) {
    const all = useSessionSubagents(session.id) as unknown as ReadonlyMap<string, SubagentState>;
    const rows = useMemo(() => [...all.values()].filter((s) => isLive(s) && !!(s as Bg).background === background), [all]);
    const count = rows.length;
    const reportRef = useRef(reportSummary);
    reportRef.current = reportSummary;
    useEffect(() => {
      if (mode !== "summary") return;
      reportRef.current(count > 0 ? { count, noun: count === 1 ? nouns[0] : nouns[1] } : null);
    }, [mode, count]);
    if (mode === "summary" || count === 0) return null;
    return (
      <Fix n={ring.n} tip={ring.tip} block>
        <div>{rows.map((s) => <ProposedRow key={s.id} sessionId={session.id} sub={s} />)}</div>
      </Fix>
    );
  };
}
const ForegroundGroup = makeGroup(false, ["subagent", "subagents"], { n: 2, tip: "Foreground: Stop + Open" });
const BackgroundGroup = makeGroup(true, ["background subagent", "background subagents"], { n: 3, tip: "Background, own group: Stop + Open" });

function CurrentDockGroup(props: DockGroupProps) {
  if (props.mode === "summary") return <SubagentDockGroup {...props} />;
  return (
    <Issue n={2} tip="Mixed fg/bg, Open only, no Stop" block>
      <div><SubagentDockGroup {...props} /></div>
    </Issue>
  );
}

// ---------------------------------------------------------------- registries + pane
function makeRegistry(side: "current" | "proposed") {
  const r = createSlotRegistry();
  r.addClaim({
    pluginId: "subagents", priority: 100, slot: "tool-renderer", toolName: "Agent",
    Component: side === "current" ? CurrentAgentRenderer : ProposedAgentRenderer,
    expandWhileRunning: true, resultPending: isAgentResultNotReceived,
    rowStatus: agentRowStatus, stop: agentStop, stopLabel: agentStopLabel,
  } as Parameters<typeof r.addClaim>[0]);
  if (side === "current") {
    r.addClaim({ pluginId: "subagents", slot: "composer-dock-process-group", Component: CurrentDockGroup } as Parameters<typeof r.addClaim>[0]);
  } else {
    r.addClaim({ pluginId: "subagents", slot: "composer-dock-process-group", Component: ForegroundGroup } as Parameters<typeof r.addClaim>[0]);
    r.addClaim({ pluginId: "subagents", slot: "composer-dock-process-group", Component: BackgroundGroup } as Parameters<typeof r.addClaim>[0]);
  }
  return r;
}
const registries = { current: makeRegistry("current"), proposed: makeRegistry("proposed") };
const primitives = createHostPrimitiveRegistry();

function Dock({ state, session }: { state: SessionState; session: DashboardSession }) {
  const commands = useInflightBashTools(state);
  return (
    <ComposerDock
      session={session}
      cwd={CWD}
      openLane="processes"
      onOpenLaneChange={() => {}}
      processes={{ commands, onKill: () => {}, onShowTool: () => {} }}
      lanes={[]}
    />
  );
}

function Pane({ side }: { side: "current" | "proposed" }) {
  const state = useMemo(chatState, []);
  const [stopped, setStopped] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | undefined>();
  const [tick, setTick] = useState(0);
  // The background run keeps streaming (visible in the full-screen page).
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 400);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const on = (e: Event) => {
      const agentId = (e as CustomEvent<string>).detail;
      setStopped((s) => new Set([...s, agentId]));
      clearSubagentStop(SESSION_ID, agentId); // the card/row clear it on the terminal frame
    };
    window.addEventListener(STOPPED_EVENT, on);
    return () => window.removeEventListener(STOPPED_EVENT, on);
  }, []);
  const tailLen = Math.min(BG_TAIL.length, 20 + (tick % 40) * 4);
  const subs = useMemo(() => {
    const fg = fgSub();
    return new Map<string, SubagentState>([
      [BG_AGENT, bgSub(stopped.has(BG_AGENT), tailLen)],
      [FG_AGENT, stopped.has(FG_AGENT) ? ({ ...fg, status: "stopped", stopReason: "running" } as SubagentState) : fg],
    ]);
  }, [stopped, tailLen]);
  const session = useMemo(
    () => ({ id: SESSION_ID, cwd: CWD, status: "streaming", name: "lint + docs", processes: [] }) as unknown as DashboardSession,
    [],
  );
  const useSubs = useCallback(() => subs as never, [subs]);
  const ctx = useMemo(() => ({ sessionId: SESSION_ID, session: { ...state, subagents: subs }, send: () => {} }) as unknown as ToolContext, [state, subs]);
  const pane = useMemo<PaneState>(() => ({ open: setOpenId }), []);
  return (
    <PaneCtx.Provider value={pane}>
        <UiPrimitiveProvider value={primitives}>
          <PluginContextProvider registry={registries[side]} useSessionSubagents={useSubs}>
            <ThemeProvider>
              <div style={{ height: 760 }} className="flex flex-col bg-[var(--bg-primary)] rounded-xl overflow-hidden border border-[var(--border-secondary)]">
                {openId ? (
                  <div data-testid="mock-popout" className="flex-1 min-h-0 flex flex-col">
                    <SubagentPopoutPage
                      sessionId={SESSION_ID}
                      agentId={openId}
                      session={{ subagents: subs }}
                      subscriptionResolved
                      parentLabel="pi-agent-dashboard"
                      onBack={() => setOpenId(undefined)}
                      forwardSessionId={SESSION_ID}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-h-0 flex flex-col">
                      <ChatView sessionId={SESSION_ID} state={{ ...state, subagents: subs }} toolContext={ctx} />
                    </div>
                    <div className="shrink-0 px-3 pt-1">
                      <Dock state={state} session={session} />
                    </div>
                  </>
                )}
              </div>
            </ThemeProvider>
          </PluginContextProvider>
        </UiPrimitiveProvider>
    </PaneCtx.Provider>
  );
}

// Completed chat rows start collapsed in a one-tool burst: open the burst, then the background row.
const openBgChatRow = [
  { say: "Open the tool group", target: "[data-testid=tool-burst-header]", act: "click" as const, unless: "button[title^='docs-writer']" },
  { say: "Open the docs-writer row", target: "button[title^='docs-writer']", act: "click" as const, unless: "[data-testid=agent-bg-started], [data-testid=agent-activity-row]" },
];

// ---------------------------------------------------------------- frames
const mock: Mock = {
  title: "Background subagents during a run: started card in chat, own dock group with Stop + Open",
  category: "Chat",
  frames: [
    {
      title: "Mid-run: background docs-writer + foreground reviewer",
      why: "Chat says started. Dock splits foreground and background; every row gets Stop + Open.",
      width: 1100,
      fixtures: stopFixtures,
      current: <Pane side="current" />,
      proposed: <Pane side="proposed" />,
      script: openBgChatRow,
      side: "both",
    },
    {
      title: "Stop a background subagent from the dock",
      why: "Real requestSubagentStop: Stopping… while pending, row leaves on the stopped frame.",
      width: 1100,
      fixtures: stopFixtures,
      proposed: <Pane side="proposed" />,
      script: [
        { say: "Stop the background docs-writer", target: "dock-bg-stop", act: "click" },
        { say: "Stopping…", act: "wait", expect: (d) => !!d.querySelector("[data-testid=dock-bg-stop]:disabled") },
        { say: "Stopped: row leaves", act: "wait", timeout: 5000, expect: (d) => !d.querySelector("[data-testid=dock-bg-stop]") },
      ],
    },
    {
      title: "Open: watch a background subagent full screen",
      why: "Open routes to the full-screen subagent page; that is where the live stream is watched.",
      width: 1100,
      fixtures: stopFixtures,
      proposed: <Pane side="proposed" />,
      script: [
        { say: "Open the background docs-writer", target: "dock-bg-open", act: "click" },
        { say: "Live stream, full screen", act: "wait", expect: (d) => !!d.querySelector("[data-testid=mock-popout]") },
      ],
    },
  ],
};
export default mock;
