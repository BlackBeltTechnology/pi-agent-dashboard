/**
 * Vite plugin for dashboard plugin system.
 *
 * On dev start and build, scans packages/[star]/package.json for pi-dashboard-plugin
 * manifests and generates packages/client/src/generated/plugin-registry.tsx
 * with named imports per claim (enables Vite tree-shaking of unused exports).
 *
 * During dev:
 * - Watches manifest files for changes
 * - Regenerates registry when manifest content hash changes
 * - Triggers HMR (not a full reload)
 *
 * In production:
 * - Skips plugins with fixture: true
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { Plugin, ViteDevServer } from "vite";
import { validateManifest } from "../manifest-validator.js";
import {
  clearDiscoveryCache,
  discoverPlugins,
  pluginRegistryHash,
} from "../server/loader.js";

/** Generated file path (relative to the calling vite.config location). */
const GENERATED_DIR = "packages/client/src/generated";
const GENERATED_FILE = "plugin-registry.tsx";

function getGeneratedPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_DIR, GENERATED_FILE);
}

interface PluginEntry {
  manifest: PluginManifest;
  packageDir: string;
  clientEntryPath?: string;
  /**
   * Package-name import specifier (e.g. `@scope/pkg`) when the plugin's
   * `package.json#exports["."]` resolves to its manifest `client` entry.
   * Preferred over a relative filesystem path for the generated import so
   * the file is portable across machines (workspace symlink in dev, real
   * install in published consumers). Falls back to `undefined` for plugins
   * (e.g. fixtures) without a proper `exports` field, in which case the
   * generator emits a relative path. See change: fix-windows-standalone-spawn.
   */
  packageImportSpecifier?: string;
}

/**
 * Determine whether a plugin's `package.json#exports["."]` resolves to the
 * same file as the manifest's `client` entry. When true, the generator can
 * emit `import from "<packageName>"` instead of a relative filesystem path —
 * letting npm-workspace symlinks (dev) and real installs (consumer) resolve
 * to the right source without depending on filesystem topology between the
 * generated file and the plugin source.
 */
function resolvePackageImportSpecifier(
  packageDir: string,
  manifestClient: string | undefined,
): string | undefined {
  if (!manifestClient) return undefined;
  const pkgJsonPath = path.join(packageDir, "package.json");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return undefined;
  }
  const name = typeof raw.name === "string" ? raw.name : undefined;
  if (!name) return undefined;
  const exportsField = raw.exports;
  if (!exportsField || typeof exportsField !== "object") return undefined;
  const rootExport = (exportsField as Record<string, unknown>)["."];
  if (!rootExport) return undefined;

  let target: string | undefined;
  if (typeof rootExport === "string") target = rootExport;
  else if (typeof rootExport === "object") {
    const r = rootExport as Record<string, unknown>;
    target = (typeof r.default === "string" && r.default)
      || (typeof r.import === "string" && r.import)
      || (typeof r.types === "string" && r.types)
      || undefined;
  }
  if (!target) return undefined;

  const resolvedTarget = path.resolve(packageDir, target);
  const resolvedManifest = path.resolve(packageDir, manifestClient);
  if (resolvedTarget !== resolvedManifest) return undefined;

  return name;
}

function loadPluginEntries(repoRoot: string, isProd: boolean): PluginEntry[] {
  clearDiscoveryCache();
  const discovered = discoverPlugins(repoRoot);
  return discovered
    .filter(p => {
      if (isProd && p.manifest.fixture === true) return false;
      return Boolean(p.clientEntryPath);
    })
    .map(p => ({
      manifest: p.manifest,
      packageDir: p.packageDir,
      clientEntryPath: p.clientEntryPath,
      packageImportSpecifier: resolvePackageImportSpecifier(p.packageDir, p.manifest.client),
    }));
}

