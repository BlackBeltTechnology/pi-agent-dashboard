import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { MARKER_PATH, TEST_DOWN, USE_RUNNING } from "./lifecycle.js";

export default async function globalTeardown(): Promise<void> {
  // Fast path / not-managed: caller owns the container, leave it running.
  if (USE_RUNNING || !fs.existsSync(MARKER_PATH)) return;

  try {
    execFileSync("bash", [TEST_DOWN], {
      stdio: "inherit",
      timeout: 120_000,
      killSignal: "SIGTERM",
    });
  } finally {
    fs.rmSync(MARKER_PATH, { force: true });
  }
}
