import fs from "node:fs";
import { MARKER, readMarker } from "./fixture.js";

/** Kill the mock site started by global-setup and remove its fixture project. */
export default async function mockSiteGlobalTeardown(): Promise<void> {
  if (!fs.existsSync(MARKER)) return;
  const { pid, root } = readMarker();
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(MARKER, { force: true });
}