/**
 * Read named exports from a plugin's resolved client entry source file.
 *
 * Used at generation time to validate that every `component` and `predicate`
 * name referenced in a manifest's claims actually exists as a named export
 * in the plugin's client entry. Without this validation, a manifest typo
 * would silently emit an `undefined` Component/predicate and surface only
 * at render time as a confusing "renders for every session" or
 * "undefined is not a function" error.
 *
 * The implementation parses the source file textually (regex-based) rather
 * than dynamically importing it: dynamic import would require a TS loader
 * and run plugin code at build time, both of which are heavier than the
 * problem warrants. The regex covers the patterns plugins actually use:
 * `export function X`, `export const X`, `export class X`,
 * `export { X, Y as Z }`, and `export { X } from "..."`.
 *
 * Falsey return value (empty Set) means the file could not be read; callers
 * SHOULD treat that as a soft failure (skip validation) rather than a hard
 * error, because non-readable files are surfaced through other build paths.
 */
function readNamedExports(clientEntryPath: string): Set<string> {
  const exports = new Set<string>();
  let src: string;
  try {
    src = fs.readFileSync(clientEntryPath, "utf-8");
  } catch {
    return exports;
  }

  // export function|class Name
  // export const|let|var Name (only first identifier in destructuring/multi-decl is captured;
  // plugins rarely use those forms for slot-claimable exports)
  const namedDeclRe = /^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(namedDeclRe)) {
    exports.add(m[1]);
  }

  // export { A, B as C, D } [from "..."]
  // capture each name (or alias on the right of `as`)
  const namedListRe = /export\s*\{([^}]+)\}/g;
  for (const m of src.matchAll(namedListRe)) {
    const inner = m[1];
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // "A as B" → exported name is B; "A" → exported name is A
      const asMatch = trimmed.match(/^[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        exports.add(asMatch[1]);
        continue;
      }
      const ident = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
      if (ident) exports.add(ident[1]);
    }
  }

  return exports;
}

/**
 * Generate the plugin-registry.tsx content using named imports per claim.
 * This form allows Vite to tree-shake unused exports.
 *
 * Validates at generation time that every named reference (`component`
 * AND `predicate`) declared in any manifest claim corresponds to an
 * actual named export in the plugin's client entry. A missing reference
 * fails the build with an error naming the plugin id, slot, missing
 * name, entry path, and the list of names actually exported.
 */
