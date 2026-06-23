import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { MARKER_PATH, TEST_DOWN, USE_RUNNING } from "./lifecycle.js";

export default async function globalTeardown(): Promise<void> {
  // Fast path / not-managed: caller owns the container, leave it running.
  if (USE_RUNNING || !fs.existsSync(MARKER_PATH)) return;

  // test-down.sh re-derives the compose project from $PWD, so it MUST run from
  // the same workspace dir test-up.sh used as HOST_CWD (recorded in the marker).
  let workspace: string | undefined;
  try {
    workspace = JSON.parse(fs.readFileSync(MARKER_PATH, "utf8")).workspace;
  } catch {
    // best-effort: fall back to default cwd
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
