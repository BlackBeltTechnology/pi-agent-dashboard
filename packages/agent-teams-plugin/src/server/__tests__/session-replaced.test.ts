/**
 * Session replaced (test-plan S87, tasks 14.3): a teammate's pi process runs the RPC
 * command `new_session` — the session id changes inside the SAME process
 * (`session_shutdown` then `session_start`). The new id's `hello` gets `not_in_team`,
 * the bridge drops the team tools and the guard in that process, the member of the old id
 * ends → `gone` and its tasks are released.
 *
 * Why L1 and not `qa/tests/60-agent-teams-core.sh` as the row names: that L2 script cannot
 * drive this. The dashboard's `/new` spawns a SEPARATE session, and a server-spawned
 * teammate has no stdin to type a command into. A real faux `pi --mode rpc` process with
 * the REAL bridge entry against the REAL in-process runtime (`harness/real-pi-link.ts`)
 * is the closest faithful driver.
 * See change: add-agent-teams-core.
 */
import { describe, expect, it, vi } from "vitest";
import { createTeamsEnv, fauxPiAvailable, startRealPiLink } from "../../__tests__/harness/index.js";
import { GIT_WRITE_REASON } from "../../bridge/shell-guard.js";
import { systemClock } from "../../shared/clock.js";
import { LEAD_ONLY_TOOLS, TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";

/** Tools a teammate has and a plain session does not. */
const MEMBER_ONLY_TOOLS = TEAM_TOOLS_BY_ROLE.member.filter((t) => !TEAM_TOOLS_BY_ROLE.plain.includes(t));

describe.skipIf(!fauxPiAvailable())("session replaced (S87, real faux pi)", () => {
  it("new_session in the teammate process: not_in_team, tools and guard dropped in that process, old member gone, tasks released", async () => {
    const e = createTeamsEnv({ runtime: { clock: systemClock } });
    const link = await startRealPiLink(e);
    try {
      const team = await e.createTeam();
      expect(await e.call("lead", "TeammateSpawn", { name: "bob", prompt: "[[faux:plain-text]] stand by" })).toMatchObject({ ok: true });
      const [bob] = await link.started();
      if (!bob) throw new Error("no teammate process was started");
      const oldId = await link.untilSession(bob);
      await vi.waitFor(() => expect(e.member(team, "bob")).toMatchObject({ status: "idle", guardActive: true, sessionId: oldId }), { timeout: 20_000 });
      const task = e.rt.store.addTask(team.id, { title: "held by bob", description: "d", createdBy: "lead" });
      e.rt.store.patchTask(team.id, task?.id as string, { status: "in_progress", owner: "bob" });

      const probeTools = async (): Promise<string[]> => {
        const n = bob.probes.length;
        bob.proc.prompt("/at-probe");
        await vi.waitFor(() => expect(bob.probes.length).toBeGreaterThan(n), { timeout: 10_000 });
        return (bob.probes[bob.probes.length - 1] as { activeTools: string[] }).activeTools;
      };
      /** Run the git-write probe turn and return the bash tool result text. */
      const gitProbe = async (): Promise<string> => {
        const from = bob.proc.records.length;
        bob.proc.prompt("[[faux:agent-teams-guard-probe]] try a git commit");
        const end = await bob.proc.waitFor((r) => bob.proc.records.indexOf(r) >= from && r.type === "tool_execution_end" && r.toolName === "bash", 20_000);
        await bob.proc.waitFor((r) => bob.proc.records.indexOf(r) >= from && r.type === "agent_settled", 20_000);
        return JSON.stringify(end.result);
      };

      // Before: a member in the team — member tools active, the git-write guard refuses.
      const before = await probeTools();
      expect(before).toEqual(expect.arrayContaining([...TEAM_TOOLS_BY_ROLE.member]));
      expect(await gitProbe()).toContain(GIT_WRITE_REASON.slice(0, 30));

      // The session is replaced inside the same process.
      bob.proc.send({ type: "new_session" });
      const newId = await link.untilSession(bob, 2);
      expect(newId).not.toBe(oldId);

      // Server: the new id's hello was answered not_in_team; the old id ended → gone, tasks released.
      await vi.waitFor(() => expect(link.requests.find((r) => r.sessionId === newId && r.type === "agent-teams/hello")).toMatchObject({ reply: { ok: true, result: { ok: false, error: "not_in_team" } } }), { timeout: 10_000 });
      expect(bob.endedIds).toEqual([oldId]);
      expect(e.rt.store.findBySession(newId)).toBeUndefined();
      expect(e.member(team, "bob")).toMatchObject({ status: "gone", goneReason: "session ended" });
      expect(team.tasks[0]).toMatchObject({ status: "pending" });
      expect(team.tasks[0]?.owner).toBeUndefined();

      // Bridge, in that process: member-only tools dropped (plain ones stay), guard off.
      await vi.waitFor(async () => {
        const tools = await probeTools();
        for (const t of [...MEMBER_ONLY_TOOLS, ...LEAD_ONLY_TOOLS.filter((x) => !TEAM_TOOLS_BY_ROLE.plain.includes(x))]) expect(tools).not.toContain(t);
        expect(tools).toEqual(expect.arrayContaining([...TEAM_TOOLS_BY_ROLE.plain]));
      }, { timeout: 10_000 });
      const afterGit = await gitProbe();
      expect(afterGit).not.toContain(GIT_WRITE_REASON.slice(0, 30));
      expect(afterGit).toMatch(/not a git repository/);
    } finally {
      await link.close();
    }
  }, 90_000);
});
