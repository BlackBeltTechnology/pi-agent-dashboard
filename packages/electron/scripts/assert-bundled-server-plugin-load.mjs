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
 * It also enables EVERY bundled server-entry plugin (manifest ids from
 * `<bundle>/resources/plugins/<dir>/package.json`, fixtures excluded) and requires
 * `Loaded plugin "<id>"` for each, zero `Failed to load plugin`, zero
 * `Skipping plugin` — a plugin whose third-party dep is missing from the
 * bundle (gmail → oauth4webapi) no longer passes as long as browser loads.
 * `VERDICT_TIMEOUT_MS` is an IDLE budget: it restarts on every new verdict, so
 * 20 sequential activations are not squeezed into a budget sized for one.
 * See change: bundle-plugin-third-party-deps (design D5).
 *
 * Cross-platform and Node-native (no bash, no PowerShell): the same script runs
 * on every electron leg, matching the invariant pinned by
 * packages/shared/src/__tests__/no-bash-on-windows.test.ts.
 *
 * Paths are env-overridable for unit testing:
 *   SERVER_BUNDLE_DIR — built bundle root (default
 *                       <repo>/packages/electron/resources/server)
 *
 * Boots with the SELECTED TypeScript loader — the Node-native register by
 * default, jiti on `PI_DASHBOARD_TS_LOADER=jiti` — so the gate proves the
 * shipped default. See change: fix-appimage-cold-boot-latency (D4).
 *
 * Exit non-zero on any failed assertion. See change:
 * fix-browser-plugin-vendor-specifier-resolution (D4, X13).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ELECTRON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 2_000;
export const VERDICT_TIMEOUT_MS = 120_000;
const PLUGIN_ID = "browser";

/** The bundle root, honouring the test override. */
export function bundleRoot(env = process.env) {
  return env.SERVER_BUNDLE_DIR ? resolve(env.SERVER_BUNDLE_DIR) : join(ELECTRON_DIR, "resources", "server");
}

/**
 * The files the launch contract needs (node, the SELECTED loader, cli.ts), or
 * a list of what is missing. Mirrors `server-launch-helpers/start-server.sh`
 * and `node-spawn.ts::buildNodeImportArgvParts`. The shared package is a
 * materialized copy under `node_modules/@blackbelt-technology/` (bundle-server).
 */
export function bundleLayout(root, platform = process.platform, env = process.env) {
  const nodeBin = platform === "win32" ? join(root, "..", "node", "node.exe") : join(root, "..", "node", "bin", "node");
  const jiti = join(root, "node_modules", "jiti", "lib", "jiti-register.mjs");
  const native = join(root, "node_modules", "@blackbelt-technology", "pi-dashboard-shared", "src", "platform", "native-ts-register.mjs");
  const loaderKind = env.PI_DASHBOARD_TS_LOADER === "jiti" ? "jiti" : "native";
  const loader = loaderKind === "jiti" ? jiti : native;
  const cli = join(root, "packages", "server", "src", "cli.ts");
  const missing = [];
  if (!existsSync(loader)) missing.push(loader);
  if (!existsSync(cli)) missing.push(cli);
  return { nodeBin: existsSync(nodeBin) ? nodeBin : null, loaderKind, loader, jiti, cli, missing };
}

/**
 * `node` argv for the bundled CLI: `--import <loader URL> <entry> ...args`.
 * Entry is RAW for both loaders on every OS (mirrors `shouldUrlWrapEntry`):
 * Node `path.resolve()`s the main entry, so a `file://` entry breaks.
 */
export function bootArgv(layout, args, platform = process.platform) {
  // pathToFileURL percent-encodes `#`/spaces (a hand-built URL would cut at `#`);
  // `windows` picks the drive-letter form regardless of the host OS.
  const loaderUrl = pathToFileURL(layout.loader, { windows: platform === "win32" }).href;
  return ["--import", loaderUrl, layout.cli, ...args];
}

/**
 * The plugin-load contract stated in the bundle's server log. Pure, so the
 * verdict is unit-testable without an Electron build.
 */
export function pluginLoadProblems(logText, { plugin = PLUGIN_ID, plugins = [plugin] } = {}) {
  const problems = [];
  for (const id of plugins) {
    if (!logText.includes(`Loaded plugin "${id}"`)) problems.push(`log has no 'Loaded plugin "${id}"'`);
  }
  const lines = logText.split("\n");
  for (const marker of ["Failed to load plugin", "Skipping plugin"]) {
    const hits = lines.filter((l) => l.includes(marker));
    if (hits.length > 0) problems.push(`${hits.length} '${marker}' line(s), first: ${hits[0].trim()}`);
  }
  return problems;
}

/**
 * Manifest ids of the bundled plugins the loader will log a verdict for:
 * non-fixture plugins whose manifest declares a `server` entry (a server-less
 * plugin is marked loaded without any log line). Sorted.
 */
export function expectedServerPluginIds(pluginsDir) {
  if (!existsSync(pluginsDir)) return [];
  const ids = [];
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(pluginsDir, entry.name, "package.json"), "utf8"))["pi-dashboard-plugin"];
    } catch {
      continue;
    }
    if (manifest?.id && manifest.server && manifest.fixture !== true) ids.push(manifest.id);
  }
  return ids.sort();
}

/** Temp-HOME `config.json` enabling every id (several are `defaultEnabled: false`). */
export function gateConfig(ids) {
  return { plugins: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) };
}

