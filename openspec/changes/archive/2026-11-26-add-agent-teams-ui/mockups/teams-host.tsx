// MOCK-ONLY host harness for the Team UI mocks: the REAL host paths with a throw-away slot registry.
//  - `MockHost`  : real `UiPrimitiveProvider` (host primitives), `ThemeProvider`, `PluginContextProvider` and a
//                  `SlotRegistry` carrying the proposed claims (badge, mail cards, tool renderers). A pane with
//                  NO claims is "today": the host falls back to `CustomEntryCard` / `GenericToolRenderer`.
//  - `HostShell` : surroundings for the Team view: the real desktop shell parts (`ResizableSidebar` + a column of
//                  real `SessionCard`s, content region with the same classes as App.tsx) or the phone shell.
//                  Identical in both panes (fidelity R1).
//  - `ChatPane`  : real `ChatView` with synthetic reducer state, `ToolRows`: real `ToolCallStep` rows.
// The session LIST (`SessionList`) is approximated by a column of real `SessionCard`s: it needs a live socket.
// See change: add-agent-teams-ui (tasks 1.4 to 1.7; design D1, D6, D9).
import { ChatView } from "@app/components/chat/ChatView.tsx";
import { CustomEntryRow } from "@app/components/chat/CustomEntryRow.tsx";
import { ToolCallStep } from "@app/components/chat/ToolCallStep.tsx";
import { SessionCard } from "@app/components/session/SessionCard.tsx";
import { ThemeProvider } from "@app/components/settings/ThemeProvider.tsx";
import { ResizableSidebar } from "@app/components/shell/ResizableSidebar.tsx";
import { makeToolContext } from "@app/components/tool-renderers/make-tool-context.tsx";
import { createInitialState, type ChatMessage } from "@app/lib/chat/event-reducer.ts";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import { UiPrimitiveProvider } from "@rt/index.ts";
import { createSlotRegistry, type ClaimEntry, PluginContextProvider, type SlotRegistry } from "@rt/host.ts";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { DEFAULT_OPENSPEC_CONFIG } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { Fixtures } from "mock-site/kit";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { LEAD_CWD, LEAD_SESSION, TEAM_ID, T0 } from "./teams-fixtures";
import { type BadgeDensity, isTeamSession, MailEntryCard, type MailCardProps, makeTeamBadge, TEAM_TOOL_NAMES, TeamToolRenderer } from "./teams-cards";

// ---------------------------------------------------------------- claims

export interface HostClaims {
  /** Eager badge claim in this density; omitted = no badge claim (today). */
  badge?: BadgeDensity;
  /** Mail card claims; `expanded` opens every card once on mount (through the host's own toggle). */
  mail?: "collapsed" | "expanded";
  /** Tool renderer claims for the 11 team tools. */
  tools?: boolean;
}

const PLUGIN = "agent-teams";
const MAIL_TYPES = ["agent-teams-mail", "agent-teams-idle", "agent-teams-notice"] as const;

function AutoExpandMail(props: MailCardProps) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (!props.expanded) props.onToggle();
    // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount, like a user's single click
  }, []);
  return <MailEntryCard {...props} />;
}

export function buildRegistry(c: HostClaims): SlotRegistry {
  const reg = createSlotRegistry();
  const add = (claim: Partial<ClaimEntry> & Pick<ClaimEntry, "slot" | "Component">) =>
    reg.addClaim({ pluginId: PLUGIN, priority: 100, ...claim } as ClaimEntry);
  if (c.badge)
    add({ slot: "session-card-badge", Component: makeTeamBadge(c.badge) as never, predicate: isTeamSession as never });
  if (c.mail)
    for (const customType of MAIL_TYPES)
      add({ slot: "custom-entry-renderer", customType, Component: (c.mail === "expanded" ? AutoExpandMail : MailEntryCard) as never });
  if (c.tools)
    for (const toolName of TEAM_TOOL_NAMES) add({ slot: "tool-renderer", toolName, Component: TeamToolRenderer as never });
    return reg;
}

