import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _resetWslTmuxCacheForTests } from "../process-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Structural test: the WSL-tmux probe MUST have a module-scoped cache so it's
 * invoked at most once per server lifetime. Without this cache, users on
 * Windows without `wt.exe` pay the full WSL VM cold-start cost (1.5–30 s) on
 * every + Session click.
 *
 * We assert the cache exists by source inspection (tight, deterministic) and
 * that a reset helper is exported for tests.
 */
describe("WSL-tmux probe cache invariant", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../process-manager.ts"),
    "utf-8",
  );

  it("process-manager.ts declares _wslTmuxAvailabilityCache", () => {
    expect(src).toMatch(/let\s+_wslTmuxAvailabilityCache\s*:\s*boolean\s*\|\s*null\s*=\s*null/);
  });

  it("isWslTmuxAvailable() returns the cached value when non-null", () => {
    expect(src).toMatch(/if\s*\(\s*_wslTmuxAvailabilityCache\s*!==\s*null\s*\)\s*return\s+_wslTmuxAvailabilityCache/);
  });

  it("fallback-log fires at most once per server run", () => {
    expect(src).toMatch(/_wslFallbackLogged\s*=\s*true/);
    expect(src).toMatch(/if\s*\(\s*!_wslTmuxAvailabilityCache\s*&&\s*!_wslFallbackLogged\s*\)/);
  });

  it("exports a cache-reset helper for tests", () => {
    expect(typeof _resetWslTmuxCacheForTests).toBe("function");
    // reset is idempotent — safe to call repeatedly
    _resetWslTmuxCacheForTests();
    _resetWslTmuxCacheForTests();
  });
});
