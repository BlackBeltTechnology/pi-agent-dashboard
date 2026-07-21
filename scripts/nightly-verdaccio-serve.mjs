#!/usr/bin/env node
/**
 * nightly-verdaccio-serve.mjs — start an ephemeral Verdaccio as a detached
 * background service and block until it answers, then exit (leaving it
 * running for the rest of the workflow job).
 *
 * Cross-OS by construction: spawns via node's child_process with
 * `detached + unref + stdio:ignore`, so the registry survives into the
 * later bundle step on Linux/macOS/Windows without any shell-specific
 * backgrounding (`&` / `Start-Process`). No `shell: bash` — Windows-safe.
 *
 * Verdaccio must be installed first (`npm install -g verdaccio`).
 * Reads the config from `.github/verdaccio/config.yml`; listens on
 * `$REGISTRY` (default http://localhost:4873).
 *
 * See change: add-nightly-verdaccio-build.
 */

import { spawn } from "node:child_process";
import { get } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(REPO_ROOT, ".github", "verdaccio", "config.yml");
const REGISTRY = process.env.REGISTRY || "http://localhost:4873";
const PING = new URL("/-/ping", REGISTRY);
const TIMEOUT_MS = 90_000;
const INTERVAL_MS = 1_000;

function ping() {
  return new Promise((resolve) => {
    const req = get(PING, (res) => {
      res.resume();
      resolve(res.statusCode != null && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log(`Starting Verdaccio (config ${CONFIG}) → ${REGISTRY}`);
  // shell:true lets the `verdaccio` global bin resolve on PATH across OSes;
  // detached+unref+ignore keeps it alive after this process exits.
  const child = spawn(
    "verdaccio",
    ["--config", CONFIG, "--listen", REGISTRY],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore", shell: true },
  );
  child.unref();

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ping()) {
      console.log(`✓ Verdaccio is up at ${REGISTRY}`);
      return;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.error(
    `::error::Verdaccio did not become healthy at ${PING.href} within ${TIMEOUT_MS}ms`,
  );
  process.exit(1);
}

main();
