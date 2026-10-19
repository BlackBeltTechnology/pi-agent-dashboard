import { describe, expect, it } from "vitest";
import { buildSpawnEnv, buildTmuxCommand } from "../spawn-process/process-manager.js";

/**
 * The generic pi settings page may show pi's TUI keys as ordinary rows, but the
 * dashboard never sets or overrides `tuiMode` for the sessions it starts.
 * See change: pi-settings-full-coverage (test-plan #E23, spec pi-api-feature-detection).
 */
describe("tmux spawn does not override tuiMode", () => {
  it("E23 neither the tmux argv nor the spawn env carries a tuiMode value", () => {
    const argv = buildTmuxCommand("/work/proj", false, undefined, ["pi"]);
    const env = buildSpawnEnv({ PATH: "/usr/bin:/bin" }, {});
    const haystack = [...argv, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)].join("\n");
    expect(haystack).not.toMatch(/tui[-_ ]?mode/i);
    expect(haystack).not.toMatch(/fullscreen/i);
  });
});
