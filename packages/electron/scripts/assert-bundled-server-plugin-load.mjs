#!/usr/bin/env node
/**
 * assert-bundled-server-plugin-load.mjs — built-bundle plugin-LOAD gate.
 *
 * Complements the sibling static asserts (`assert-runnable-bundle.mjs` proves
 * `cli.ts` exists; `assert-bundled-plugins-complete.mjs` proves every runtime
 * plugin is present). NEITHER boots anything, so neither can catch the failure
 * this gate exists for: the bundle has NO `tsconfig.base.json` (bundle-server.mjs
 * copies workspace source, not the repo tsconfig), so a plugin whose imports
 * need tsconfig `paths` or `JITI_TSCONFIG_PATHS` ships present-but-dead. That was
 * exactly the browser plugin's state before
 * change: fix-browser-plugin-vendor-specifier-resolution.
 *
 * So this BOOTS the bundled server with the flag explicitly removed and reads
 * its own log for `[plugin-loader] Loaded plugin "browser"`.
 *
 * Cross-platform and Node-native (no bash, no PowerShell): the same script runs
 * on every electron leg, matching the invariant pinned by
 * packages/shared/src/__tests__/no-bash-on-windows.test.ts.
 *
 * Paths are env-overridable for unit testing:
 *   SERVER_BUNDLE_DIR — built bundle root (default
 *                       <repo>/packages/electron/resources/server)
 *
 * Exit non-zero on any failed assertion. See change:
 * fix-browser-plugin-vendor-specifier-resolution (D4, X13).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ELECTRON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 2_000;
const VERDICT_TIMEOUT_MS = 120_000;
const PLUGIN_ID = "browser";

/** The bundle root, honouring the test override. */
export function bundleRoot(env = process.env) {
  return env.SERVER_BUNDLE_DIR ? resolve(env.SERVER_BUNDLE_DIR) : join(ELECTRON_DIR, "resources", "server");
}

/**
 * The three files the launch contract needs, or a list of what is missing.
 * Mirrors `server-launch-helpers/start-server.sh` and
 * `node-spawn.ts::buildNodeImportArgvParts`.
 */
export function bundleLayout(root, platform = process.platform) {
  const nodeBin = platform === "win32" ? join(root, "..", "node", "node.exe") : join(root, "..", "node", "bin", "node");
  const jiti = join(root, "node_modules", "jiti", "lib", "jiti-register.mjs");
  const cli = join(root, "packages", "server", "src", "cli.ts");
  const missing = [];
  if (!existsSync(jiti)) missing.push(jiti);
  if (!existsSync(cli)) missing.push(cli);
  return { nodeBin: existsSync(nodeBin) ? nodeBin : null, jiti, cli, missing };
}

/**
 * The plugin-load contract stated in the bundle's server log. Pure, so the
 * verdict is unit-testable without an Electron build.
 */
export function pluginLoadProblems(logText, { plugin = PLUGIN_ID } = {}) {
  const problems = [];
  if (!logText.includes(`Loaded plugin "${plugin}"`)) problems.push(`log has no 'Loaded plugin "${plugin}"'`);
  const failures = logText.split("\n").filter((l) => l.includes("Failed to load plugin"));
  if (failures.length > 0) {
    problems.push(`${failures.length} 'Failed to load plugin' line(s), first: ${failures[0].trim()}`);
  }
  return problems;
}

/** A port the OS says is free. */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(port, fetchImpl) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let last = "no attempt";
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err?.message ?? err);
    }
    await sleep(HEALTH_POLL_MS);
  }
  throw new Error(`/api/health never answered on :${port} (last: ${last})`);
}

/** The bundle's verified layout, or a thrown error naming what is wrong. */
function requireBundle() {
  const root = bundleRoot();
  if (!existsSync(root)) throw new Error(`bundled server not found at ${root} — run bundle-server.mjs first`);

  const layout = bundleLayout(root);
  if (layout.missing.length > 0) throw new Error(`missing from the bundle: ${layout.missing.join(", ")}`);
  if (!layout.nodeBin) throw new Error(`bundled node not found under ${join(root, "..", "node")}`);

  // No repo tsconfig ships in the bundle; assert the premise so a future
  // bundle-server change that starts copying one cannot silently weaken this.
  if (existsSync(join(root, "tsconfig.base.json"))) {
    throw new Error("tsconfig.base.json is present in the bundle — this gate would be green for the wrong reason");
  }
  return { root, layout };
}

/** Boot the bundled server and return its log text once a verdict appears. */
async function bootAndReadVerdict({ root, layout, home, port }) {
  mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });
  // `browser` is defaultEnabled:false; the gate is about whether it CAN load,
  // so it must be enabled or nothing would ever attempt it.
  writeFileSync(join(home, ".pi", "dashboard", "config.json"), `${JSON.stringify({ plugins: { [PLUGIN_ID]: { enabled: true } } }, null, 2)}\n`);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  // The whole point: the deleted stamp must not be smuggled in by the caller.
  delete env.JITI_TSCONFIG_PATHS;

  const argv = ["--import", pathToFileURL(layout.jiti).href, layout.cli, "start", "--port", String(port), "--pi-port", String(port + 1), "--no-tunnel"];
  console.log(`booting the bundled server on :${port}`);
  spawnSync(layout.nodeBin, argv, { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });

  await waitForHealth(port, globalThis.fetch);
  console.log("health 200");

  const log = join(home, ".pi", "dashboard", "server.log");
  const deadline = Date.now() + VERDICT_TIMEOUT_MS;
  let text = "";
  while (Date.now() < deadline) {
    text = existsSync(log) ? readFileSync(log, "utf-8") : "";
    if (text.includes(`Loaded plugin "${PLUGIN_ID}"`) || text.includes(`Failed to load plugin "${PLUGIN_ID}"`)) break;
    await sleep(HEALTH_POLL_MS);
  }
  return text;
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), "electron-bundle-load-"));
  let layout;
  try {
    const bundle = requireBundle();
    layout = bundle.layout;
    const text = await bootAndReadVerdict({ root: bundle.root, layout, home, port: await freePort() });

    const problems = pluginLoadProblems(text);
    for (const p of problems) console.error(`✗ ${p}`);
    if (problems.length > 0) return 1;
    console.log(`✓ bundled server: 'Loaded plugin "${PLUGIN_ID}"', zero 'Failed to load plugin'`);
    return 0;
  } catch (err) {
    console.error(`✗ bundled server plugin-load gate failed: ${err.message}`);
    return 1;
  } finally {
    // Stop the detached daemon this HOME owns, then drop the temp state.
    if (layout) {
      spawnSync(layout.nodeBin, ["--import", pathToFileURL(layout.jiti).href, layout.cli, "stop"], {
        cwd: bundleRoot(),
        env: { ...process.env, HOME: home, USERPROFILE: home },
        stdio: ["ignore", "ignore", "ignore"],
      });
    }
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
