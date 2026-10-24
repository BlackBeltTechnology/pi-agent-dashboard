/**
 * FakeCraft fixture mount (add-craft-live-control D8, task 1.2): the test double of live agent control, a
 * static page-API app copied into the plugin data dir and run through the REAL post-install (shim + profile),
 * so a test exercises the same frame, CSP and protocol as a shipped app. Registered by `index.ts` ONLY when
 * `PI_DASHBOARD_FIXTURE_PLUGINS=1`; nothing here runs in a normal install.
 *
 * See change: add-craft-live-control (D8).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CraftAppId } from "@blackbelt-technology/pi-dashboard-craft-apps/registry.js";
import { FAKECRAFT_APP_ID, FAKECRAFT_PROFILE, FAKECRAFT_VERSION } from "../shared/fixture-profile.js";
import { createPostInstall } from "./post-install.js";
import { createShimVersionReader } from "./shim.js";

/** The only value that switches the fixture on (same flag as the core fixture-plugin gate). */
const FIXTURE_ENV = "PI_DASHBOARD_FIXTURE_PLUGINS";

/** `true` only for exactly `"1"`. */
export const fixtureEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env[FIXTURE_ENV] === "1";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/fakecraft", import.meta.url));

/**
 * Rebuild `<dataDir>/fakecraft-web/<version>-s<shim>` from the fixture sources (always fresh, so a shim change
 * is picked up on the next start) and point `current` at it. Returns `current`.
 */
export async function prepareFakecraft(dataDir: string, shimVersion: number = createShimVersionReader()()): Promise<string> {
  const root = path.join(dataDir, `${FAKECRAFT_APP_ID}-web`);
  const key = `${FAKECRAFT_VERSION}-s${shimVersion}`;
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(FIXTURE_DIR, path.join(root, key), { recursive: true });
  const hook = createPostInstall(undefined, { profile: (app) => (app === FAKECRAFT_APP_ID ? FAKECRAFT_PROFILE : undefined) });
  await hook({ dir: path.join(root, key), app: FAKECRAFT_APP_ID as CraftAppId, version: FAKECRAFT_VERSION, shimVersion });
  fs.symlinkSync(key, path.join(root, "current"));
  return path.join(root, "current");
}
