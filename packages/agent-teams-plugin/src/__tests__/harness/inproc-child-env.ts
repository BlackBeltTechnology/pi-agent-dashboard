/**
 * Server side of an in-process child under test: the REAL server runtime over the fake host with one in-process team (lead
 * `S-lead`), a scripted fake lead bridge that acknowledges `spawn`/`stop`, and `spawn(name, args)` = a real `TeammateSpawn` so the
 * command carries what the server really builds (`ResolvedSpawnSpec` with the policy env, tools, the member's `proxyToken`).
 * `extensionOf(name)` builds the REAL child team extension (`createChildTeamExtension`) over a transport that reaches the server's
 * real request-lane handlers on the lead's socket with `as {member, token}` — the only identity a child has.
 * See change: add-agent-teams-in-process.
 */
import { createChildTeamExtension, createChildTransport } from "../../bridge/inproc-child.js";
import type { ChildIdentity } from "../../bridge/inproc-command.js";
import type { InProcSpawnSpec, SpawnCommand } from "../../shared/inproc-protocol.js";
import type { SubagentsFeature } from "../../shared/subagents-contract.js";
import type { Member, Team } from "../../shared/types.js";
import { type InProcLink, linkInProcBridge } from "./inproc-link.js";
import { createTeamsEnv, type TeamsEnv } from "./teams-env.js";

export interface ChildWorld {
  env: TeamsEnv;
  link: InProcLink;
  team: Team;
  /** Real `TeammateSpawn` as the lead; the result and the command the server emitted. */
  spawn(name: string, args?: Record<string, unknown>): Promise<{ result: { ok: boolean; error?: string; message?: string }; command?: SpawnCommand }>;
  /** Lane requests made as the child (`type`, payload without `as`), in order. */
  requests: Array<{ type: string; payload: Record<string, unknown> }>;
  tokenOf(member: string): string;
  member(name: string): Member;
  identityOf(name: string): ChildIdentity;
  /** The real child extension of `name` (from its spawn command). */
  extensionOf(name: string, over?: { env?: Record<string, string | string[]> }): ReturnType<typeof createChildTeamExtension>;
  /** A transport as `name` (the same lane, optionally with a stale token). */
  transportOf(name: string, token?: string): ReturnType<typeof createChildTransport>;
}

export interface ChildWorldOptions {
  /** The lead session's cwd (default `/work`) — set before the team is created. */
  leadCwd?: string;
  /** Plugin config overrides (`extraCwdRoots`, `inProcessLeanChildren`, …). */
  config?: Record<string, unknown>;
  /** Features the scripted bridge reports in its `inproc hello` (default: the required ones + interrupt). */
  features?: readonly SubagentsFeature[];
}

export async function createChildWorld(opts: ChildWorldOptions = {}): Promise<ChildWorld> {
  const env = createTeamsEnv({ runtime: { inProcess: true }, ...(opts.config ? { config: opts.config } : {}) });
  if (opts.leadCwd) env.fake.addSession("S-lead", { cwd: opts.leadCwd, principalOwner: "owner-1" });
  const link = linkInProcBridge(env, { lead: "S-lead" });
  link.setOnCommand((cmd) => {
    if (cmd.cmd === "spawn") return { ack: { cmdId: cmd.cmdId, ok: true, childId: `bg-${cmd.member}`, agentId: `agent-${cmd.member}`, status: "running" } };
    if (cmd.cmd === "stop") return { ack: { cmdId: cmd.cmdId, ok: true } };
    return undefined;
  });
  await link.hello({ available: true, ...(opts.features ? { features: opts.features } : {}) });
  const created = await env.fake.call("S-lead", "TeamCreate", { name: "t", mode: "in-process" });
  if (!created.ok) throw new Error(`TeamCreate failed: ${created.error}`);
  const team = env.rt.store.get(created.data.teamId) as Team;
  const requests: ChildWorld["requests"] = [];
  const commands = new Map<string, SpawnCommand>();

  const member = (name: string): Member => env.rt.store.member(env.rt.store.get(team.id) as Team, name) as Member;
  const request = async (_plugin: string, type: string, payload: unknown) => {
    const { as: _as, ...rest } = payload as Record<string, unknown>;
    requests.push({ type, payload: rest });
    return { ok: true as const, result: await env.fake.lane("S-lead", type, payload) };
  };
  const world: ChildWorld = {
    env,
    link,
    team,
    requests,
    async spawn(name, args = {}) {
      const before = link.commands.length;
      const result = await env.fake.call("S-lead", "TeammateSpawn", { name, prompt: `task of ${name}`, ...args });
      await env.settle();
      const command = link.commands.slice(before).find((c): c is SpawnCommand & { secret: string } => c.cmd === "spawn" && c.member === name);
      if (command) commands.set(name, command);
      return { result: result as never, ...(command ? { command } : {}) };
    },
    tokenOf: (name) => member(name).proxyToken as string,
    member,
    identityOf(name) {
      const command = commands.get(name);
      if (!command) throw new Error(`no spawn command for ${name}`);
      return { teamId: team.id, member: name, token: command.proxyToken, env: command.spec.env };
    },
    transportOf: (name, token) => createChildTransport({ member: name, token: token ?? world.tokenOf(name) }, request as never),
    extensionOf(name, over = {}) {
      const identity = world.identityOf(name);
      return createChildTeamExtension(identity, world.transportOf(name, identity.token), over.env ?? (commands.get(name) as SpawnCommand).spec.env, { sleep: async () => undefined });
    },
  };
  return world;
}

