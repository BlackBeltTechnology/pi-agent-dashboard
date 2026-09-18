/**
 * Team-controls controller (change: add-chat-gateway-team-controls).
 * Scenarios: E23 (one entry per action request; mirror is not an action),
 * X14 (disarm/rearm), X23 (distinct reasons), X16/X17 at the controller boundary.
 */
import { describe, expect, it } from "vitest";
import { createCommandLog } from "../audit.js";
import { createTeamController } from "../controller.js";
import { validateTeamControls } from "../team-config.js";
import type { WorkspaceView } from "../workspace.js";

const workspaces: WorkspaceView[] = [{ id: "ws_1", name: "Team", folders: ["/repo"] }];

function makeTeam(over: Record<string, unknown> = {}) {
  const validated = validateTeamControls({
    bindings: {
      ws_1: {
        principals: { alice: "control", dave: "operate", eve: "observe" },
        roles: { r1: "control" },
        mirrorLevel: "names-only",
      },
    },
    ceiling: "operate",
    ...over,
  });
  if (!validated.ok) throw new Error(validated.reason);
  const log = createCommandLog({ limit: 1_000 });
  const team = createTeamController({
    config: validated.value,
    log,
    listWorkspaces: () => workspaces,
    channelBindings: () => new Map([["chan1", "ws_1"]]),
    now: () => 1,
  });
  return { team, log };
}

describe("team controller", () => {
  it("grants a mapped control principal and logs one permitted entry", () => {
    const { team, log } = makeTeam();
    const result = team.authorizeRequest({
      author: { id: "alice" },
      channelId: "chan1",
      verb: "send_prompt",
      targetCwd: "/repo/proj",
    });
    expect(result).toMatchObject({ kind: "grant", tier: "control" });
    expect(log.size()).toBe(1);
    expect(log.entries()[0]).toMatchObject({ outcome: "permitted", verb: "send_prompt" });
  });

  it("E23: one entry per action-bearing request, none for a mirror", () => {
    const { team, log } = makeTeam();
    team.authorizeRequest({ author: { id: "alice" }, channelId: "chan1", verb: "send_prompt" });
    team.authorizeRequest({ author: { id: "nobody" }, channelId: "chan1", verb: "send_prompt" });
    team.noteMirror();
    expect(log.size()).toBe(2);
  });

  it("X23: different refusal causes record distinct reasons", () => {
    const { team, log } = makeTeam();
    team.authorizeRequest({ author: { id: "nobody" }, channelId: "chan1", verb: "send_prompt" });
    team.authorizeRequest({ author: { id: "dave" }, channelId: "chan1", verb: "mint_device_token" });
    const reasons = log.entries().map((e) => e.reason);
    expect(reasons).toEqual(["no_principal_mapping", "non_delegable_verb"]);
  });

  it("X14: any observe+ principal disarms; only the dashboard re-arms", () => {
    const { team } = makeTeam();
    team.disarm();
    expect(team.isDisarmed()).toBe(true);
    const refused = team.authorizeRequest({
      author: { id: "alice" },
      channelId: "chan1",
      verb: "send_prompt",
    });
    expect(refused).toMatchObject({ kind: "refusal", reason: "disarmed" });

    const chat = team.rearmFromChat();
    expect(chat.ok).toBe(false);
    expect(team.isDisarmed()).toBe(true);

    expect(team.rearmFromDashboard()).toBe(true);
    expect(team.isDisarmed()).toBe(false);
    expect(
      team.authorizeRequest({ author: { id: "alice" }, channelId: "chan1", verb: "send_prompt" }),
    ).toMatchObject({ kind: "grant" });
  });

  it("an unbound channel grants nothing and mirror level defaults to names-only", () => {
    const { team } = makeTeam();
    expect(
      team.authorizeRequest({ author: { id: "alice" }, channelId: "unknown", verb: "send_prompt" }),
    ).toMatchObject({ kind: "refusal", reason: "unbound_channel" });
    expect(team.mirrorLevel("chan1")).toBe("names-only");
  });
});
