// The four tool-card families on the REAL `ToolCallStep`: lifecycle (TeamCreate, TeammateSpawn, TeamStatus,
// TeamDelete), SendMessage, task tools (TaskCreate, TaskList, TaskGet, TaskUpdate) and shutdown tools
// (ShutdownRequest, ShutdownResponse), each in running / success / error / elided / foreign-details states.
// Current = today (host generic tool renderer: raw args and a JSON result), Proposed = the lazy renderers through
// the real `tool-renderer` claim path. Rows are expanded through the host's own row click. Core today returns
// `details: { op }` plus the JSON result text; the "foreign details" rows use exactly that shape and a shape
// from another extension: the renderer must never go blank. Error text follows core's `describeError`.
// See change: add-agent-teams-ui (design D9; spec chat-rendering "Team tools"; tasks 1.6).
import { hostFixtures, MockHost, type ToolRow, ToolRows } from "../teams-host";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const json = (d: unknown) => JSON.stringify(d, null, 2);
const ok = (op: string, data: Record<string, unknown>) => ({ op, ok: true, ...data });
const fail = (op: string, error: string) => ({ op, ok: false, error });
const SENTENCE: Record<string, string> = {
  team_full: "the team already has the maximum number of live teammates",
  unknown_recipient: "there is no member with that name",
  already_claimed: "another member already claimed this task",
  not_lead: "only the lead can do this",
};
const err = (code: string) => `${code}: ${SENTENCE[code] ?? code.replace(/_/g, " ")}`;

const spawnArgs = { name: "carol", role: "tests", prompt: "Write the isTeamSession predicate tests under packages/agent-teams-plugin.", model: "anthropic/claude-sonnet-4-5" };
const spawnData = { member: { name: "carol", role: "tests", status: "spawning", model: "anthropic/claude-sonnet-4-5" } };

const lifecycle: ToolRow[] = [
  { toolName: "TeammateSpawn", args: spawnArgs, status: "running" },
  { toolName: "TeammateSpawn", args: spawnArgs, status: "complete", details: ok("TeammateSpawn", spawnData), result: json({ name: "carol", status: "spawning" }) },
  { toolName: "TeammateSpawn", args: spawnArgs, status: "error", details: fail("TeammateSpawn", "team_full"), result: err("team_full") },
  { toolName: "TeammateSpawn", args: spawnArgs, status: "error", details: fail("TeammateSpawn", "quota_exhausted_for_today"), result: "quota_exhausted_for_today: quota exhausted for today" },
  { toolName: "TeammateSpawn", args: spawnArgs, status: "elided" },
  { toolName: "TeammateSpawn", args: spawnArgs, status: "complete", details: { op: "TeammateSpawn" }, result: json({ name: "carol", status: "spawning" }) },
  { toolName: "TeammateSpawn", args: spawnArgs, status: "complete", details: { agent: "carol", runtime: "other-extension" }, result: "spawned carol (other extension)" },
  { toolName: "TeamCreate", args: { name: "a11y-status-sweep", maxTeammates: 5 }, status: "complete", details: ok("TeamCreate", { team: { name: "a11y-status-sweep", maxTeammates: 5, mode: "session" } }), result: json({ id: "t-7k2m9q" }) },
  { toolName: "TeamStatus", args: {}, status: "complete", details: ok("TeamStatus", { counts: { members: { busy: 3, idle: 1, spawning: 1, disconnected: 1 }, tasks: { pending: 6, in_progress: 3, completed: 3 } } }), result: json({ members: 9 }) },
  { toolName: "TeamDelete", args: { force: true }, status: "complete", details: ok("TeamDelete", { force: true }), result: json({ closed: true }) },
];

const msgArgs = { to: "bob", message: "Review the status-map table against the contract glyphs before you claim #6.\nTell me if a glyph clashes.", summary: "Review status-map" };
const message: ToolRow[] = [
  { toolName: "SendMessage", args: msgArgs, status: "running" },
  { toolName: "SendMessage", args: msgArgs, status: "complete", details: ok("SendMessage", { to: "bob", delivery: "delivered" }), result: json({ delivered: true }) },
  { toolName: "SendMessage", args: { to: "all", message: "Standup: write results into the task, not into mail.", priority: "urgent" }, status: "complete", details: ok("SendMessage", { to: "all", delivery: "queued" }), result: json({ queued: 2 }) },
  { toolName: "SendMessage", args: { to: "dan", message: "Hello?" }, status: "error", details: fail("SendMessage", "unknown_recipient"), result: err("unknown_recipient") },
  { toolName: "SendMessage", args: msgArgs, status: "elided" },
  { toolName: "SendMessage", args: msgArgs, status: "complete", details: { op: "SendMessage" }, result: json({ delivered: true }) },
];

