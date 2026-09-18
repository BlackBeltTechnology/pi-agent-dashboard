/**
 * Configuration surface (tasks 8.1-8.4) — the panel snapshot builder.
 *
 * These assert the DISPLAY RULES, not that a panel drew: the builder is the
 * only thing that decides what the operator sees, so an assertion here is worth
 * more than one on rendered markup. Scenarios F1-F5 of the test plan.
 */
import { describe, expect, it } from "vitest";
import { createCommandLog } from "../audit.js";
import {
  type BuildSurfaceInput,
  buildTeamSurface,
  type DelegationAnswer,
  type DelegationPort,
} from "../surface.js";
import { validateTeamControls } from "../team-config.js";
import type { WorkspaceView } from "../workspace.js";

const WORKSPACES: WorkspaceView[] = [
  { id: "ws_1", name: "Project One", folders: ["/srv/ok/proj", "/home/private"] },
];

/** A delegation port with a fixed answer per role. */
function delegationOf(answers: Record<string, DelegationAnswer>): DelegationPort {
  return {
    assignersForRole: (roleId) => answers[roleId] ?? { kind: "assigners", members: [] },
  };
}

const GRANTED_ROLE: DelegationAnswer = {
  kind: "assigners",
  members: [
    { id: "u_owner", name: "owner" },
    { id: "u_admin", name: "deputy" },
  ],
};

