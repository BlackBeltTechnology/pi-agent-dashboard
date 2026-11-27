/**
 * `/agent-team` — start a team from a template in the CURRENT session (design D3, tasks 3.9, 3.10).
 *   /agent-team start <template> <goal…>   make this session the lead of a new templated team
 *   /agent-team templates                  list this folder's templates (source, validity, trust)
 * The handler never throws (pi does not surface a command's outcome to the dashboard): every result and
 * error goes through `ctx.ui.notify`. `start` sends `team.start` through the request lane (the server takes
 * the cwd from the session record, never from here), registers the lead tool set exactly like `TeamCreate`
 * (`ctx.becomeLead`), delivers the playbook as an `agent-teams-playbook` steer message that starts the turn,
 * handles `hooks_untrusted` with one `ctx.ui.confirm` (retrying with the shown hash), and reports an
 * ignored `lead.model` once. Argument completion serves subcommands and cached template names.
 * See change: add-agent-teams-templates-hooks.
 */
import { CUSTOM_TYPE_PLAYBOOK, MAIL_KIND_PLAYBOOK } from "../shared/approval-mail.js";
import { formatMail } from "../shared/mail-format.js";
import type { HooksUntrustedDetails, TeamStartResult, TeamTemplatesResult, TemplateSummary } from "../shared/protocol.js";
import type { BridgeContext } from "./context.js";
import { describeError, type LaneResult } from "./lane.js";

const SUBCOMMANDS: ReadonlyArray<readonly [name: string, description: string]> = [
  ["start", "start <template> <goal> — become the lead of a team built from a template"],
  ["templates", "list the team templates available in this folder"],
];
const USAGE = "usage: /agent-team start <template> <goal>  ·  /agent-team templates";
/** How long a template-name cache serves completions before one background refresh. */
const CACHE_TTL_MS = 10_000;

type Level = "info" | "warning" | "error";
// biome-ignore lint/suspicious/noExplicitAny: pi's command context differs per host version; only the used members are touched
type CommandContext = any;

function notify(cmd: CommandContext, message: string, level: Level = "info"): void {
  try {
    cmd?.ui?.notify?.(message, level);
  } catch {
    // a notify that throws must never break the handler
  }
}

/** `start` arguments: the first word is the template, the rest the goal (one pair of outer quotes is dropped). */
function parseStart(rest: string): { template: string; goal: string } | undefined {
  const m = /^(\S+)\s+([\s\S]+)$/.exec(rest.trim());
  if (!m) return undefined;
  let goal = (m[2] as string).trim();
  const q = goal[0];
  if (goal.length >= 2 && (q === '"' || q === "'") && goal.endsWith(q)) goal = goal.slice(1, -1).trim();
  return goal === "" ? undefined : { template: m[1] as string, goal };
}

function describeTemplate(t: TemplateSummary): string {
  const state = !t.trusted ? "untrusted project" : t.valid ? "ready" : `invalid: ${t.errors.map((e) => e.code).join(", ")}`;
  return `• ${t.name} [${t.source}] ${state}${t.description ? ` — ${t.description}` : ""}${t.hasHooks ? " (runs hooks)" : ""}`;
}

function hooksPrompt(d: HooksUntrustedDetails): string {
  const lines = d.commands.map((c) => `${c.event}: ${c.command}${c.timeoutMs !== undefined ? ` (timeout ${Math.round(c.timeoutMs / 1000)}s)` : ""}`);
  return `This project template runs these shell commands as you:\n\n${lines.join("\n")}\n\nAllow them for this project?`;
}

const hooksDetails = (res: { details?: Record<string, unknown> }): HooksUntrustedDetails | undefined => {
  const d = res.details;
  if (!d || typeof d.hash !== "string" || !Array.isArray(d.commands)) return undefined;
  return { hash: d.hash, commands: d.commands as HooksUntrustedDetails["commands"] };
};

