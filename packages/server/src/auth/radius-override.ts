/**
 * Detects a `models.json` custom-gateway Radius that pi sessions would use in
 * place of the built-in one, so the dashboard never signs in to the default
 * gateway while sessions talk to another.
 *
 * Mirrors `ModelRuntime.configureRadiusProviders` (pi-coding-agent
 * `core/model-runtime.js`): a provider with id `radius`, `oauth === "radius"`
 * and a `baseUrl` replaces the built-in. A `baseUrl` that normalizes to the
 * default gateway replaces it with an identical one, so it is not an override.
 *
 * The file is parsed as pi parses it (`JSON.parse(stripJsonComments(stripBom()))`,
 * schema validation excepted: a schema-invalid file that carries the override
 * shape still hides Radius — it only ever fails toward hiding). pi exports
 * neither helper, so both are ported here and pinned by a drift test against the
 * real `ModelRuntime`. Server runtime code never imports pi-ai.
 *
 * See change: add-radius-provider-login (D2).
 */

import fs from "node:fs";
import path from "node:path";

/** pi-ai `DEFAULT_RADIUS_GATEWAY`; pinned by a drift test. */
const DEFAULT_RADIUS_GATEWAY = "https://radius.pi.dev";

/** Re-read `models.json` at most this often (an edit applies without restart). */
const CACHE_TTL_MS = 1000;

/** Port of pi `utils/text.js` `stripBom`. */
function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/** Port of pi `utils/json.js` `stripJsonComments`: `//` comments + trailing commas. */
function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail?: string) =>
      tail ?? (m[0] === '"' ? m : ""),
    );
}

/** Port of pi-ai `normalizeRadiusGatewayUrl`. */
function normalizeGatewayUrl(value: string): string {
  const withScheme = /^https?:\/\//iu.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/u, "");
}

let agentDirSource: (() => string) | undefined;
let cached: { at: number; value: boolean } | undefined;

/**
 * Wire pi's `getAgentDir` (from the module the server runtime already loaded).
 * `undefined` = runtime unavailable.
 */
export function setAgentDirSource(source: (() => string) | undefined): void {
  agentDirSource = source;
  cached = undefined;
}

/** False when the pi runtime did not load (callers must not assume "no override"). */
export function isRadiusRuntimeAvailable(): boolean {
  return agentDirSource !== undefined;
}

/** Test seam: drop the 1 s memo. */
export function _resetRadiusOverrideCacheForTests(): void {
  cached = undefined;
}

function evaluate(): boolean {
  try {
    const dir = agentDirSource?.();
    if (!dir) return false;
    const raw = fs.readFileSync(path.join(dir, "models.json"), "utf8");
    const parsed: unknown = JSON.parse(stripJsonComments(stripBom(raw)));
    const providers = (parsed as { providers?: unknown } | null)?.providers;
    if (typeof providers !== "object" || providers === null) return false;
    const radius = (providers as Record<string, unknown>).radius;
    if (typeof radius !== "object" || radius === null) return false;
    const { oauth, baseUrl } = radius as { oauth?: unknown; baseUrl?: unknown };
    if (oauth !== "radius" || typeof baseUrl !== "string" || baseUrl === "") return false;
    const gateway = normalizeGatewayUrl(baseUrl.replace(/\/v1\/?$/u, ""));
    return gateway !== DEFAULT_RADIUS_GATEWAY;
  } catch {
    // Missing file, IO error, parse error → no override.
    return false;
  }
}

/** True iff `models.json` declares a non-default-gateway `radius` provider. */
export function isRadiusOverridden(): boolean {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const value = evaluate();
  cached = { at: now, value };
  return value;
}

/** Drop `radius` from an OAuth registry view while it is overridden. */
export function applyRadiusOverride<T extends { id: string }>(entries: readonly T[]): T[] {
  return isRadiusOverridden() ? entries.filter((e) => e.id !== "radius") : [...entries];
}