const task = { id: "4", title: "Implement the status-map table (status to glyph, text, pill state)", status: "in_progress" };
const tasks: ToolRow[] = [
  { toolName: "TaskCreate", args: { title: "Review i18n key-set parity", blockedBy: ["9"] }, status: "complete", details: ok("TaskCreate", { task: { id: "10", title: "Review i18n key-set parity", blockedBy: ["9"] } }), result: json({ id: "10" }) },
  { toolName: "TaskList", args: { includeCompleted: false }, status: "complete", details: ok("TaskList", { tasks: [
    { id: "3", title: "Map every caller of the session-card-badge slot", status: "in_progress", owner: "scout", claimable: false },
    { id: "4", title: "Implement the status-map table", status: "in_progress", owner: "alice", claimable: false },
    { id: "9", title: "Draft the en, zh-CN and hu string tables", status: "pending", claimable: true },
    { id: "6", title: "Write the isTeamSession predicate tests", status: "pending", claimable: false },
  ] }), result: json([{ id: "3" }]) },
  { toolName: "TaskGet", args: { id: "4" }, status: "complete", details: ok("TaskGet", { task: { ...task, owner: "alice", blockedBy: ["1", "2"], description: "Build status-map.ts: one table, status to glyph, text key and pill state. No colour-only states. Record what the next person needs in the result." } }), result: json({ id: "4" }) },
  { toolName: "TaskUpdate", args: { id: "4", status: "in_progress" }, status: "running" },
  { toolName: "TaskUpdate", args: { id: "4", status: "completed", result: "status-map.ts done" }, status: "complete", details: ok("TaskUpdate", { task: { id: "4", title: "Implement the status-map table", from: "in_progress", to: "completed", owner: "alice" } }), result: json({ id: "4" }) },
  { toolName: "TaskUpdate", args: { id: "4", status: "in_progress" }, status: "error", details: fail("TaskUpdate", "already_claimed"), result: err("already_claimed") },
  { toolName: "TaskUpdate", args: { id: "4", status: "completed" }, status: "elided" },
  { toolName: "TaskUpdate", args: { id: "4", status: "completed" }, status: "complete", details: { op: "TaskUpdate" }, result: json({ id: "4", status: "completed" }) },
];

const shutdown: ToolRow[] = [
  { toolName: "ShutdownRequest", args: { to: "dave", reason: "Docs are done." }, status: "running" },
  { toolName: "ShutdownRequest", args: { to: "dave", reason: "Docs are done." }, status: "complete", details: ok("ShutdownRequest", {}), result: json({ requested: true }) },
  { toolName: "ShutdownRequest", args: { to: "dave" }, status: "error", details: fail("ShutdownRequest", "not_lead"), result: err("not_lead") },
  { toolName: "ShutdownRequest", args: { to: "dave" }, status: "elided" },
  { toolName: "ShutdownRequest", args: { to: "dave", reason: "Docs are done." }, status: "complete", details: { kind: "other" }, result: "ok" },
  { toolName: "ShutdownResponse", args: { approve: true }, status: "complete", details: ok("ShutdownResponse", { approve: true }), result: json({ approved: true }) },
  { toolName: "ShutdownResponse", args: { approve: false, reason: "I still hold an uncommitted rename in packages/shared." }, status: "complete", details: ok("ShutdownResponse", { approve: false }), result: json({ approved: false }) },
];

const pane = (claims: boolean, rows: ToolRow[]): ReactNode => (
  <MockHost claims={claims ? { tools: true } : {}}>
    <ToolRows rows={rows} expanded />
  </MockHost>
);
const A = (tip: string, n: ReactNode) => <Issue n={1} tip={tip} block>{n}</Issue>;
const B = (tip: string, n: ReactNode) => <Fix n={1} tip={tip} block>{n}</Fix>;

const frame = (title: string, why: string, rows: ToolRow[], width = 720) => ({
  title,
  width,
  why,
  current: A("Raw args, JSON result", pane(false, rows)),
  proposed: B("Structured card", pane(true, rows)),
});

const mock: Mock = {
  title: "Chat - team tool cards",
  category: "Agent teams",
  change: "add-agent-teams-ui",
  fixtures: hostFixtures,
  frames: [
    frame("Tool cards - lifecycle family", "TeammateSpawn in every state (running, success, error, unknown code, elided, `{op}` only, foreign), then create, status, delete.", lifecycle),
    frame("Tool cards - SendMessage", "Delivered, queued and urgent to everyone, unknown recipient, elided and foreign details.", message),
    frame("Tool cards - task tools", "Create, list, get and the TaskUpdate states, including an elided call and a result that fell back to text.", tasks),
    frame("Tool cards - shutdown tools", "Request in every state and the two answers: approve, and reject with a reason.", shutdown),
    {
      title: "Tool cards - phone",
      phone: true,
      why: "At 375px the structured body wraps; the elided and foreign rows stay readable.",
      current: A("Raw args, JSON result", pane(false, [lifecycle[1]!, lifecycle[2]!, lifecycle[4]!, lifecycle[5]!])),
      proposed: B("Structured card", pane(true, [lifecycle[1]!, lifecycle[2]!, lifecycle[4]!, lifecycle[5]!])),
    },
  ],
};
export default mock;
