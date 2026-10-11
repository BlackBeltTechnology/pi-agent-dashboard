/**
 * The config writer accepts a live request-scoped admission token instead of
 * re-running the SYNCHRONOUS guard (test-plan E19, E20).
 * See change: harden-plugin-cwd-admission.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  issueHeldAdmission,
  releaseAdmission,
} from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotAllowedCwdError } from "../config-writer.js";
import type { Scope } from "../types.js";
import { GLOBAL, json, makeIO, makeService } from "./helpers.js";

// Count every SYNC admission: the sync guard is the only sync git path here.
const sync = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/cwd-guard.js", async (orig) => {
  const real = await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/cwd-guard.js")>();
  return {
    ...real,
    isAllowedCwd: (...a: Parameters<typeof real.isAllowedCwd>) => {
      sync.calls += 1;
      return real.isAllowedCwd(...a);
    },
  };
});

let dir: string;
beforeEach(() => {
  sync.calls = 0;
  dir = realpathSync(mkdtempSync(join(tmpdir(), "mcp-writer-adm-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function tokenScope(cwd: string): Promise<Extract<Scope, { kind: "project" }>> {
  const held = issueHeldAdmission({ kind: "admit", canonCwd: cwd, cwd }, cwd);
  if (held.kind !== "admit") throw new Error("expected admit");
  return { kind: "project", cwd, admission: held.token };
}

const projectPath = (cwd: string) => `${cwd}/.pi/mcp.json`;

describe("writer + live reader honour a live admission token", () => {
  it("E19: saveServer and ensureServerEntry (two targetPath calls each) run no sync admission", async () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: {} } });
    // The cwd is NOT known: only the token admits it.
    const svc = makeService(io, { knownCwds: () => [] });
    const scope = await tokenScope(dir);
    expect(svc.saveServer("a", { command: "a" }, scope)).toEqual({ ok: true });
    expect(svc.ensureServerEntry("b", { command: "b" }, scope)).toEqual({ ok: true });
    expect(json(io, projectPath(dir)).mcpServers.a).toEqual({ command: "a" });
    expect(json(io, projectPath(dir)).mcpServers.b).toEqual({ command: "b" });
    expect(sync.calls).toBe(0);
  });

  it("removeServer, setEnabled, convertAdapterLeftovers, getEffectiveView and getLiveState run no sync admission", async () => {
    const io = makeIO({ [projectPath(dir)]: { mcpServers: { a: { command: "a" } } } });
    const svc = makeService(io, {
      knownCwds: () => [],
      runner: async () => ({ stdout: JSON.stringify({ servers: [], errors: [] }), code: 0 }),
    });
    const scope = await tokenScope(dir);
    svc.setEnabled("a", false, scope);
    svc.convertAdapterLeftovers("a", scope);
    svc.getEffectiveView(scope);
    await svc.getLiveState(scope, {});
    svc.removeServer("a", scope);
    expect(sync.calls).toBe(0);
  });

  it("E20: a released token falls back to the sync guard, which refuses an unpinned cwd", async () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: {} } });
    const svc = makeService(io, { knownCwds: () => [] }); // /repo unpinned
    const scope = await tokenScope(dir);
    releaseAdmission(scope.admission as never);
    expect(() => svc.saveServer("a", { command: "a" }, scope)).toThrow(NotAllowedCwdError);
    expect(sync.calls).toBeGreaterThan(0);
    expect(io.writes).toEqual([]);
  });

  it("a token bound to a different cwd string is not honoured", async () => {
    const io = makeIO({ [GLOBAL]: { mcpServers: {} } });
    const svc = makeService(io, { knownCwds: () => [] });
    const scope = await tokenScope(dir);
    expect(() => svc.saveServer("a", { command: "a" }, { ...scope, cwd: `${dir}/other` })).toThrow(NotAllowedCwdError);
  });
});
