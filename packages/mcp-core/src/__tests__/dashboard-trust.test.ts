/**
 * Dashboard-only project trust in the MCP core (test-plan #E23 #E25).
 * See change: mirror-dashboard-trust-to-pi.
 */
import { describe, expect, it } from "vitest";
import type { PiMcpListRunner, ProjectTrustSource } from "../types.js";
import { CWD, GLOBAL, makeIO, makeService, PROJECT } from "./helpers.js";

const p = { kind: "project", cwd: CWD } as const;
const g = { kind: "global" } as const;

const PIN: ProjectTrustSource = { kind: "dashboard", sourceKind: "pinned", entry: CWD };
const PI: ProjectTrustSource = { kind: "recorded", path: CWD };

describe("#E23 global-write collisions keep pi-only trust", () => {
  const files = { [PROJECT]: { mcpServers: { docs: { command: "folder-docs" } } } };

  it("a dashboard-only-trusted folder's `docs` does not block a global `docs`-colliding write", () => {
    const svc = makeService(makeIO(files), { isProjectTrusted: () => true, projectTrustSource: () => PIN });
    expect(svc.saveServer("docs", { command: "g" }, g).ok).toBe(true);
    // The `-`/`_` namespace clash is a collision only through a pi-trusted folder.
    const io = makeIO({ [PROJECT]: { mcpServers: { "dev-radius": { command: "x" } } } });
    expect(makeService(io, { isProjectTrusted: () => true, projectTrustSource: () => PIN }).saveServer("dev_radius", { command: "y" }, g).ok).toBe(true);
  });

  it("a pi-trusted folder still collides", () => {
    const io = makeIO({ [PROJECT]: { mcpServers: { "dev-radius": { command: "x" } } } });
    const r = makeService(io, { isProjectTrusted: () => true, projectTrustSource: () => PI }).saveServer("dev_radius", { command: "y" }, g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("name-collision");
  });
});

describe("#E25 dashboard-only trust: active servers, live state 'not checked by pi'", () => {
  const files = {
    [GLOBAL]: { mcpServers: { gl: { command: "g" } } },
    [PROJECT]: { mcpServers: { folderSrv: { command: "f" } } },
  };
  // pi reads only its own trust store: the folder's server is absent from its list.
  const runner: PiMcpListRunner = async () => ({
    stdout: JSON.stringify({ servers: [{ name: "gl", state: "connected", tools: ["t"] }], errors: [] }),
    code: 0,
  });

  it("servers active, live state not-checked-by-pi with a note, source present", async () => {
    const svc = makeService(makeIO(files), { isProjectTrusted: () => true, projectTrustSource: () => PIN, coverInteractive: () => false, runner });
    const view = svc.getEffectiveView(p);
    expect(view.trusted).toBe(true);
    expect(view.trustSource).toEqual(PIN);
    expect(view.trustCoverInteractive).toBe(false);
    expect(view.servers.find((s) => s.name === "folderSrv")).toMatchObject({ active: true });
    const live = await svc.getLiveState(p, { fresh: true });
    expect(live.ok).toBe(true);
    if (live.ok) {
      expect(live.servers.folderSrv).toEqual({ state: "not-checked-by-pi", tools: 0 });
      expect(live.servers.gl.state).toBe("connected");
      expect(live.note).toMatch(/pi mcp list/);
    }
  });

  it("accessor absent → source omitted and live state is pi's own report", async () => {
    const svc = makeService(makeIO(files), { isProjectTrusted: () => true, runner });
    const view = svc.getEffectiveView(p);
    expect(view.trustSource).toBeUndefined();
    const live = await svc.getLiveState(p, { fresh: true });
    expect(live.ok && live.servers.folderSrv).toBeFalsy();
  });

  it("a pi-trusted folder keeps pi's own live state", async () => {
    const svc = makeService(makeIO(files), { isProjectTrusted: () => true, projectTrustSource: () => PI, runner });
    const live = await svc.getLiveState(p, { fresh: true });
    expect(live.ok && live.servers.folderSrv).toBeFalsy();
  });
});
