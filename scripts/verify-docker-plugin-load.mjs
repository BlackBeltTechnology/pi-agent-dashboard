#!/usr/bin/env node
/**
 * Required Docker gate (test-plan X12): build the image, boot the container, and
 * assert the browser plugin ACTUALLY LOADED inside it.
 *
 * WHY A BOOT, NOT A BUILD. The image is the one install mode that worked before
 * this change — but only through two crutches this change removes: the
 * entrypoint execs the wrapper, which stamped `JITI_TSCONFIG_PATHS`, and
 * `Dockerfile` copies `tsconfig.base.json` into the image. With both gone the
 * image must load the plugin the same way npm / managed / Electron now do:
 * package-relative specifiers and nothing else. A build that succeeds proves
 * nothing about resolution; only a boot does.
 *
 * The assertion reads the server's own log, because `loader.ts` reports both
 * outcomes there (`Loaded plugin "browser"` / `Failed to load plugin`) — the
 * same lines the operator saw when this was broken.
 *
 * Always tears the harness down (trap-equivalent `finally`), so a failed gate
 * cannot leak a 4 GiB container into the next job on a reused runner.
 *
 * See change: fix-browser-plugin-vendor-specifier-resolution (D4, X12).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./patch-vendor-specifiers.mjs";

const HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 2_000;
const VERDICT_TIMEOUT_MS = 180_000;
const VERDICT_POLL_MS = 2_000;

/**
 * The two terminal lines `loader.ts` emits for this plugin. Health 200 does NOT
 * imply plugin loading finished — the registry loads after bootstrap — so the
 * gate waits for a verdict rather than sampling once.
 */
const VERDICT_PATTERNS = [/Loaded plugin "browser"/, /Failed to load plugin "browser"/];

export function hasPluginVerdict(logText) {
  return VERDICT_PATTERNS.some((re) => re.test(logText));
}

/** Harness state written by `docker/test-up.sh`. */
export function parseHarnessState(text) {
  const parsed = JSON.parse(text);
  if (!parsed?.project || !parsed?.dashboardPort) {
    throw new Error(`.pi-test-harness.json is missing project/dashboardPort: ${text}`);
  }
  return { project: parsed.project, dashboardPort: Number(parsed.dashboardPort) };
}

/**
 * Plugins the harness seeds BROKEN on purpose, to exercise the error UI
 * (`plugin-settings-pages.spec.ts`): `e2e-broken`'s server entry throws by
 * construction. They are expected failures and must not mask a real one — so
 * every OTHER `Failed to load plugin` line still fails this gate.
 */
export const HARNESS_BROKEN_FIXTURES = ["e2e-broken"];

/**
 * The plugin-load contract, as the server log states it. Pure, so the gate's
 * verdict can be unit-tested without Docker.
 */
export function pluginLoadProblems(logText, { plugin = "browser", ignoreFailures = HARNESS_BROKEN_FIXTURES } = {}) {
  const problems = [];
  if (!logText.includes(`Loaded plugin "${plugin}"`)) {
    problems.push(`log has no 'Loaded plugin "${plugin}"'`);
  }
  const failures = logText
    .split("\n")
    .filter((l) => l.includes("Failed to load plugin"))
    .filter((l) => !ignoreFailures.some((id) => l.includes(`Failed to load plugin "${id}"`)));
  if (failures.length > 0) {
    problems.push(`${failures.length} unexpected 'Failed to load plugin' line(s), first: ${failures[0].trim()}`);
  }
  return problems;
}

/**
 * No alias crutch may be present in the container. If `JITI_TSCONFIG_PATHS`
 * were set, a GREEN run would prove nothing about published-install
 * resolution — the deleted stamp is exactly what made the monorepo work while
 * npm / managed / Electron stayed broken. Asserted, not assumed.
 */
export function crutchProblems(envText) {
  const crutches = envText.split("\n").filter((l) => l.startsWith("JITI_"));
  if (crutches.length > 0) {
    return [`alias crutch present in the container env: ${crutches.join(", ")}`];
  }
  return [];
}

/** Read `env` out of the running container, one KEY=VALUE per line. */
export function readContainerEnv(project, root, exec = execFileSync) {
  return exec("docker", ["compose", "-p", project, "-f", "docker/compose.yml", "-f", "docker/compose.test.yml", "exec", "-T", "pi-dashboard", "env"], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function waitForHealth(port, { fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = "no attempt";
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`http://localhost:${port}/api/health`);
      if (res.ok) return true;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err?.message ?? err);
    }
    await sleep(HEALTH_POLL_MS);
  }
  throw new Error(`/api/health never answered on :${port} (last: ${lastError})`);
}

async function waitForPluginVerdict(readLog, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + VERDICT_TIMEOUT_MS;
  let text = "";
  while (Date.now() < deadline) {
    text = readLog();
    if (hasPluginVerdict(text)) return text;
    await sleep(VERDICT_POLL_MS);
  }
  return text;
}

/** Read the server log out of the running container. */
export function readContainerServerLog(project, root, exec = execFileSync) {
  const compose = ["compose", "-p", project, "-f", "docker/compose.yml", "-f", "docker/compose.test.yml", "exec", "-T", "pi-dashboard", "sh", "-c", 'cat "$HOME/.pi/dashboard/server.log"'];
  try {
    return exec("docker", compose, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    if (err.stdout) return err.stdout; // non-zero exit with output is still data
    throw err;
  }
}

export async function verifyDockerPluginLoad({ root = REPO_ROOT, exec = execFileSync, log = console.log, fetchImpl = globalThis.fetch } = {}) {
  const teardown = () => {
    try {
      exec("bash", ["docker/test-down.sh"], { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      /* best effort — the gate's verdict is not a teardown failure */
    }
  };

  try {
    log("booting the docker harness (build may take minutes on a cold cache)");
    // PI_E2E_SEED=1 arms the harness seams; PI_BROWSER_RELAY_FAKE=1 is what
    // ENABLES the plugin (`defaultEnabled: false`) so the loader attempts it.
    // Without both, `discovered` contains browser but nothing ever loads it and
    // "no failures" holds trivially — the vacuous-green trap this gate closes.
    exec("bash", ["docker/test-up.sh", "-d", "--build"], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PI_E2E_SEED: "1", PI_BROWSER_RELAY_FAKE: "1" },
    });

    const statePath = join(root, ".pi-test-harness.json");
    if (!existsSync(statePath)) throw new Error("docker/test-up.sh wrote no .pi-test-harness.json");
    const { project, dashboardPort } = parseHarnessState(readFileSync(statePath, "utf-8"));
    log(`harness up: project=${project} dashboardPort=${dashboardPort}`);

    await waitForHealth(dashboardPort, { fetchImpl });
    log("health 200");

    const problems = [
      ...crutchProblems(readContainerEnv(project, root, exec)),
      ...pluginLoadProblems(await waitForPluginVerdict(() => readContainerServerLog(project, root, exec))),
    ];
    if (problems.length > 0) {
      for (const p of problems) console.error(`✗ ${p}`);
      return { ok: false, problems, project, dashboardPort };
    }
    log('✓ docker image: \'Loaded plugin "browser"\', zero \'Failed to load plugin\', no JITI_* crutch');
    return { ok: true, problems: [], project, dashboardPort };
  } finally {
    log("tearing the harness down");
    teardown();
  }
}

async function main() {
  try {
    const result = await verifyDockerPluginLoad();
    return result.ok ? 0 : 1;
  } catch (err) {
    console.error(`✗ docker plugin-load gate failed: ${err.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