const primitives = createHostPrimitiveRegistry();

/** The site owns the theme switch; seed ThemeProvider's stored preference from it so mounting never flips it. */
function seedThemeFromSite() {
  try {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    localStorage.setItem("dashboard:theme", light ? "light" : "dark");
  } catch {
    /* storage may be unavailable in a sandboxed frame */
  }
}

export function MockHost({ claims, sessions = SESSIONS, children }: { claims: HostClaims; sessions?: DashboardSession[]; children: ReactNode }) {
  const registry = useMemo(() => {
    seedThemeFromSite();
    return buildRegistry(claims);
    // biome-ignore lint/correctness/useExhaustiveDependencies: a pane's claims are fixed for its lifetime
  }, []);
  return (
    <UiPrimitiveProvider value={primitives}>
      <ThemeProvider>
        <PluginContextProvider registry={registry} sessions={sessions}>
          {children}
        </PluginContextProvider>
      </ThemeProvider>
    </UiPrimitiveProvider>
  );
}

// ---------------------------------------------------------------- sessions (real shapes)

function sess(id: string, name: string, extra: Record<string, unknown> = {}): DashboardSession {
  return {
    id,
    name,
    cwd: LEAD_CWD,
    source: "tui",
    status: "active",
    startedAt: T0 - 95 * 60_000,
    tokensIn: 184_000,
    tokensOut: 21_400,
    cost: 3.42,
    ...extra,
  } as DashboardSession;
}

const mateId = (n: string) => `7d1e${n.length.toString(16).padStart(2, "0")}b4-${n.charCodeAt(0).toString(16)}2c1-4f6a-8e0d-3a9b5c7e2f10`;

/** Top-level plugin-ref projection exactly as `session_updated` broadcasts it (design D6). */
export const LEAD = sess(LEAD_SESSION, "a11y-status-sweep", { "agent-teams-lead": { teamId: TEAM_ID } });
export const ALICE = sess(mateId("alice"), "alice · implementer", { "agent-teams": { teamId: TEAM_ID, member: "alice", role: "implementer" } });
export const SCOUT = sess(mateId("scout"), "scout · researcher", { "agent-teams": { teamId: TEAM_ID, member: "scout", role: "researcher" } });
export const PLAIN = sess("c21b6e90-3d4f-4a1b-8c55-0f7a2e9d4b36", "fix-login-redirect");
/** A cleared stamp: JSON-plain sentinel, must read as "no badge". */
export const CLEARED = sess("0a5e7c12-9b3d-4f60-a2e8-6d1c4b8f3a97", "old-lead (team closed)", { "agent-teams-lead": { teamId: null } });
export const SESSIONS: DashboardSession[] = [LEAD, ALICE, SCOUT, PLAIN];

const noop = () => {};

export function Card({ session, selectedId }: { session: DashboardSession; selectedId?: string }) {
  return <SessionCard session={session} selectedId={selectedId} onSelect={noop} now={T0} showGitInfo={false} isHidden={false} onArchive={noop} allSessions={SESSIONS} />;
}

// ---------------------------------------------------------------- shells

const SIDEBAR = { width: 280, collapsed: false, setWidth: noop, toggleCollapse: noop };

/**
 * Real desktop shell parts: `ResizableSidebar` + real `SessionCard`s beside the content region (same classes as
 * App.tsx). `selectedId` marks the session the route belongs to. `phone` drops the sidebar (the real mobile shell
 * hides it behind the hamburger) and keeps the content region.
 */
export function HostShell({ children, selectedId = LEAD_SESSION, phone, height = 640, sessions = SESSIONS }: { children: ReactNode; selectedId?: string; phone?: boolean; height?: number; sessions?: DashboardSession[] }) {
  const content = (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-testid="host-content">
      {children}
    </div>
  );
  if (phone)
    return (
      <div className="flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]" style={{ height }}>
        {content}
      </div>
    );
  return (
    <div className="flex bg-[var(--bg-primary)] text-[var(--text-primary)]" style={{ height }}>
      <div className="flex">
        <ResizableSidebar sidebar={SIDEBAR}>
          <ul className="m-0 flex w-[280px] list-none flex-col gap-2 overflow-y-auto bg-[var(--bg-primary)] p-2" data-testid="host-sidebar">
            {sessions.map((s) => (
              <Card key={s.id} session={s} selectedId={selectedId} />
            ))}
          </ul>
        </ResizableSidebar>
      </div>
      {content}
    </div>
  );
}

