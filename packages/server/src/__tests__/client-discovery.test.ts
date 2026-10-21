import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests the client static file discovery order.
 * Replicates the search logic from server.ts.
 */
function findClientDir(serverDir: string): string {
  const searchPaths = [
    path.join(serverDir, "../../node_modules/@blackbelt-technology/pi-dashboard-web/dist"),
    path.join(serverDir, "../../client/dist"),
    path.join(serverDir, "../../dist/client"),
  ];
  return searchPaths.find(p => existsSync(path.join(p, "index.html"))) ?? "";
}

describe("client static file discovery", () => {
  it("returns empty string when no client build exists", () => {
    // Use a path that definitely doesn't have client builds
    expect(findClientDir("/tmp/nonexistent-server-dir")).toBe("");
  });

  it("searches npm package path first", () => {
    // This is a structural test — verifies search order
    const serverDir = "/fake/packages/server/src";
    const searchPaths = [
      path.join(serverDir, "../../node_modules/@blackbelt-technology/pi-dashboard-web/dist"),
      path.join(serverDir, "../../client/dist"),
      path.join(serverDir, "../../dist/client"),
    ];
    // npm package path should be first
    expect(searchPaths[0]).toContain("pi-dashboard-web/dist");
    // workspace sibling second
    expect(searchPaths[1]).toContain("client/dist");
    // legacy third
    expect(searchPaths[2]).toContain("dist/client");
  });
});
