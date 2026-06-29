/**
 * Unit test for the faux `echo-system-context` scenario's pure extraction.
 * Proves the faux provider surfaces the dashboard injector fragment (when
 * present) and a loud sentinel (when absent) — the deterministic core the
 * e2e spec asserts through the rendered DOM.
 * See change: inject-session-context-into-agent.
 */
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CONTEXT_DELIMITER,
  extractDashboardFragment,
  NO_DASHBOARD_CONTEXT_MARKER,
} from "../../../../qa/fixtures/faux-scenarios.js";

describe("extractDashboardFragment", () => {
  it("slices the fragment (delimiter → end) out of a system prompt", () => {
    const fragment = `${DASHBOARD_CONTEXT_DELIMITER}\nYou are pi session \`s1\` running in \`/tmp/x\`.`;
    const sp = `pi body...\nCurrent date: 2026-06-27\n${fragment}`;
    expect(extractDashboardFragment(sp)).toBe(fragment);
  });

  it("matches the LAST delimiter occurrence", () => {
    const sp = `${DASHBOARD_CONTEXT_DELIMITER}\nstale\n${DASHBOARD_CONTEXT_DELIMITER}\nfresh`;
    expect(extractDashboardFragment(sp)).toBe(`${DASHBOARD_CONTEXT_DELIMITER}\nfresh`);
  });

  it("returns the sentinel when no fragment present", () => {
    expect(extractDashboardFragment("no dashboard here")).toBe(NO_DASHBOARD_CONTEXT_MARKER);
    expect(extractDashboardFragment(undefined)).toBe(NO_DASHBOARD_CONTEXT_MARKER);
  });
});
