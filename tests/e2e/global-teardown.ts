import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { MARKER_PATH, TEST_DOWN, USE_RUNNING } from "./lifecycle.js";

export default async function globalTeardown(): Promise<void> {
  // Fast path / not-managed: caller owns the container, leave it running.
  if (USE_RUNNING || !fs.existsSync(MARKER_PATH)) return;

  // test-down.sh re-derives the compose project from $PWD, so it MUST run from
  // the same workspace dir test-up.sh used as HOST_CWD (recorded in the marker).
  let workspace: string;
  try {
    const marker = JSON.parse(fs.readFileSync(MARKER_PATH, "utf8")) as { workspace?: unknown };
    if (typeof marker.workspace !== "string" || marker.workspace.length === 0) {
      throw new Error("missing or invalid workspace");
    }
    workspace = marker.workspace;
  } catch (error) {
    // test-down.sh derives the compose project from $PWD; a wrong/undefined cwd
    // would target the wrong project and leak the managed harness. Fail loud.
    throw new Error(
      `Cannot determine teardown workspace from ${MARKER_PATH}; refusing fallback cwd.`,
      { cause: error as Error },
    );
  }

  try {
    execFileSync("bash", [TEST_DOWN], {
      cwd: workspace,
      stdio: "inherit",
      timeout: 120_000,
      killSignal: "SIGTERM",
    });
  } finally {
    fs.rmSync(MARKER_PATH, { force: true });
  }
}
