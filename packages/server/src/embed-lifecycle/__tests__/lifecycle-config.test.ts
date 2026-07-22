/**
 * Config off-by-default contract (test-plan #E22, task 7.1): the lifecycle
 * feature is disabled by default and every threshold is inert until an operator
 * opts in, so an upgrade never reaps/caps/reuses.
 * See change: add-embed-session-lifecycle.
 */
import {
  DEFAULT_EMBED_LIFECYCLE,
  loadConfig,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { describe, expect, it } from "vitest";

describe("embed lifecycle config", () => {
  it("is disabled by default", () => {
    expect(DEFAULT_EMBED_LIFECYCLE.enabled).toBe(false);
  });

  it("loadConfig leaves the feature dormant when no config.json exists", () => {
    // Tests run under a fresh mktemp HOME with no config.json → pure defaults.
    const cfg = loadConfig();
    expect(cfg.embedLifecycle.enabled).toBe(false);
    // Thresholds are present (so the reaper CAN be enabled) but inert while off.
    expect(cfg.embedLifecycle.idleTimeoutSeconds).toBeGreaterThan(0);
    expect(cfg.embedLifecycle.maxActiveEmbedSessionsGlobal).toBeGreaterThan(0);
  });
});
