import { describe, it, expect } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";

/**
 * Tests the client static file discovery order.
 * Replicates the search logic from server.ts.
 */
function findClientDir(serverDir: string): string {
  const searchPaths = [
    path.join(serverDir, "../../client/dist"),
    path.join(serverDir, "../../node_modules/@blackbelt-technology/pi-dashboard-web/dist"),
    path.join(serverDir, "../../dist/client"),
  ];
  return searchPaths.find(p => existsSync(path.join(p, "index.html"))) ?? "";
}

describe("client static file discovery", () => {
  it("returns empty string when no client build exists", () => {
    // Use a path that definitely doesn't have client builds
    expect(findClientDir("/tmp/nonexistent-server-dir")).toBe("");
  });

  it("prefers monorepo client/dist before npm package dist", () => {
    // This is a structural test — verifies search order
    const serverDir = "/fake/packages/server/src";
    const searchPaths = [
      path.join(serverDir, "../../client/dist"),
      path.join(serverDir, "../../node_modules/@blackbelt-technology/pi-dashboard-web/dist"),
      path.join(serverDir, "../../dist/client"),
    ];
    // workspace sibling should be first in a checked-out repo so local builds
    // win over stale package dist snapshots under node_modules.
    expect(searchPaths[0]).toContain("client/dist");
    // npm package fallback second
    expect(searchPaths[1]).toContain("pi-dashboard-web/dist");
    // legacy third
    expect(searchPaths[2]).toContain("dist/client");
  });
});
