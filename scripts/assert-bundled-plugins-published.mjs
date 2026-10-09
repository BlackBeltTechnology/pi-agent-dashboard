#!/usr/bin/env node
/**
 * assert-bundled-plugins-published.mjs — release gate (test-plan #X17).
 *
 *   node scripts/assert-bundled-plugins-published.mjs --version X
 *
 * Every `piDashboard.bundledPlugins` package (plus the fixed runtime set
 * except the not-yet-published server) MUST resolve on the registry at
 * exactly X before runtime-lock.json is generated and the server is
 * published. A miss (after bounded retries for registry propagation) exits 1
 * naming each package, so no lock naming a missing plugin is ever published
 * and server@X's dist-tags never move (design R2).
 *
 * `npm view --prefer-online` revalidates the cached packument (a stale cache
 * 404s a version published seconds ago — v0.8.0 incident).
 *
 * Test hook: RUNTIME_GATE_NPM_VIEW=<module path> exporting
 * `view(name, version)`; RUNTIME_GATE_ATTEMPTS overrides the retry count.
 *
 * See change: electron-runtime-release-pipeline (tasks 2.2, 2.5).
 */
import { appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundledPluginPackages, parseFlags, RUNTIME_BASE_PACKAGES, runNpm, SERVER_PACKAGE } from "./lib/runtime-release.mjs";

/**
 * Check every name resolves at `version`. `view(name, version)` returns the
 * resolved version string (or throws). Retries with linear backoff.
 */
export async function checkPublished({ names, version, view, sleep, attempts = 5, backoffMs = 15_000 }) {
  const missing = [];
  for (const name of names) {
    let ok = false;
    for (let attempt = 1; attempt <= attempts && !ok; attempt++) {
      try {
        ok = String(await view(name, version)).trim() === version;
      } catch {
        ok = false;
      }
      if (!ok && attempt < attempts) await sleep(attempt * backoffMs);
    }
    if (!ok) missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}

async function defaultView(name, version) {
  return runNpm(["view", "--prefer-online", `${name}@${version}`, "version"], { timeout: 60_000 });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const version = typeof flags.version === "string" ? flags.version : process.env.VERSION;
  if (!version) throw new Error("--version X is required");
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const plugins = bundledPluginPackages(repoRoot).map((p) => p.name);
  const names = [...RUNTIME_BASE_PACKAGES.filter((p) => p !== SERVER_PACKAGE), ...plugins];

  const hook = process.env.RUNTIME_GATE_NPM_VIEW;
  const view = hook ? (await import(pathToFileURL(resolve(hook)).href)).view : defaultView;
  const attempts = Number(process.env.RUNTIME_GATE_ATTEMPTS) || 5;
  const { ok, missing } = await checkPublished({ names, version, view, attempts, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (ok) {
    console.log(`ok  all ${plugins.length} bundled plugin(s) + runtime set resolve at ${version}`);
    if (summary) appendFileSync(summary, `### Bundled-plugin registry gate\n\n✅ ${names.length} package(s) resolve at \`${version}\`.\n\n`);
    return;
  }
  for (const name of missing) console.error(`::error::${name} does not resolve at ${version} on the registry — release blocked before runtime-lock.json / server publish`);
  if (summary) {
    appendFileSync(summary, `### Bundled-plugin registry gate\n\n❌ ${missing.length} package(s) missing at \`${version}\` — server + runtime asset NOT published:\n${missing.map((m) => `- \`${m}\``).join("\n")}\n\n`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::error::assert-bundled-plugins-published: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
