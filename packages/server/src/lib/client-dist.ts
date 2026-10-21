/**
 * Static-client directory resolution and served-artifact coherence.
 *
 * One resolver decides which directory the server serves the built web client
 * from, and one reader turns that directory's build declaration into the
 * four-state `clientBuild` health snapshot. Both the static-file serving and the
 * health surface consume the SAME snapshot, so the server can never report on a
 * directory other than the one it serves.
 *
 * Resolution precedence is preserved exactly from the inline block this
 * replaces: the installed web package wins; the workspace sibling is a fallback
 * **only when the package is unresolvable**. A resolvable package whose `dist/`
 * has no `index.html` is API-only — never a silent workspace fallback.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D3/D4).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  type BuildDeclaration,
  type FixturePolicy,
  discoverPlugins,
  findMonorepoRoot,
  isUsableDeclaration,
  readBuildDeclaration,
  serverRegistryHash,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";

/** Four-state coherence of the served artifact against the runtime plugin set. */
export interface ClientBuildSnapshot {
  /** Served artifact's declared hash, or null when it has/needs none. */
  pluginRegistryHash: string | null;
  status: "matched" | "mismatched" | "metadata-missing" | "not-served";
}

const NOT_SERVED: ClientBuildSnapshot = { pluginRegistryHash: null, status: "not-served" };

export interface ResolveStaticClientOptions {
  /**
   * Node-style resolver used to find the installed web package. Defaults to
   * `createRequire(import.meta.url).resolve`. Injectable for temp-directory tests.
   */
  requireResolve?: (specifier: string) => string;
  /** Workspace fallback directory. Defaults to the sibling `packages/client/dist`. */
  workspaceClientDir?: string;
}

/** Default workspace client build: `packages/client/dist` relative to this file. */
function defaultWorkspaceClientDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../client/dist");
}

/**
 * Resolve the static client directory, or null when the server is API-only.
 *
 * The package-first strategy is the durable identity across install layouts
 * (`require.resolve` by name); the workspace sibling exists for a checkout whose
 * web package is not yet linked.
 */
export function resolveStaticClientDir(opts: ResolveStaticClientOptions = {}): string | null {
  const requireFn = createRequire(import.meta.url);
  const requireResolve =
    opts.requireResolve ?? ((specifier: string) => requireFn.resolve(specifier));
  try {
    const webPkgJson = requireResolve("@blackbelt-technology/pi-dashboard-web/package.json");
    const candidate = path.join(path.dirname(webPkgJson), "dist");
    // Package resolvable: it wins if it has a build. No workspace fallback —
    // the package's absence of a build is a real API-only deployment.
    return fs.existsSync(path.join(candidate, "index.html")) ? candidate : null;
  } catch {
    const workspace = opts.workspaceClientDir ?? defaultWorkspaceClientDir();
    return fs.existsSync(path.join(workspace, "index.html")) ? workspace : null;
  }
}

/**
 * Runtime plugin-registry hash under a fixture policy — the SAME client-registry
 * selection `bundleHash` uses, so `clientBuild` and `bundleHash` can never
 * diverge (spec: *Comparison uses the same basis as the staleness hash*).
 *
 * `isProd` maps the fixture policy: `"excluded"` is a production selection,
 * `"included"` a dev one. `declaration` is the served build's declaration: with
 * `bundledPluginIds` the set follows it (`serverRegistryHash`: build copies of the declared ids,
 * else the declaration's own hash; runtime-only plugins never count); without it the
 * pre-change selection applies (`bundleRootsFor` where a monorepo root resolves — a root-less host
 * counts every discovered client plugin, the same mismatch that existed before). `bundleRoots` is
 * deliberately omitted when no monorepo marker is discoverable: an EMPTY allowlist would exclude
 * every plugin. See change: decouple-plugins-from-core (task 6.2, design D11).
 */
export function runtimePluginRegistryHash(isProd: boolean, declaration?: BuildDeclaration): string {
  return serverRegistryHash(discoverPlugins(undefined, [], { bundledPluginIds: declaration?.bundledPluginIds }), {
    isProd,
    declaration,
    monorepoRoot: findMonorepoRoot(),
  });
}

/** The served build's validated declaration, or `undefined` (no served build / unreadable / schema mismatch). */
export function readServedDeclaration(clientDir: string | null): BuildDeclaration | undefined {
  if (!clientDir) return undefined;
  const read = readBuildDeclaration(clientDir);
  return isUsableDeclaration(read) ? read.declaration : undefined;
}

/**
 * Turn a resolved static directory into the four-state coherence snapshot.
 *
 * `runtimeHashForPolicy` is evaluated under the **artifact's declared** fixture
 * policy, so a dev-mode server compared against a production artifact does not
 * report `mismatched` merely because `demo-plugin` is discoverable (design D4).
 */
export function readClientBuildSnapshot(
  clientDir: string | null,
  runtimeHashForPolicy: (policy: FixturePolicy) => string,
): ClientBuildSnapshot {
  if (!clientDir) return NOT_SERVED;

  const read = readBuildDeclaration(clientDir);
  if (!isUsableDeclaration(read)) {
    // Present but undescribed — distinct from "not served" and from a real
    // disagreement (design D4).
    return { pluginRegistryHash: null, status: "metadata-missing" };
  }

  const runtimeHash = runtimeHashForPolicy(read.declaration.fixturePolicy);
  return {
    pluginRegistryHash: read.declaration.pluginRegistryHash,
    status: read.declaration.pluginRegistryHash === runtimeHash ? "matched" : "mismatched",
  };
}

/**
 * Path-free startup diagnostic naming the coherence condition.
 *
 * `/api/health` (and this log) are reachable over the tunnel, and filesystem
 * layout is host information with no diagnostic value to a browser. The
 * declaration-read error path is reported by **status**, never by echoing an
 * `fs` error message (which embeds an absolute path). Design D4.
 */
export function clientBuildDiagnostic(snapshot: ClientBuildSnapshot): string {
  switch (snapshot.status) {
    case "not-served":
      return "[dashboard] Served client build: not-served (API-only mode)";
    case "metadata-missing":
      return "[dashboard] Served client build: metadata-missing — served static client carries no usable build declaration; run the local rebuild to sync it";
    case "mismatched":
      return "[dashboard] Served client build: mismatched — served artifact differs from the runtime plugin set; run the local rebuild to sync it";
    case "matched":
      return "[dashboard] Served client build: matched";
  }
}

/**
 * Coherence snapshot for a resolved static directory, using the real runtime
 * hash. Convenience wrapper for the server bootstrap.
 */
export function clientBuildSnapshotFor(clientDir: string | null): ClientBuildSnapshot {
  const declaration = readServedDeclaration(clientDir);
  return readClientBuildSnapshot(clientDir, (policy) =>
    runtimePluginRegistryHash(policy === "excluded", declaration),
  );
}

/**
 * Ids the served build declares bundled (`pi-dashboard-build.json#bundledPluginIds`), from the VALIDATED
 * declaration (a usable schema-1 file; sorted, deduped). `undefined` = undeclared (no served build,
 * unreadable / malformed / schema-mismatched file, or the field is absent / not a string array) —
 * discovery then falls back to plain source priority. Handed to the loader via
 * `setDeclaredBundledPluginIds` before any server-side discovery call, and re-read by
 * `refreshPluginDiscovery()`. See change: decouple-plugins-from-core (tasks 5.4, 6.2, design D11/D15).
 */
export function readServedBundledPluginIds(clientDir: string | null): readonly string[] | undefined {
  return readServedDeclaration(clientDir)?.bundledPluginIds;
}