function generateRegistryContent(entries: PluginEntry[], repoRoot: string): string {
  const generatedDir = path.dirname(getGeneratedPath(repoRoot));
  const lines: string[] = [
    "// GENERATED — do not edit. Regenerated by viteDashboardPluginsPlugin on every build.",
    "",
  ];

  // Named imports per claim component / predicate / shouldRender (deduped).
  for (const entry of entries) {
    // Resolve the import specifier with a two-tier chain so the generated
    // file is portable across machines AND across npm-install topologies:
    //
    //   1. PREFERRED — plugin's package-name (`@scope/plugin`), available when
    //      `package.json#exports["."]` matches the manifest `client` entry.
    //      Resolves via npm-workspace symlink in dev and via real install
    //      under a standalone-installed dashboard. No filesystem topology
    //      assumptions; survives the dashboard being installed in any
    //      `node_modules` layout.
    //
    //   2. FALLBACK — path RELATIVE to the generated file's directory, for
    //      plugins (e.g. fixtures) without a proper `exports` field. Still
    //      checkout-agnostic; just less robust than package-name imports
    //      under unusual install layouts.
    //
    // Both are stripped of `.ts/.tsx` so tsc (without allowImportingTsExtensions)
    // accepts the generated file; Vite resolves either form via configured
    // extensions. See change: fix-windows-standalone-spawn (collateral).
    let importPath: string;
    if (entry.packageImportSpecifier) {
      importPath = entry.packageImportSpecifier;
    } else {
      const rel = path.relative(generatedDir, entry.clientEntryPath!).replace(/\\/g, "/");
      importPath = (rel.startsWith(".") ? rel : `./${rel}`).replace(/\.(tsx?|jsx?)$/, "");
    }
    const namedRefs = [
      ...new Set(
        entry.manifest.claims
          .flatMap(c => [c.component, c.predicate, c.shouldRender])
          .filter((c): c is string => Boolean(c)),
      ),
    ];
    // i18n catalog export is imported aliased per-plugin (`<name> as <id>_catalog`)
    // so two plugins can both export `catalog` without a name collision.
    const catalogRef = entry.manifest.i18nCatalog;
    const catalogAlias = catalogRef
      ? `${entry.manifest.id.replace(/[^a-zA-Z0-9_$]/g, "_")}_catalog`
      : undefined;
    if (catalogRef && catalogAlias) namedRefs.push(`${catalogRef} as ${catalogAlias}`);

    if (namedRefs.length === 0) continue;

    // Validate every named ref exists as an export in the plugin's client entry.
    const exportedNames = readNamedExports(entry.clientEntryPath!);
    if (exportedNames.size > 0) {
      // Only validate when we successfully read exports; an unreadable file
      // surfaces through other build errors and we don't want to compound them.
      for (const claim of entry.manifest.claims) {
        for (const refKind of ["component", "predicate", "shouldRender"] as const) {
          const ref = claim[refKind];
          if (!ref) continue;
          if (!exportedNames.has(ref)) {
            const exported = [...exportedNames].sort().join(", ") || "<none>";
            throw new Error(
              `[vite-dashboard-plugins] Plugin "${entry.manifest.id}" claim ` +
                `for slot "${claim.slot}" references ${refKind} "${ref}" but ` +
                `${entry.clientEntryPath} does not export it. ` +
                `Exported names: ${exported}`,
            );
          }
        }
      }
    }

    lines.push(
      `import { ${namedRefs.join(", ")} } from ${JSON.stringify(importPath)};`,
    );
  }

  lines.push("");
  lines.push("import type { PluginManifest } from \"@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js\";");
  lines.push("import type { ClaimEntry } from \"@blackbelt-technology/dashboard-plugin-runtime\";");
  lines.push("");
  lines.push("export interface RegistryEntry {");
  lines.push("  manifest: PluginManifest;");
  lines.push("  claims: ClaimEntry[];");
  lines.push("  /** Plugin i18n catalog (unprefixed keys). Merged under plugin.<id>.* by the shell. */");
  lines.push("  catalog?: import(\"@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js\").PluginI18nCatalog;");
  lines.push("}");
  lines.push("");
  lines.push("export const PLUGIN_REGISTRY: RegistryEntry[] = [");

  for (const entry of entries) {
    const { manifest } = entry;
    lines.push("  {");
    lines.push(`    manifest: ${JSON.stringify(manifest, null, 4).split("\n").join("\n    ")},`);
    lines.push("    claims: [");
    for (const claim of manifest.claims) {
      const componentRef = claim.component ? `, Component: ${claim.component}` : "";
      const predicateRef = claim.predicate ? `, predicate: ${claim.predicate}` : "";
      const shouldRenderRef = claim.shouldRender ? `, shouldRender: ${claim.shouldRender}` : "";
      const tabStr = claim.tab ? `, tab: ${JSON.stringify(claim.tab)}` : "";
      const toolNameStr = claim.toolName ? `, toolName: ${JSON.stringify(claim.toolName)}` : "";
      const commandStr = claim.command ? `, command: ${JSON.stringify(claim.command)}` : "";
      // First-class fields for shell-overlay-route claims. See change:
      // fix-flows-plugin-polish (path-as-first-class-claim-field).
      const pathStr = claim.path ? `, path: ${JSON.stringify(claim.path)}` : "";
      const sessionParamStr = claim.sessionParam ? `, sessionParam: ${JSON.stringify(claim.sessionParam)}` : "";
      // Back-action depth/parent for shell-overlay-route claims. See change:
      // fix-plugin-and-scoped-back-navigation.
      const depthStr = claim.depth !== undefined ? `, depth: ${JSON.stringify(claim.depth)}` : "";
      const parentPathStr = claim.parentPath ? `, parentPath: ${JSON.stringify(claim.parentPath)}` : "";
      // Generic config escape hatch (rare — prefer first-class fields).
      const configStr = claim.config ? `, config: ${JSON.stringify(claim.config)}` : "";
      lines.push(
        `      { pluginId: ${JSON.stringify(manifest.id)}, priority: ${manifest.priority ?? 1000}, slot: ${JSON.stringify(claim.slot)}${tabStr}${toolNameStr}${commandStr}${pathStr}${sessionParamStr}${depthStr}${parentPathStr}${configStr}${componentRef}${predicateRef}${shouldRenderRef} },`,
      );
    }
    lines.push("    ],");
    if (manifest.i18nCatalog) {
      const catalogAlias = `${manifest.id.replace(/[^a-zA-Z0-9_$]/g, "_")}_catalog`;
      lines.push(`    catalog: ${catalogAlias},`);
    }
    lines.push("  },");
  }

  lines.push("];");
  lines.push("");
  // Build-time hash of the registry. The client compares this against the
  // server's live `/api/health.bundleHash` to detect a stale plugin bundle.
  // See change: fix-pi-flows-end-to-end (Group 6).
  const hash = pluginRegistryHash(entries);
  lines.push(`export const PLUGIN_REGISTRY_HASH = ${JSON.stringify(hash)};`);
  lines.push("");

  return lines.join("\n");
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

let lastHash = "";

/**
 * Standalone-callable wrapper around `regenerate` for non-Vite consumers
 * (e.g. `scripts/generate-plugin-registry.mjs` invoked from prelint/prebuild).
 */
export function regeneratePluginRegistry(repoRoot: string, isProd: boolean): { changed: boolean; content: string } {
  return regenerate(repoRoot, isProd);
}

function regenerate(repoRoot: string, isProd: boolean): { changed: boolean; content: string } {
  const entries = loadPluginEntries(repoRoot, isProd);
  const content = generateRegistryContent(entries, repoRoot);
  const hash = hashContent(content);

  if (hash === lastHash) return { changed: false, content };

  const outPath = getGeneratedPath(repoRoot);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, "utf-8");
  lastHash = hash;
  return { changed: true, content };
}