// ---------------------------------------------------------------- chat

const ctx = makeToolContext({ cwd: LEAD_CWD, sessionId: LEAD_SESSION });

export interface ChatRow {
  customType: string;
  body: string;
}

/** Real `ChatView` fed by reducer state: one user message, then the rows. Mail rows carry no `entryId` (design facts). */
export function ChatPane({ rows, user = "Start a team: alice builds the status table, scout collects real mail samples, bob reviews.", height = 560 }: { rows: ChatRow[]; user?: string; height?: number }) {
  const state = useMemo(() => {
    const s = createInitialState();
    s.messages.push({ id: "u1", role: "user", content: user, timestamp: T0 - 12 * 60_000 } as ChatMessage);
    // A row of customType `__user` is a human message between agent mail (a real conversation interleaves them).
    rows.forEach((r, i) =>
      s.messages.push(
        (r.customType === "__user"
          ? { id: `u${i}`, role: "user", content: r.body, timestamp: T0 - (10 - i) * 60_000 }
          : { id: `c${i}`, role: "custom", customType: r.customType, content: r.body, groupId: "other", timestamp: T0 - (10 - i) * 60_000 }) as ChatMessage,
      ),
    );
    return s;
    // biome-ignore lint/correctness/useExhaustiveDependencies: rows are fixed per pane
  }, []);
  return (
    <div className="flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]" style={{ height }}>
      <ChatView sessionId={LEAD_SESSION} state={state} toolContext={ctx} />
    </div>
  );
}

/** One custom row through the REAL `CustomEntryRow` container (claim lookup, fallback, error boundary). */
export function MailRow({ customType, body, timestamp }: ChatRow & { timestamp?: number }) {
  return <CustomEntryRow msg={{ id: "x", role: "custom", customType, content: body, groupId: "other", timestamp: timestamp ?? T0 } as ChatMessage} sessionId={LEAD_SESSION} />;
}

export interface ToolRow {
  toolName: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error" | "elided";
  result?: string;
  details?: Record<string, unknown>;
}

/** Real `ToolCallStep` rows. `expanded` clicks every row once so the claimed renderer body is visible. */
export function ToolRows({ rows, expanded = true }: { rows: ToolRow[]; expanded?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const open = () =>
      box.current?.querySelectorAll<HTMLButtonElement>('[data-testid="tool-call-step"] > div > button:first-child').forEach((b) => {
        if (b.dataset.mkOpen) return;
        b.dataset.mkOpen = "1";
        b.click();
      });
    const t = [setTimeout(open, 50), setTimeout(open, 400)];
    return () => t.forEach(clearTimeout);
  }, [expanded]);
  return (
    <div ref={box} className="flex flex-col gap-1.5 bg-[var(--bg-primary)] py-3 text-[var(--text-primary)]">
      {rows.map((r, i) => (
        <ToolCallStep
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
          key={i}
          toolName={r.toolName}
          toolCallId={`call-${i}`}
          args={r.args}
          status={r.status}
          result={r.result}
          context={ctx}
          startedAt={Date.now() - 42_000}
          duration={r.status === "running" ? undefined : 1800 + i * 90}
          toolDetails={r.details}
          showResultBody
        />
      ))}
    </div>
  );
}

/** Host APIs the real SessionCard / ChatView ask for, answered in-pane (never the network). Real shapes. */
export const hostFixtures = (): Fixtures => ({
  http: {
    "GET /api/acp/agents": () => [],
    "GET /api/openspec/config": () => ({ success: true, data: DEFAULT_OPENSPEC_CONFIG }),
  },
});
