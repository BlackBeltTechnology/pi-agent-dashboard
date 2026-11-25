/**
 * Browser E2E glue of the Team UI (change: add-agent-teams-ui): a scriptable
 * in-page "server" for `GET/POST /api/plugins/agent-teams/**` through `page.route`
 * (fixture teams — the design's L3 source), snapshot builders and frame helpers.
 * The session itself is a real harness session (`spawnFreshGitSession`); only the
 * team data is fixtured. Port is never hardcoded (baseURL from the fixtures).
 * STATUS: written, not yet run (needs the docker harness).
 */
import type { Locator, Page } from "@playwright/test";

export const TEAMS_API = "/api/plugins/agent-teams";
export const EPOCH = "e2e-epoch";

export interface FixtureMember {
  name: string;
  status: string;
  cwd?: string;
  role?: string;
  model?: string;
  sessionId?: string;
}
export interface FixtureTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  blockedBy?: string[];
  blocked?: boolean;
  description?: string;
  result?: string;
}
export interface FixtureMail {
  id: number;
  from: string;
  to: string;
  kind?: string;
  text: string;
  priority?: "normal" | "urgent";
  createdAt?: number;
  ackedAt?: number;
}
export interface TeamState {
  id: string;
  name: string;
  status: string;
  rev: number;
  viewerCanControl: boolean;
  members: FixtureMember[];
  tasks: FixtureTask[];
  mail: FixtureMail[];
  mailTotal?: number;
  leadSessionId?: string;
}

/** The server's snapshot JSON for a fixture state (every optional field filled in). */
export function snapshotJson(s: TeamState): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    mode: "session",
    committer: "lead",
    leadConnected: true,
    ...(s.leadSessionId ? { leadSessionId: s.leadSessionId } : {}),
    leadCwd: "/fixtures/sample-git",
    rev: s.rev,
    createdAt: Date.now() - 60_000,
    epoch: EPOCH,
    viewerCanControl: s.viewerCanControl,
    members: s.members.map((m) => ({ cwd: "/fixtures/sample-git", ...m })),
    tasks: s.tasks.map((t) => ({ description: "", blockedBy: [], blocked: false, createdBy: "lead", createdAt: 0, ...t })),
    mail: s.mail.map((m) => ({ kind: "message", truncated: false, priority: "normal", wake: true, createdAt: Date.now() - 30_000, ...m })),
    mailTotal: s.mailTotal ?? s.mail.length,
    stats: { spawns: 0, claims: 0, claimConflicts: 0, deliveries: 0, queued: 0, urgentAborts: 0, rateLimited: 0 },
    persist_degraded: false,
  };
}

export function teamState(over: Partial<TeamState> = {}): TeamState {
  return {
    id: "t-e2e",
    name: "E2E team",
    status: "active",
    rev: 1,
    viewerCanControl: true,
    members: [
      { name: "alice", status: "busy" },
      { name: "bob", status: "idle" },
    ],
    tasks: [
      { id: "1", title: "First task", status: "completed" },
      { id: "2", title: "Second task", status: "in_progress", owner: "alice" },
      { id: "3", title: "Third task", status: "pending", blockedBy: ["2"], blocked: true },
    ],
    mail: [{ id: 1, from: "alice", to: "lead", text: "hello from alice" }],
    ...over,
  };
}

export interface RoutedTeams {
  state: TeamState | undefined;
  /** `GET /teams?sessionId=` answer: the team id, or `null` for "no team". */
  lookup: string | null;
  /** Control POST answer (`undefined` → 200/202 OK); a function may hang by never resolving. */
  post?: (url: string) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
  gets: string[];
  posts: string[];
}

type Fulfill = Parameters<Parameters<Page["route"]>[1]>[0];

const json = (route: Fulfill, status: number, body: unknown, headers: Record<string, string> = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });

async function answerPost(route: Fulfill, routed: RoutedTeams, pathname: string): Promise<void> {
  routed.posts.push(pathname);
  const shutdown = pathname.endsWith("/shutdown");
  const res = (await routed.post?.(pathname)) ?? { status: shutdown ? 202 : 200, body: shutdown ? { closing: true } : { aborted: true } };
  await json(route, res.status, res.body);
}

async function answerGet(route: Fulfill, routed: RoutedTeams, url: URL, ifNoneMatch: string | undefined): Promise<void> {
  routed.gets.push(url.pathname + url.search);
  const state = routed.state;
  if (url.searchParams.has("sessionId")) {
    const teams = routed.lookup && state ? [{ id: routed.lookup, name: state.name, status: state.status, rev: state.rev }] : [];
    return void (await json(route, 200, { teams, unavailable: [], persist_degraded: false }));
  }
  if (!state) return void (await json(route, 404, { error: "not_found" }));
  const etag = `"${EPOCH}:${state.rev}"`;
  if (ifNoneMatch === etag) return void (await route.fulfill({ status: 304, headers: { etag } }));
  await json(route, 200, snapshotJson(state), { etag });
}

/** Serve the team REST surface from `routed` (ETag/304 honoured, 404 when `state` is unset). */
export async function routeTeams(page: Page, routed: RoutedTeams): Promise<void> {
  await page.route(/\/api\/plugins\/agent-teams\/teams/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST") return answerPost(route, routed, url.pathname);
    return answerGet(route, routed, url, req.headers()["if-none-match"]);
  });
}

export function routed(state: TeamState | undefined, over: Partial<RoutedTeams> = {}): RoutedTeams {
  return { state, lookup: state ? state.id : null, gets: [], posts: [], ...over };
}

/** The session id of a session card (`data-session-id`). */
export async function sessionIdOf(card: Locator): Promise<string> {
  const id = await card.getAttribute("data-session-id");
  if (!id) throw new Error("session card has no data-session-id");
  return id;
}

/** `session_updated` frame that gives a session the lead (or teammate) team ref; `teamId: null` clears it. */
export function teamRefFrame(sessionId: string, teamId: string | null, kind: "lead" | "member" = "lead", member = "alice"): Record<string, unknown> {
  return { type: "session_updated", sessionId, updates: kind === "lead" ? { "agent-teams-lead": { teamId } } : { "agent-teams": { teamId, member } } };
}

/** The content-free `agent-teams:changed` frame of a lead session. */
export function changedFrame(leadSessionId: string, teamId: string, rev: number): Record<string, unknown> {
  return { type: "plugin_event", pluginId: "agent-teams", sessionId: leadSessionId, event: { eventType: "agent-teams:changed", timestamp: Date.now(), data: { teamId, epoch: EPOCH, rev } } };
}

export const teamViewUrl = (sessionId: string): string => `/session/${encodeURIComponent(sessionId)}/team`;