/**
 * Returns the Vite plugin for dashboard plugin registry generation.
 * @param repoRoot - Absolute path to the monorepo root. Defaults to process.cwd().
 */
export function viteDashboardPluginsPlugin(repoRoot?: string): Plugin {
  const root = repoRoot ?? process.cwd();

  return {
    name: "vite-dashboard-plugins",
    enforce: "pre", // run before React plugin

    buildStart() {
      const isProd = process.env.NODE_ENV === "production";
      const { changed } = regenerate(root, isProd);
      if (changed) {
        console.info("[vite-dashboard-plugins] Generated plugin-registry.tsx");
      }
    },

    configureServer(server: ViteDevServer) {
      // Watch all packages/*/package.json files for manifest changes
      const packagesDir = path.join(root, "packages");
      if (!fs.existsSync(packagesDir)) return;

      const manifestPaths = fs
        .readdirSync(packagesDir)
        .map(entry => path.join(packagesDir, entry, "package.json"))
        .filter(p => fs.existsSync(p));

      for (const manifestPath of manifestPaths) {
        server.watcher.add(manifestPath);
      }

      server.watcher.on("change", (filePath: string) => {
        if (!manifestPaths.includes(filePath)) return;
        // Check if it's a dashboard plugin manifest
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (!raw["pi-dashboard-plugin"]) return;
          // Validate it's still a valid manifest
          try { validateManifest(raw["pi-dashboard-plugin"]); } catch { return; }
        } catch {
          return;
        }

        const { changed } = regenerate(root, false);
        if (changed) {
          console.info("[vite-dashboard-plugins] Manifest changed, regenerated plugin-registry.tsx");
          // Trigger HMR for the generated file
          const generatedPath = getGeneratedPath(root);
          const mod = server.moduleGraph.getModuleById(generatedPath);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: "full-reload" });
          }
        }
      });
    },
  };
}
