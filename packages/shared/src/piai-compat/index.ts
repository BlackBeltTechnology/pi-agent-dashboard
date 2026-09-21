/**
 * The pi-ai compatibility seam (design D1).
 *
 * `adaptPiAi(module, resolvedPath)` normalizes EITHER pi-ai generation into
 * the single `PiAiModule` surface the dashboard consumes, plus an OAuth
 * capability facade.
 *
 * The seam is ASYNC; the surface it returns is SYNCHRONOUS. Materializing the
 * factory collection and the lazy-api factories requires `await import()`
 * (pi-ai is ESM-only, and a static import here would bind `shared`'s own
 * pinned copy rather than the RESOLVED runtime — defeating the whole change),
 * but `InternalRegistry.getAllModels()` consumes `getProviders()`/`getModels()`
 * synchronously. Every async load therefore happens during construction.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { detectPiAiShape } from "./detect.js";
import { buildFactorySurface } from "./factory-surface.js";
import { buildOAuthFacade, unavailableOAuthFacade } from "./oauth-facade.js";
import type { AdaptDeps, AdaptedPiAi, PiAiModule } from "./types.js";

export { detectPiAiShape, FACTORY_MEMBERS, LEGACY_MEMBERS, type Detection } from "./detect.js";
export { API_LAZY_TABLE, NON_TEXT_LAZY_FILES, type LazyApiEntry } from "./api-table.js";
export { OAUTH_LOADER_EXPORTS } from "./oauth-facade.js";
export { derivePiAiSubpath, piAiDistDir, PI_AI_ENTRY_BASENAME } from "./subpath.js";
export type {
  AdaptDeps,
  AdaptedPiAi,
  OAuthRefreshCredentials,
  PiAiGeneration,
  PiAiModule,
  PiAiOAuthModule,
} from "./types.js";

const defaultDeps: Required<AdaptDeps> = {
  importPath: (absPath: string) => import(pathToFileURL(absPath).href),
  exists: (absPath: string) => existsSync(absPath),
};

/**
 * Adapt a resolved pi-ai module to the dashboard's `PiAiModule` surface.
 *
 * @param module the resolved pi-ai root module
 * @param resolvedPath its resolved filesystem entry (`.../dist/index.js`)
 * @throws when the module matches neither generation, or when a factory
 *         runtime is missing a subpath the seam requires. Both are
 *         diagnosable failures, never a silently wrong catalogue.
 */
export async function adaptPiAi(
  module: unknown,
  resolvedPath?: string,
  deps: AdaptDeps = {},
): Promise<AdaptedPiAi> {
  const resolved: Required<AdaptDeps> = {
    importPath: deps.importPath ?? defaultDeps.importPath,
    exists: deps.exists ?? defaultDeps.exists,
  };

  const detection = detectPiAiShape(module);
  if (detection.kind === "unrecognized") {
    throw new Error(`pi-ai compatibility seam: ${detection.reason}`);
  }

  const oauth = resolvedPath
    ? await buildOAuthFacade(resolvedPath, resolved)
    : unavailableOAuthFacade("no resolved pi-ai path was provided to the compatibility seam");

  if (detection.kind === "legacy") {
    // Identity: a legacy runtime IS the surface. No factory subpath is probed.
    return { generation: "legacy", module: module as PiAiModule, oauth };
  }

  if (!resolvedPath) {
    throw new Error(
      "pi-ai compatibility seam: a factory-API pi-ai requires a resolved module path " +
        "(its built-in providers and api implementations live in sibling subpaths)",
    );
  }

  const surface = await buildFactorySurface({
    module: module as Record<string, any>,
    resolvedPath,
    importPath: resolved.importPath,
    exists: resolved.exists,
  });

  return { generation: "factory", module: surface, oauth };
}
