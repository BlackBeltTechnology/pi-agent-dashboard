// @vitest-environment jsdom
/**
 * Team-controls configuration surface (tasks 8.1-8.4) — rendered panel.
 *
 * These assert what an OPERATOR SEES, complementing `surface.test.ts` (which
 * asserts what the builder decided). The pairing matters: the builder tests
 * prove the right facts are computed, these prove they survive to the screen —
 * notably that "cannot tell who can assign this" does not render as "nobody".
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSurfaceView } from "../../shared/types.js";

const handlers = new Map<string, (msg: unknown) => void>();
const sendMock = vi.fn(async (_msg: unknown) => {});
let configValue: Record<string, unknown> = {};

vi.mock("@blackbelt-technology/dashboard-plugin-runtime/context", () => ({
  usePluginConfig: () => configValue,
  usePluginSend: () => sendMock,
  usePluginMessage: (type: string, handler: (msg: unknown) => void) => {
    handlers.set(type, handler);
  },
}));

import { TeamControlsPanel } from "../team-controls-panel.js";

const SURFACE_MESSAGE = "chat_gateway_team_surface";
const CONFIG_MESSAGE = "chat_gateway_team_config";

function makeSurface(over: Partial<TeamSurfaceView> = {}): TeamSurfaceView {
  return {
    configured: true,
    disarmed: false,
    ceiling: "control",
    allowedRoots: ["/srv/ok"],
    bindings: [
      {
        workspaceId: "ws_1",
        workspaceName: "Project One",
        bound: true,
        ceiling: "control",
        mirrorLevel: "names-and-diffs",
        principals: [
          { id: "u_ann", tier: "observe" },
          { id: "u_bob", tier: "control" },
        ],
        roles: [
          {
            roleId: "r_ops",
            tier: "control",
            assigners: {
              kind: "assigners",
              members: [
                { id: "u_owner", name: "owner" },
                { id: "u_admin", name: "deputy" },
              ],
            },
          },
        ],
        folders: [
          { path: "/srv/ok/proj", inert: false },
          { path: "/home/private", inert: true },
        ],
        channelId: "c_9",
      },
    ],
    log: [],
    logLimit: 50,
    ...over,
  };
}

function push(over: Partial<TeamSurfaceView> = {}) {
  act(() => {
    handlers.get(SURFACE_MESSAGE)?.({ surface: makeSurface(over) });
  });
}

beforeEach(() => {
  handlers.clear();
  sendMock.mockClear();
  configValue = {};
});

afterEach(() => {
  cleanup();
});

describe("TeamControlsPanel (8.1)", () => {
  it("asks for the surface on mount", () => {
    render(<TeamControlsPanel />);
    expect(sendMock).toHaveBeenCalledWith({ type: SURFACE_MESSAGE });
  });

  it("renders bindings with principals, roles, ceiling and mirror level", () => {
    render(<TeamControlsPanel />);
    push();
    expect(screen.getByTestId("team-binding-ws_1")).toBeTruthy();
    expect(screen.getByTestId("team-binding-name-ws_1").textContent).toContain("Project One");
    expect(screen.getByTestId("team-principals-ws_1").textContent).toContain("u_bob");
    expect(screen.getByTestId("team-principals-ws_1").textContent).toContain("control");
    expect(screen.getByTestId("team-roles-ws_1").textContent).toContain("r_ops");
    // The binding's effective policy, not just the global one.
    expect(screen.getByTestId("team-binding-ws_1").textContent).toContain("names-and-diffs");
  });

  it("shows the disarm state and offers re-arm only when disarmed", () => {
    render(<TeamControlsPanel />);
    push({ disarmed: false });
    expect(screen.getByTestId("team-disarm-state").textContent).toContain("armed");
    expect(screen.queryByTestId("team-rearm")).toBeNull();

    push({ disarmed: true });
    expect(screen.getByTestId("team-disarm-state").textContent).toContain("DISARMED");
    expect(screen.getByTestId("team-rearm")).toBeTruthy();
  });

  it("re-arms by WRITING config from the dashboard, never via chat", () => {
    render(<TeamControlsPanel />);
    push({ disarmed: true });
    fireEvent.click(screen.getByTestId("team-rearm"));
    expect(sendMock).toHaveBeenCalledWith({
      type: CONFIG_MESSAGE,
      teamControls: { disarmed: false },
    });
  });

  it("keeps any existing team settings when re-arming", () => {
    configValue = { teamControls: { ceiling: "operate", auditRetention: 500 } };
    render(<TeamControlsPanel />);
    push({ disarmed: true });
    fireEvent.click(screen.getByTestId("team-rearm"));
    expect(sendMock).toHaveBeenCalledWith({
      type: CONFIG_MESSAGE,
      teamControls: { ceiling: "operate", auditRetention: 500, disarmed: false },
    });
  });

  it("flags an unbound binding instead of hiding it", () => {
    render(<TeamControlsPanel />);
    push({
      bindings: [
        {
          workspaceId: "ws_gone",
          bound: false,
          ceiling: "observe",
          mirrorLevel: "names-only",
          principals: [],
          roles: [],
          folders: [],
        },
      ],
    });
    expect(screen.getByTestId("team-binding-unbound-ws_gone")).toBeTruthy();
    expect(screen.getByTestId("team-binding-name-ws_gone").textContent).toContain("missing");
  });

  it("surfaces the provisioning problem and the fail-closed banner", () => {
    render(<TeamControlsPanel />);
    push({
      configError: "role_cannot_map_to_operate_requires_explicit_identifier at x",
      bindings: [
        {
          workspaceId: "ws_1",
          workspaceName: "One",
          bound: true,
          ceiling: "observe",
          mirrorLevel: "names-only",
          principals: [],
          roles: [],
          folders: [],
          problem: "provisioning_requires_guild_id",
        },
      ],
    });
    expect(screen.getByTestId("team-config-error").textContent).toContain("FAIL-CLOSED");
    expect(screen.getByTestId("team-binding-problem-ws_1").textContent).toContain(
      "provisioning_requires_guild_id",
    );
  });
});

describe("delegation disclosure (8.2, F1/F2)", () => {
  it("names the members who can assign a mapped role", () => {
    render(<TeamControlsPanel />);
    push();
    const text = screen.getByTestId("delegation-members-r_ops").textContent ?? "";
    expect(text).toContain("owner");
    expect(text).toContain("deputy");
  });

  it("states the list is unavailable and NAMES the missing permission", () => {
    render(<TeamControlsPanel />);
    push({
      bindings: [
        {
          workspaceId: "ws_1",
          workspaceName: "One",
          bound: true,
          ceiling: "control",
          mirrorLevel: "names-only",
          principals: [],
          roles: [
            {
              roleId: "r_ops",
              tier: "control",
              assigners: { kind: "unavailable", missingPermission: "Manage Roles" },
            },
          ],
          folders: [],
        },
      ],
    });
    const notice = screen.getByTestId("delegation-unavailable-r_ops");
    expect(notice.textContent).toContain("Manage Roles");
    // F2's actual requirement: never an empty list implying nobody holds it.
    expect(screen.queryByTestId("delegation-members-r_ops")).toBeNull();
  });

  it("distinguishes a genuinely empty roster from an unknown one", () => {
    render(<TeamControlsPanel />);
    push({
      bindings: [
        {
          workspaceId: "ws_1",
          workspaceName: "One",
          bound: true,
          ceiling: "control",
          mirrorLevel: "names-only",
          principals: [],
          roles: [{ roleId: "r_ops", tier: "control", assigners: { kind: "assigners", members: [] } }],
          folders: [],
        },
      ],
    });
    expect(screen.getByTestId("delegation-none-r_ops").textContent).toContain(
      "Nobody can assign this role",
    );
    expect(screen.queryByTestId("delegation-unavailable-r_ops")).toBeNull();
  });
});

describe("inert folders (8.3, F3)", () => {
  it("marks the folder outside allowedRoots inert and leaves the inside one unmarked", () => {
    render(<TeamControlsPanel />);
    push();
    expect(screen.getByTestId("team-folder-inert-ws_1-/home/private")).toBeTruthy();
    expect(screen.queryByTestId("team-folder-inert-ws_1-/srv/ok/proj")).toBeNull();
    const list = screen.getByTestId("team-folders-ws_1");
    expect(list.textContent).toContain("/srv/ok/proj");
    expect(list.textContent).toContain("/home/private");
  });
});

describe("command log view (8.4, F5)", () => {
  it("renders the entries in the order delivered (most-recent-first)", () => {
    render(<TeamControlsPanel />);
    push({
      log: [
        { at: 3, principal: "u_3", channelId: "c", verb: "abort", outcome: "permitted" },
        {
          at: 2,
          principal: "u_2",
          channelId: "c",
          verb: "send_prompt",
          outcome: "refused",
          reason: "disarmed",
        },
        { at: 1, principal: "u_1", channelId: "c", verb: "list_sessions", outcome: "permitted" },
      ],
    });
    const rows = screen.getAllByTestId("team-log-row");
    expect(rows.map((r) => r.querySelectorAll("td")[2].textContent)).toEqual([
      "abort",
      "send_prompt",
      "list_sessions",
    ]);
    // The refusal reason survives to the screen — a bare "refused" is not audit.
    expect(rows[1].textContent).toContain("disarmed");
  });

  it("says so when there is no activity rather than rendering an empty table", () => {
    render(<TeamControlsPanel />);
    push({ log: [] });
    expect(screen.getByTestId("team-log-empty")).toBeTruthy();
    expect(screen.queryByTestId("team-log")).toBeNull();
  });
});

describe("write reporting", () => {
  it("shows a refusal reason from the write lane", () => {
    render(<TeamControlsPanel />);
    push({ disarmed: true });
    act(() => {
      handlers.get(CONFIG_MESSAGE)?.({ ok: false, reason: "reconcile_failed: boom" });
    });
    expect(screen.getByTestId("team-write-notice").textContent).toContain("reconcile_failed: boom");
  });

  it("adopts the refreshed surface the write returned", () => {
    render(<TeamControlsPanel />);
    push({ disarmed: true });
    act(() => {
      handlers.get(CONFIG_MESSAGE)?.({ ok: true, surface: makeSurface({ disarmed: false }) });
    });
    expect(screen.getByTestId("team-disarm-state").textContent).toContain("armed");
    expect(screen.queryByTestId("team-rearm")).toBeNull();
  });

  it("keeps the previous surface when a write is refused without one", () => {
    render(<TeamControlsPanel />);
    push({ disarmed: true });
    act(() => {
      handlers.get(CONFIG_MESSAGE)?.({ ok: false, reason: "ceiling_invalid at ceiling" });
    });
    // A refused write changed nothing, so the panel must not blank itself.
    expect(screen.getByTestId("team-binding-ws_1")).toBeTruthy();
    expect(screen.getByTestId("team-disarm-state").textContent).toContain("DISARMED");
  });
});
