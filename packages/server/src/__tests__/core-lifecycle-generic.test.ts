/**
 * Static-inspection guard: core session-lifecycle branches name NO plugin.
 *
 * Covers test-plan E2 (both first-party features opt out symmetrically via the
 * identical generic field; no literal automation/goal lifecycle branch in core)
 * and validation V3 (no `=== "automation"` / `!== "automation"` lifecycle
 * branch remains in `session-meta.ts` / `pi-gateway.ts`).
 * See change: detach-automation-goal-from-core.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverSrc, "..", "..", "..");
const read = (rel: string) => readFileSync(path.resolve(repoRoot, rel), "utf8");

describe("core lifecycle branches are plugin-agnostic", () => {
  it("V3: no automation-keyed lifecycle branch in session-meta.ts or pi-gateway.ts", () => {
    const sessionMeta = read("packages/shared/src/session-meta.ts");
    const piGateway = read("packages/server/src/pi/pi-gateway.ts");
    for (const src of [sessionMeta, piGateway]) {
      expect(src).not.toMatch(/===\s*"automation"/);
      expect(src).not.toMatch(/!==\s*"automation"/);
    }
    // isRecoveryCandidate keys on the core-owned `recover` flag.
    expect(sessionMeta).toMatch(/meta\.recover\s*!==\s*false/);
    // The finalize branch keys on the declared lifecycle flag.
    expect(piGateway).toMatch(/finalizeOnSocketClose/);
  });

  it("E2: automation and goal both opt out via the identical generic recover flag", () => {
    // automation declares its lifecycle in the engine spawn call.
    const engine = read("packages/automation-plugin/src/server/engine.ts");
    expect(engine).toMatch(/lifecycle:\s*\{\s*recover:\s*false/);
    // goal declares the same flag at its plugin composition root (route spawn
    // + supervisor respawn) — the product relocated out of core in
    // relocate-goal-product-to-plugin (D3), so the declaration moved with it.
    const goalEntry = read("packages/goal-plugin/src/server/index.ts");
    const goalFiles = [...goalEntry.matchAll(/lifecycle:\s*\{\s*recover:\s*false\s*\}/g)];
    expect(goalFiles.length).toBeGreaterThanOrEqual(2); // spawnGoalSession + spawnDriver
  });
});
