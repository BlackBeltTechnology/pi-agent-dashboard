/**
 * Doctor row set: with every probe stubbed ok the shared report has no
 * "offline packages" row (the offline bundle is gone) and still carries the
 * "TypeScript loader" row (test-plan #E15).
 *
 * See change: cleanup-stale-fork-specs.
 */
import os from "node:os";
import { describe, expect, it } from "vitest";
import { runSharedChecks, type SharedChecksDeps } from "../doctor-core.js";

function okDeps(): SharedChecksDeps {
  return {
    managedDir: os.tmpdir(),
    detectSystemNode: () => ({ found: true, path: "/usr/bin/node" }),
    detectPi: () => ({ found: true, path: "/usr/bin/pi", source: "system" }),
    detectOpenSpec: () => ({ found: true, path: "/usr/bin/openspec", source: "system" }),
    dnsLookup: async () => undefined,
  };
}

describe("shared Doctor row set (E15)", () => {
  it("has a TypeScript loader row and no offline-packages row", async () => {
    const checks = await runSharedChecks(okDeps());
    expect(checks.some((c) => c.name === "TypeScript loader")).toBe(true);
    for (const c of checks) {
      expect(`${c.name} ${c.message}`, `row ${c.name}`).not.toMatch(/offline[ -]?(bundle|packages?)/i);
    }
  });
});
