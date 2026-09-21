/**
 * Workspace-source cwd resolution + allowedRoots narrowing
 * (change: add-chat-gateway-team-controls). Scenarios: E19, E20, 10b.6, 10b.7.
 */
import { describe, expect, it } from "vitest";
import { inertWorkspaceFolders, resolveCwdWithWorkspace } from "../binding.js";

describe("resolveCwdWithWorkspace", () => {
  it("E20: persisted wins, and the workspace source precedes the fixed map", () => {
    const persisted = resolveCwdWithWorkspace({
      persisted: { cwd: "/srv/ok/persisted" },
      workspaceFolders: ["/srv/ok/ws"],
      fixedMap: { chan: "/srv/ok/fixed" },
      channelKey: "chan",
      defaultCwd: "/srv/ok/default",
      allowedRoots: ["/srv/ok"],
    });
    expect(persisted).toMatchObject({ kind: "resolved", source: "persisted" });

    const workspace = resolveCwdWithWorkspace({
      workspaceFolders: ["/srv/ok/ws"],
      fixedMap: { chan: "/srv/ok/fixed" },
      channelKey: "chan",
      defaultCwd: "/srv/ok/default",
      allowedRoots: ["/srv/ok"],
    });
    expect(workspace).toMatchObject({ kind: "resolved", source: "workspace" });
  });

  it("E19: an in-allowedRoots workspace folder resolves; an outside folder is inert", () => {
    const inside = resolveCwdWithWorkspace({
      workspaceFolders: ["/srv/ok/p", "/home/secret"],
      fixedMap: {},
      channelKey: "chan",
      allowedRoots: ["/srv/ok"],
    });
    expect(inside).toMatchObject({ kind: "resolved", source: "workspace" });
    if (inside.kind === "resolved") expect(inside.cwd).toBe("/srv/ok/p");

    const onlyInert = resolveCwdWithWorkspace({
      workspaceFolders: ["/home/secret"],
      fixedMap: {},
      channelKey: "chan",
      allowedRoots: ["/srv/ok"],
    });
    expect(onlyInert).toEqual({ kind: "refused", reason: "no_binding_source" });
  });

  it("falls through to fixedMap and default when the workspace yields nothing", () => {
    const fixed = resolveCwdWithWorkspace({
      workspaceFolders: [],
      fixedMap: { chan: "/srv/ok/fixed" },
      channelKey: "chan",
      allowedRoots: ["/srv/ok"],
    });
    expect(fixed).toMatchObject({ kind: "resolved", source: "fixed-map" });
  });

  it("reports inert folders for the configuration surface", () => {
    expect(inertWorkspaceFolders(["/srv/ok/p", "/home/secret"], ["/srv/ok"])).toEqual([
      "/home/secret",
    ]);
  });
});