function makeInput(over: Partial<BuildSurfaceInput> = {}): BuildSurfaceInput {
  const parsed = validateTeamControls({
    guildId: "g_1",
    ceiling: "control",
    bindings: {
      ws_1: {
        principals: { u_bob: "control", u_ann: "observe" },
        roles: { r_ops: "control" },
        mirrorLevel: "names-and-diffs",
      },
    },
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return {
    config: parsed.value,
    workspaces: WORKSPACES,
    allowedRoots: ["/srv/ok"],
    log: createCommandLog({ limit: 100, now: () => 1 }),
    isDisarmed: false,
    delegation: delegationOf({ r_ops: GRANTED_ROLE }),
    ...over,
  };
}

describe("buildTeamSurface (8.1)", () => {
  it("renders principals, role map, ceiling, mirror level and the binding", async () => {
    const view = await buildTeamSurface(makeInput());
    expect(view.configured).toBe(true);
    expect(view.ceiling).toBe("control");
    const binding = view.bindings[0];
    expect(binding.workspaceId).toBe("ws_1");
    expect(binding.workspaceName).toBe("Project One");
    expect(binding.bound).toBe(true);
    expect(binding.mirrorLevel).toBe("names-and-diffs");
    // Principals are sorted by id so the panel order is stable across reads.
    expect(binding.principals).toEqual([
      { id: "u_ann", tier: "observe" },
      { id: "u_bob", tier: "control" },
    ]);
    expect(binding.roles[0]).toMatchObject({ roleId: "r_ops", tier: "control" });
  });

  it("passes through the ceiling of a binding that overrides the global one", async () => {
    const parsed = validateTeamControls({
      ceiling: "observe",
      bindings: { ws_1: { ceiling: "operate", principals: { u_bob: "observe" } } },
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    const view = await buildTeamSurface(makeInput({ config: parsed.value }));
    expect(view.ceiling).toBe("observe");
    expect(view.bindings[0].ceiling).toBe("operate");
  });

  it("shows team controls as unconfigured rather than failing", async () => {
    const view = await buildTeamSurface(makeInput({ config: undefined }));
    expect(view.configured).toBe(false);
    expect(view.bindings).toEqual([]);
    expect(view.ceiling).toBe("observe");
  });

  it("surfaces the fail-closed banner when config was rejected", async () => {
    const view = await buildTeamSurface(makeInput({ configError: "ceiling_invalid at ceiling" }));
    expect(view.configError).toBe("ceiling_invalid at ceiling");
  });

  it("retains a binding whose workspace no longer exists, marked unbound", async () => {
    // A vanished binding must be VISIBLE. Hiding it would make policy drift
    // invisible — the operator would see a clean panel over a live config entry.
    const view = await buildTeamSurface(makeInput({ workspaces: [] }));
    const binding = view.bindings[0];
    expect(binding.workspaceId).toBe("ws_1");
    expect(binding.bound).toBe(false);
    expect(binding.workspaceName).toBeUndefined();
    expect(binding.folders).toEqual([]);
  });

  it("reports the provisioned channel and the last provisioning problem", async () => {
    const view = await buildTeamSurface(
      makeInput({
        channelFor: (id) => (id === "ws_1" ? "c_9" : undefined),
        problemFor: () => "provisioning_requires_guild_id",
      }),
    );
    expect(view.bindings[0].channelId).toBe("c_9");
    expect(view.bindings[0].problem).toBe("provisioning_requires_guild_id");
  });
});

describe("delegation disclosure (8.2, F1/F2)", () => {
  it("names the members who can assign a mapped role", async () => {
    const view = await buildTeamSurface(makeInput());
    expect(view.bindings[0].roles[0].assigners).toEqual({
      kind: "assigners",
      members: [
        { id: "u_owner", name: "owner" },
        { id: "u_admin", name: "deputy" },
      ],
    });
  });

  it("names the MISSING PERMISSION when the platform cannot enumerate", async () => {
    const view = await buildTeamSurface(
      makeInput({
        delegation: delegationOf({
          r_ops: { kind: "unavailable", missingPermission: "Manage Roles" },
        }),
      }),
    );
    // F2: never an empty list. An empty `assigners` reads as "nobody can assign
    // this", which understates the delegation — the opposite of the truth.
    const assigners = view.bindings[0].roles[0].assigners;
    expect(assigners).toEqual({ kind: "unavailable", missingPermission: "Manage Roles" });
    expect(assigners).not.toMatchObject({ members: [] });
  });

  it("keeps 'nobody can assign this' distinct from 'cannot tell'", async () => {
    // A genuine empty roster is reported as such — the two states must not
    // collapse into the same rendering.
    const view = await buildTeamSurface(
      makeInput({ delegation: delegationOf({ r_ops: { kind: "assigners", members: [] } }) }),
    );
    expect(view.bindings[0].roles[0].assigners).toEqual({ kind: "assigners", members: [] });
  });

  it("queries delegation once per mapped role, not once per read", async () => {
    const seen: string[] = [];
    const view = await buildTeamSurface(
      makeInput({
        delegation: {
          assignersForRole: (roleId) => {
            seen.push(roleId);
            return GRANTED_ROLE;
          },
        },
      }),
    );
    expect(seen).toEqual(["r_ops"]);
    expect(view.bindings[0].roles).toHaveLength(1);
  });
});

describe("inert workspace folders (8.3, F3)", () => {
  it("marks a folder outside allowedRoots inert and leaves the inside one usable", async () => {
    const view = await buildTeamSurface(makeInput());
    expect(view.bindings[0].folders).toEqual([
      { path: "/srv/ok/proj", inert: false },
      { path: "/home/private", inert: true },
    ]);
  });

  it("echoes allowedRoots so the panel can explain WHY a folder is inert", async () => {
    const view = await buildTeamSurface(makeInput({ allowedRoots: ["/srv/ok", "/srv/two"] }));
    expect(view.allowedRoots).toEqual(["/srv/ok", "/srv/two"]);
  });
});

describe("command log view (8.4, F5)", () => {
  function logWithThree() {
    const log = createCommandLog({ limit: 100, now: () => 0 });
    log.append({ at: 1, principal: "u_1", channelId: "c", verb: "list_sessions", outcome: "permitted" });
    log.append({ at: 2, principal: "u_2", channelId: "c", verb: "send_prompt", outcome: "refused", reason: "disarmed" });
    log.append({ at: 3, principal: "u_3", channelId: "c", verb: "abort", outcome: "permitted" });
    return log;
  }

  it("returns entries most-recent-first", async () => {
    const view = await buildTeamSurface(makeInput({ log: logWithThree() }));
    expect(view.log.map((e) => e.verb)).toEqual(["abort", "send_prompt", "list_sessions"]);
    expect(view.log.map((e) => e.at)).toEqual([3, 2, 1]);
  });

  it("carries the refusal reason so the log explains itself", async () => {
    const view = await buildTeamSurface(makeInput({ log: logWithThree() }));
    expect(view.log[1]).toMatchObject({ outcome: "refused", reason: "disarmed" });
  });

  it("bounds the view and reports the bound", async () => {
    const view = await buildTeamSurface(makeInput({ log: logWithThree(), logLimit: 2 }));
    expect(view.log).toHaveLength(2);
    expect(view.logLimit).toBe(2);
    // The NEWEST two survive truncation.
    expect(view.log.map((e) => e.at)).toEqual([3, 2]);
  });

  it("omits absent optional fields rather than emitting undefined", async () => {
    const view = await buildTeamSurface(makeInput({ log: logWithThree() }));
    const newest = view.log[0];
    expect("reason" in newest).toBe(false);
    expect("tier" in newest).toBe(false);
    expect("threadId" in newest).toBe(false);
  });
});

describe("disarm state (8.1, F4)", () => {
  it("reports the live disarm state, not the config value", async () => {
    // Disarm is RUNTIME state: any observe+ principal can trip it from chat.
    // Reading it back from config would show a chat disarm as un-disarmed.
    const view = await buildTeamSurface(makeInput({ isDisarmed: true }));
    expect(view.disarmed).toBe(true);
    expect(view.configured).toBe(true);
  });

  it("distinguishes configured-and-armed from configured-and-disarmed", async () => {
    const armed = await buildTeamSurface(makeInput({ isDisarmed: false }));
    const tripped = await buildTeamSurface(makeInput({ isDisarmed: true }));
    expect([armed.configured, armed.disarmed]).toEqual([true, false]);
    expect([tripped.configured, tripped.disarmed]).toEqual([true, true]);
  });
});
