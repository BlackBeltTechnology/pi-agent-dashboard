import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIST_ONLY_MARKER } from "./dist-only-lifecycle.js";

/** Stop the bootstrapped dist-only server and remove its prefix. A no-op when global-setup only attached. */
export default async function distOnlyGlobalTeardown(): Promise<void> {
  if (!fs.existsSync(DIST_ONLY_MARKER)) return;
  const { prefix, binDir } = JSON.parse(fs.readFileSync(DIST_ONLY_MARKER, "utf8")) as { prefix: string; binDir: string };
  const env = { ...process.env, HOME: prefix, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
  spawnSync("pi-dashboard", ["stop"], { env, stdio: "ignore" });
  if (!process.env.QA_PREFIX_KEEP) fs.rmSync(prefix, { recursive: true, force: true });
  fs.rmSync(DIST_ONLY_MARKER, { force: true });
}