/** Terminal loader verdict per id present in the log: loaded | failed | skipped. */
export function pluginVerdicts(logText, ids) {
  const verdicts = {};
  for (const id of ids) {
    if (logText.includes(`Loaded plugin "${id}"`)) verdicts[id] = "loaded";
    else if (logText.includes(`Failed to load plugin "${id}"`)) verdicts[id] = "failed";
    else if (logText.includes(`Skipping plugin "${id}"`)) verdicts[id] = "skipped";
  }
  return verdicts;
}

/**
 * Poll the log until every id has a verdict, or until `idleMs` passes with no
 * NEW verdict (the budget restarts whenever the verdict count grows).
 * Injectable clock/log for unit tests. Returns the last log text + ids still
 * lacking a verdict.
 */
export async function waitForVerdicts({
  ids,
  readLog,
  now = Date.now,
  sleep: wait = sleep,
  idleMs = VERDICT_TIMEOUT_MS,
  pollMs = HEALTH_POLL_MS,
}) {
  let text = readLog();
  let seen = Object.keys(pluginVerdicts(text, ids)).length;
  let lastProgress = now();
  while (seen < ids.length && now() - lastProgress < idleMs) {
    await wait(pollMs);
    text = readLog();
    const count = Object.keys(pluginVerdicts(text, ids)).length;
    if (count > seen) {
      seen = count;
      lastProgress = now();
    }
  }
  const verdicts = pluginVerdicts(text, ids);
  return { text, missing: ids.filter((id) => !(id in verdicts)) };
}

/**
 * The last `lines` lines of the server log, so a red gate shows WHY the plugin
 * never loaded instead of only that it did not. Pure for unit testing.
 */
export function logTail(text, lines = 80) {
  const trimmed = text.replace(/\n+$/, "");
  if (!trimmed) return "(server.log empty or missing)";
  return trimmed.split("\n").slice(-lines).join("\n");
}

/** Print the tail of the bundled server's log (before the temp HOME is removed). */
function dumpServerLog(home) {
  const log = join(home, ".pi", "dashboard", "server.log");
  const text = existsSync(log) ? readFileSync(log, "utf-8") : "";
  console.error(`── tail of ${log} ──`);
  console.error(logTail(text));
  console.error("── end of server.log ──");
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
async function bootAndReadVerdict({ root, layout, home, port, ids }) {
  mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });
  // `browser` (and others) are defaultEnabled:false; the gate is about whether
  // every bundled plugin CAN load, so all must be enabled or nothing would
  // ever attempt them.
  writeFileSync(join(home, ".pi", "dashboard", "config.json"), `${JSON.stringify(gateConfig(ids), null, 2)}\n`);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  // The whole point: the deleted stamp must not be smuggled in by the caller.
  delete env.JITI_TSCONFIG_PATHS;

  const argv = bootArgv(layout, ["start", "--port", String(port), "--pi-port", String(port + 1), "--no-tunnel"]);
  console.log(`booting the bundled server on :${port} (loader ${layout.loaderKind}: ${argv[1]})`);
  const boot = spawnSync(layout.nodeBin, argv, { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
  // A launch that never ran would otherwise surface only as a health timeout
  // minutes later, hiding the cause. The motivating case is real: on a
  // win32-arm64 leg whose x64-Node swap has not happened yet, the bundled ARM
  // Node cannot execute on the x64 runner.
  if (boot.error) throw new Error(`could not execute the bundled node at ${layout.nodeBin}: ${boot.error.message}`);

  try {
    await waitForHealth(port, globalThis.fetch);
  } catch (err) {
    // The launcher DETACHES the daemon, so a non-zero status is not a failure by
    // itself — but it is the first thing worth knowing when health never answers.
    throw new Error(`${err.message} (bundled launcher exit status ${boot.status}${boot.signal ? `, signal ${boot.signal}` : ""})`);
  }
  console.log("health 200");

  const log = join(home, ".pi", "dashboard", "server.log");
  const { text } = await waitForVerdicts({ ids, readLog: () => (existsSync(log) ? readFileSync(log, "utf-8") : "") });
  return text;
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), "electron-bundle-load-"));
  let layout;
  let port;
  try {
    const bundle = requireBundle();
    layout = bundle.layout;
    const ids = expectedServerPluginIds(join(bundle.root, "resources", "plugins"));
    // The browser premise (tsconfig-free specifier resolution) stays explicit.
    if (!ids.includes(PLUGIN_ID)) throw new Error(`plugin "${PLUGIN_ID}" is not in the bundle's resources/plugins/`);
    port = await freePort();
    const text = await bootAndReadVerdict({ root: bundle.root, layout, home, port, ids });

    const problems = pluginLoadProblems(text, { plugins: ids });
    for (const p of problems) console.error(`✗ ${p}`);
    if (problems.length > 0) {
      dumpServerLog(home);
      return 1;
    }
    console.log(`✓ bundled server: all ${ids.length} plugin(s) loaded (${ids.join(", ")}), zero 'Failed to load plugin' / 'Skipping plugin'`);
    return 0;
  } catch (err) {
    console.error(`✗ bundled server plugin-load gate failed: ${err.message}`);
    dumpServerLog(home);
    return 1;
  } finally {
    // Stop the detached daemon this HOME owns, then drop the temp state.
    if (layout) {
      // Scope the stop to THIS run's ports (fix-cli-stop-foreign-home-kill), on the selected loader.
      spawnSync(layout.nodeBin, bootArgv(layout, ["stop", ...(Number.isInteger(port) ? ["--port", String(port), "--pi-port", String(port + 1)] : [])]), {
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
