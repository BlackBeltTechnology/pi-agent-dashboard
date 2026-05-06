import { describe, it, expect } from "vitest";
import { isDeadlineOrChildExitError } from "../lib/server-error-classification.js";
import { buildServerStartupError } from "../lib/server-lifecycle.js";

// Drives the routing decision in main.ts after the retry loop was dropped.
// See change: tighten-electron-server-startup-deadline.

describe("isDeadlineOrChildExitError", () => {
  it("returns true for deadline-elapsed messages", () => {
    expect(
      isDeadlineOrChildExitError(
        "Server did not respond within 15 seconds (deadline 15000ms reached).",
      ),
    ).toBe(true);
  });

  it("returns true for child-exit messages", () => {
    expect(
      isDeadlineOrChildExitError(
        "Server child process exited prematurely (child exited with code 1).",
      ),
    ).toBe(true);
  });

  it("returns false for configuration / terminal failures", () => {
    expect(isDeadlineOrChildExitError("No TypeScript loader found (tsx or jiti).")).toBe(false);
    expect(isDeadlineOrChildExitError("Dashboard server CLI not found.")).toBe(false);
    expect(isDeadlineOrChildExitError("Port 8000 is in use by another service.")).toBe(false);
    expect(isDeadlineOrChildExitError("pi-dashboard CLI failed to spawn: ENOENT")).toBe(false);
  });

  it("returns false for non-string input", () => {
    expect(isDeadlineOrChildExitError(undefined as unknown as string)).toBe(false);
    expect(isDeadlineOrChildExitError(null as unknown as string)).toBe(false);
    expect(isDeadlineOrChildExitError({} as unknown as string)).toBe(false);
  });

  // Cross-check: the prefixes recognised here MUST match what
  // buildServerStartupError actually emits. This is the drift guard.
  it("recognises both prefixes that buildServerStartupError emits", () => {
    const childExit = buildServerStartupError({
      spawnBin: "node",
      spawnArgs: ["cli.ts"],
      cwd: "/tmp",
      logTail: "",
      readyError: "child exited with code 1",
    });
    expect(isDeadlineOrChildExitError(childExit.message)).toBe(true);

    const deadline = buildServerStartupError({
      spawnBin: "node",
      spawnArgs: ["cli.ts"],
      cwd: "/tmp",
      logTail: "",
      readyError: "deadline 15000ms reached",
    });
    expect(isDeadlineOrChildExitError(deadline.message)).toBe(true);
  });
});
