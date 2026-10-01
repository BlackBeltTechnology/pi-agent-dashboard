import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { TEST_DOWN, USE_RUNNING } from "../lifecycle.js";
import { IDENTITY_MARKER_PATH } from "./identity-lifecycle.js";

export default async function identityGlobalTeardown(): Promise<void> {
  if (USE_RUNNING || !fs.existsSync(IDENTITY_MARKER_PATH)) return;

  let workspace: string;
  try {
    const marker = JSON.parse(fs.readFileSync(IDENTITY_MARKER_PATH, "utf8")) as {
      workspace?: unknown;
    };
    if (typeof marker.workspace !== "string" || marker.workspace.length === 0) {
      throw new Error("missing or invalid workspace");
    }
    workspace = marker.workspace;
  } catch (error) {
    throw new Error(
      `Cannot determine teardown workspace from ${IDENTITY_MARKER_PATH}; refusing fallback cwd.`,
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
    fs.rmSync(IDENTITY_MARKER_PATH, { force: true });
  }
}
