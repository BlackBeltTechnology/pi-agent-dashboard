/**
 * The bridge module seam (`BridgeContext`): payload fields, reply listeners, mail listeners and the
 * tool/role accessors modules use; the shipped stub modules change nothing.
 * See change: add-agent-teams-templates-hooks.
 */
import { describe, expect, it } from "vitest";
import { createTeamsEnv, flushAsync, linkBridge } from "../../__tests__/harness/index.js";
import { ENV_COMMITTER, ENV_MEMBER, ENV_POLICY, ENV_TEAM_ID } from "../../shared/policy.js";
import type { HelloReply, WireMail } from "../../shared/protocol.js";
import type { BridgeContext } from "../context.js";

describe("BridgeContext", () => {
  it("lets a module add hello payload fields, observe hello replies and delivered mail", async () => {
    const env = createTeamsEnv();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    env.fake.addSession("S-alice", { cwd: "/work" });
    env.fake.resolveSession("S-alice", { "agent-teams": { teamId: team.id, member: "alice", role: "member" } });
    const ext = (env.fake.base.spawns[0] as unknown as { scope: { extensionConfig: Record<string, Record<string, string>> } }).scope.extensionConfig["agent-teams"] as Record<string, string>;
    const replies: HelloReply[] = [];
    const mails: WireMail[] = [];
    let ctx: BridgeContext | undefined;
    const b = linkBridge(env, "alice", {
      env: { [ENV_TEAM_ID]: ext.teamId as string, [ENV_MEMBER]: ext.member as string, [ENV_POLICY]: ext.policy as string, [ENV_COMMITTER]: ext.committer as string },
      modules: [
        (c) => {
          ctx = c;
          c.hello.addPayload(() => ({ planToolsActive: true }));
          c.hello.onReply((r) => replies.push(r));
          c.onMail((m) => mails.push(m));
        },
      ],
    });
    expect(ctx?.role()).toBe("member");
    expect(ctx?.started()).toBe(false);
    expect(ctx?.tools.registered().length).toBeGreaterThan(0);
    await b.pi.fire("session_start", {});
    await flushAsync();
    expect(ctx?.started()).toBe(true);
    expect(b.requests.find((r) => r.type === "agent-teams/hello")?.payload).toMatchObject({ planToolsActive: true });
    expect(replies[0]).toMatchObject({ role: "member", teamId: team.id, member: "alice" });
    env.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: "hi", wake: false });
    await flushAsync();
    expect(mails.map((m) => m.kind)).toContain("notice");
  });

  it("a throwing module does not stop the bridge; the shipped stubs add no hello field", async () => {
    const env = createTeamsEnv();
    const bad = linkBridge(env, "lead", {
      modules: [
        () => {
          throw new Error("nope");
        },
      ],
    });
    expect(bad.pi.registerOrder).toContain("TeamCreate");
    const stock = linkBridge(env, "lead");
    await stock.pi.fire("session_start", {});
    await flushAsync();
    const hello = stock.requests.find((r) => r.type === "agent-teams/hello")?.payload as Record<string, unknown>;
    expect(hello).not.toHaveProperty("planToolsActive");
  });
});
