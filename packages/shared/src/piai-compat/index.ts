/**
 * The pi-ai compatibility seam (design D1).
 *
 * `adaptPiAi(module, resolvedPath)` normalizes the factory pi-ai generation
 * (the only one at or above the 1.0.0 floor) into the single `PiAiModule`
 * surface the dashboard consumes, plus an OAuth capability facade. A legacy
 * global-registry module is rejected, never passed through.
 *
 * The seam is ASYNC; the surface it returns is SYNCHRONOUS. Materializing the
 * factory collection and the lazy-api factories requires `await import()`
 * (pi-ai is ESM-only, and a static import here would bind `shared`'s own
 * pinned copy rather than the RESOLVED runtime — defeating the whole change),
 * but `InternalRegistry.getAllModels()` consumes `getProviders()`/`getModels()`
 * synchronously. Every async load therefore happens during construction.
 *
 * See change: adopt-piai-factory-api-registry, update-pi-core-1-0-adopt-apis.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { detectPiAiShape } from "./detect.js";
import { buildFactorySurface } from "./factory-surface.js";
import { buildOAuthFacade } from "./oauth-facade.js";
import type { AdaptDeps, AdaptedPiAi } from "./types.js";

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
 * @throws when the module is not a complete factory module (a legacy module
 *         is named as unsupported below the floor), when no resolved path is
 *         given, or when the runtime is missing a subpath the seam requires.
 *         All are diagnosable failures, never a silently wrong catalogue.
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

  if (!resolvedPath) {
    throw new Error(
      "pi-ai compatibility seam: a factory-API pi-ai requires a resolved module path " +
        "(its built-in providers and api implementations live in sibling subpaths)",
    );
  }

  const oauth = await buildOAuthFacade(resolvedPath, resolved);

  const surface = await buildFactorySurface({
    module: module as Record<string, any>,
    resolvedPath,
    importPath: resolved.importPath,
    exists: resolved.exists,
  });

  return { generation: "factory", module: surface, oauth };
}
