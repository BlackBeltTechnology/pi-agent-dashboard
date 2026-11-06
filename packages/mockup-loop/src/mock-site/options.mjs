// @ts-check
// Mock options file (`mockups/mock-site.config.ts`): a plain options object, never
// a build config. Build plugins come only from the app's own config, so nothing
// can be registered twice. Optional. See change: add-mock-site-exact-env (D9).

/**
 * @typedef {{ id: string, label: string, attrs?: Record<string, string|null>, system?: { dark: string, light: string } }} ThemeSpec
 * @typedef {{
 *   title?: string,
 *   themes?: ThemeSpec[],
 *   app?: string,
 *   aliases?: Record<string, string>,
 *   launcher?: string,
 *   config?: string,
 *   redact?: string[],
 * }} MockSiteUserOptions
 */

const KEYS = new Set(["title", "themes", "app", "aliases", "launcher", "config", "redact"]);
/** Keys that only make sense in a build config: refused with the "not a build config" message. */
const BUILD_KEYS = new Set(["plugins", "resolve", "server", "build", "css", "define", "optimizeDeps", "root", "publicDir", "esbuild"]);

/** @public Identity helper for typed options files (consumer `mockups/mock-site.config.ts`). @param {MockSiteUserOptions} o */
export const defineMockSite = (o) => o;

/**
 * Validate a loaded options object; throws naming the file and the offending key.
 * @param {unknown} o @param {string} file
 * @returns {MockSiteUserOptions}
 */
export function validateOptions(o, file) {
  if (o === undefined || o === null) return {};
  if (typeof o !== "object" || Array.isArray(o)) throw new Error(`mock options must be an object: ${file}`);
  for (const k of Object.keys(o)) {
    if (BUILD_KEYS.has(k)) throw new Error(`mock options are not a build config: ${file} sets "${k}"; build settings and plugins come from the app config (package.json "mockSite.config")`);
    if (!KEYS.has(k)) throw new Error(`unknown mock option "${k}" in ${file} (allowed: ${[...KEYS].join(", ")})`);
  }
  const r = /** @type {Record<string, unknown>} */ (o);
  for (const k of ["title", "app", "launcher", "config"]) if (r[k] !== undefined && typeof r[k] !== "string") throw new Error(`mock option "${k}" must be a string: ${file}`);
  if (r.aliases !== undefined && (typeof r.aliases !== "object" || Array.isArray(r.aliases) || Object.values(/** @type {object} */ (r.aliases)).some((v) => typeof v !== "string")))
    throw new Error(`mock option "aliases" must map strings to paths: ${file}`);
  if (r.themes !== undefined && !Array.isArray(r.themes)) throw new Error(`mock option "themes" must be an array: ${file}`);
  if (r.redact !== undefined && (!Array.isArray(r.redact) || r.redact.some((v) => typeof v !== "string"))) throw new Error(`mock option "redact" must be a string array: ${file}`);
  return /** @type {MockSiteUserOptions} */ (o);
}
