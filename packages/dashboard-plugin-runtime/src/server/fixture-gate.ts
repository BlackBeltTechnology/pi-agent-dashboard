/**
 * Opt-in gate for `fixture: true` plugins (e.g. `packages/demo-plugin`).
 *
 * Fixture plugins are test scaffolding. Their SERVER and BRIDGE entries load
 * only when `PI_DASHBOARD_FIXTURE_PLUGINS=1` — otherwise a fixture bridge would
 * be auto-registered into `~/.pi/agent/settings.json` and inject fixture tools
 * into every pi session of any dashboard run from the monorepo. The same flag
 * makes a production client build keep fixture clients (declared as
 * `fixturePolicy: "included"`). The docker test harness sets it at build and
 * runtime; nothing else does.
 * See change: expose-plugin-credential-and-oauth-seams (D8).
 */

export const FIXTURE_PLUGINS_ENV = "PI_DASHBOARD_FIXTURE_PLUGINS";

export function fixturePluginsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[FIXTURE_PLUGINS_ENV] === "1";
}

/** True when a plugin's server/bridge entry may load under the current env. */
export function fixtureEntryAllowed(
  manifest: { fixture?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return manifest.fixture !== true || fixturePluginsEnabled(env);
}