export function registerAgentTeamCommand(ctx: BridgeContext): void {
  const { pi, lane, log } = ctx;
  if (typeof pi.registerCommand !== "function") return;
  let names: string[] = [];
  let fetchedAt = -Infinity;
  let refreshing: Promise<void> | undefined;

  /** Refresh the cached template names (never throws; one request at a time). */
  function refresh(): Promise<void> {
    refreshing ??= (async () => {
      try {
        const res = (await lane.call("team.templates", {})) as LaneResult<TeamTemplatesResult>;
        if (res.ok) names = res.data.templates.filter((t) => t.valid && t.trusted).map((t) => t.name);
      } catch (err) {
        log(`agent-teams: template completion refresh failed: ${(err as Error).message}`);
      } finally {
        fetchedAt = Date.now();
        refreshing = undefined;
      }
    })();
    return refreshing;
  }

  function complete(prefix: string): Array<{ value: string; label: string; description?: string }> | null {
    const text = prefix.replace(/^\s+/, "");
    const space = text.search(/\s/);
    if (space < 0) {
      const items = SUBCOMMANDS.filter(([n]) => n.startsWith(text)).map(([n, d]) => ({ value: n, label: n, description: d }));
      return items.length > 0 ? items : null;
    }
    if (text.slice(0, space) !== "start" || /\s/.test(text.slice(space).trim())) return null;
    const typed = text.slice(space).trim();
    const items = names.filter((n) => n.startsWith(typed)).map((n) => ({ value: `start ${n}`, label: n }));
    return items.length > 0 ? items : null;
  }

  async function listTemplates(cmd: CommandContext): Promise<void> {
    const res = (await lane.call("team.templates", {})) as LaneResult<TeamTemplatesResult>;
    if (!res.ok) return notify(cmd, `agent-team: ${describeError(res)}`, "error");
    names = res.data.templates.filter((t) => t.valid && t.trusted).map((t) => t.name);
    fetchedAt = Date.now();
    const lines = res.data.templates.map(describeTemplate);
    const warnings = (res.data.warnings ?? []).map((w) => `! ${w}`);
    notify(cmd, lines.length === 0 ? "No team templates here. Add one at .pi/teams/<name>.md or <pi agent dir>/teams/<name>.md." : [...lines, ...warnings].join("\n"));
  }

  /** The lead is made, the tools registered and the playbook delivered; failures after the team exists are reported, never thrown. */
  function begin(cmd: CommandContext, started: TeamStartResult): void {
    ctx.becomeLead();
    notify(cmd, `Started team "${started.name}" (${started.teamId}) — you are the lead.`);
    if (started.leadModelIgnored) notify(cmd, `lead.model (${started.leadModelIgnored}) applies only when the dashboard starts the team; this session keeps its model.`, "warning");
    if (started.playbook === undefined || started.playbook === "") return;
    try {
      pi.sendMessage?.(
        {
          customType: CUSTOM_TYPE_PLAYBOOK,
          content: formatMail({ kind: MAIL_KIND_PLAYBOOK, sender: "server", text: started.playbook }),
          display: true,
          details: { kind: MAIL_KIND_PLAYBOOK, from: "server" },
        },
        { deliverAs: "steer", triggerTurn: true },
      );
    } catch (err) {
      notify(cmd, `agent-team: the team started but its playbook could not be delivered (${(err as Error).message})`, "error");
    }
  }

  /** One `ctx.ui.confirm` showing the exact commands; a dialog that is absent, throws or is dismissed counts as "no". */
  async function confirmHooks(cmd: CommandContext, template: string, details: HooksUntrustedDetails): Promise<boolean> {
    try {
      return (await cmd?.ui?.confirm?.(`Run project hooks for "${template}"?`, hooksPrompt(details))) === true;
    } catch {
      return false;
    }
  }

  /** `team.start`; on `hooks_untrusted` ask once and retry with the shown hash (never loops). */
  async function startWithConfirmation(cmd: CommandContext, parsed: { template: string; goal: string }): Promise<LaneResult<TeamStartResult> | string> {
    const first = (await lane.call("team.start", parsed)) as LaneResult<TeamStartResult>;
    if (first.ok || first.error !== "hooks_untrusted") return first;
    const details = hooksDetails(first);
    if (!details) return "agent-team: the template runs hooks but their commands were not reported; nothing was started";
    if (!(await confirmHooks(cmd, parsed.template, details))) return "agent-team: cancelled — the hooks were not confirmed, nothing was started";
    return (await lane.call("team.start", { ...parsed, trustHooks: details.hash })) as LaneResult<TeamStartResult>;
  }

  async function start(cmd: CommandContext, rest: string): Promise<void> {
    const parsed = parseStart(rest);
    if (!parsed) return notify(cmd, `agent-team: a template and a goal are required — ${USAGE}`, "error");
    const res = await startWithConfirmation(cmd, parsed);
    if (typeof res === "string") return notify(cmd, res, res.includes("cancelled") ? "info" : "error");
    if (res.ok) return begin(cmd, res.data);
    if (res.error === "hash_mismatch") return notify(cmd, "agent-team: the hooks changed since they were shown; nothing was started — run the command again to review them", "error");
    notify(cmd, `agent-team: ${describeError(res)}`, "error");
  }

  pi.registerCommand("agent-team", {
    description: "Start a team from a template (start <template> <goal> | templates)",
    getArgumentCompletions: (prefix: string) => {
      try {
        const stale = Date.now() - fetchedAt > CACHE_TTL_MS;
        if (names.length === 0 && stale) return refresh().then(() => complete(prefix));
        if (stale) void refresh();
        return complete(prefix);
      } catch {
        return null;
      }
    },
    handler: async (args: string, cmd: CommandContext) => {
      try {
        const text = String(args ?? "").trim();
        const space = text.search(/\s/);
        const sub = space < 0 ? text : text.slice(0, space);
        const rest = space < 0 ? "" : text.slice(space + 1);
        if (sub === "start") await start(cmd, rest);
        else if (sub === "templates") await listTemplates(cmd);
        else notify(cmd, USAGE);
      } catch (err) {
        notify(cmd, `agent-team: ${(err as Error).message}`, "error");
      }
    },
  });
}
