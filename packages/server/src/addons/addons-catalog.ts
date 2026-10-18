/**
 * Pure joiner for the Add-ons feature catalog.
 *
 * Takes plain data (installed global packages, discovered dashboard plugins,
 * recommended-manifest links) and returns one `AddonFeature` per user-facing
 * feature. No I/O: the route gathers the inputs, so identity rules live here
 * once and are unit-testable.
 *
 * Claim precedence (a package once claimed is never re-claimed):
 *   1 plugin's own package · 2 managed bridge · 3 required by ≥ 2 plugins →
 *   own `pkg:` feature · 4 recommended `dashboardPlugin` link · 5 required by
 *   exactly one plugin · 6 remainder → own `pkg:` feature.
 *
 * See change: addons-hub-feature-catalog (design D1–D3, D7, D8).
 */
import path from "node:path";
import type {
  AddonFeature,
  AddonFeatureKind,
  AddonFeatureState,
  AddonOrigin,
  AddonPackageContents,
  AddonPackagePart,
  AddonPluginPart,
  AddonRequirementRef,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { sourcesMatch } from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";
import { packageIdentity } from "../pi/resource-origin.js";

const FIRST_PARTY_SCOPE = "@blackbelt-technology/";
const DASHBOARD_BRIDGE_PACKAGE = "@blackbelt-technology/pi-dashboard-extension";

export interface CatalogPluginInput {
  id: string;
  displayName: string;
  description?: string;
  /** `package.json#name` of the plugin ("" when absent). */
  packageName: string;
  bridgeEntryPath?: string;
  requiresPiExtensions: string[];
  dependsOn: string[];
  enabled: boolean;
  loaded: boolean;
  error?: string;
  hasSettings: boolean;
  missingRequirements: string[];
}

export interface CatalogPackageInput {
  source: string;
  scope: "user" | "project";
  installedPath?: string;
  /** `package.json#name` when readable. */
  packageName?: string;
  version?: string;
  description?: string;
  displayName?: string;
  dashboardManaged?: boolean;
  /** Global entry is the all-empty filter form. */
  entryOff: boolean;
  publishedVariantSource?: string;
  publishedVariantVersion?: string;
  contents?: AddonPackageContents;
}

export interface CatalogInputs {
  plugins: CatalogPluginInput[];
  packages: CatalogPackageInput[];
  recommended: ReadonlyArray<{ source: string; dashboardPlugin?: string }>;
  /** Base dir relative local sources resolve against (the global `.pi/agent`). */
  baseDir: string;
}

const EMPTY_CONTENTS: AddonPackageContents = { extensions: 0, skills: 0, prompts: 0, themes: 0 };

interface PkgRec {
  input: CatalogPackageInput;
  identity: string;
  sourceKind: "npm" | "git" | "local";
  /** package.json name, else the npm name from the source. */
  name: string | undefined;
  claimed: boolean;
}

interface Draft {
  id: string;
  plugin?: CatalogPluginInput;
  bridgePath?: string;
  pkgs: PkgRec[];
  requiredBy: string[];
  core?: "pi" | "dashboard-bridge";
}

function npmNameOf(source: string): string | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice(4);
  const at = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

function kindOfIdentity(identity: string): "npm" | "git" | "local" {
  if (identity.startsWith("npm:")) return "npm";
  if (identity.startsWith("git:")) return "git";
  return "local";
}

const SOURCE_LIKE = /^(npm:|git:|git@|https?:\/\/|[/.~]|[A-Za-z]:[\\/])/;

/**
 * Does an installed package satisfy a `requires.piExtensions` name? A bare
 * package name matches by `package.json#name`, the npm name of an `npm:` source,
 * or (git/local sources with no readable name) the repo/folder basename. A
 * source-like requirement matches by `sourcesMatch`. Deliberately NOT the raw
 * `sourcesMatch(src, "npm:" + name)` for scoped names: it ignores scopes across
 * kinds, so `@a/x` would satisfy `@b/x`.
 */
function reqMatches(rec: PkgRec, name: string): boolean {
  return matchesRequirement(
    { source: rec.input.source, name: rec.name, hasPackageName: !!rec.input.packageName, sourceKind: rec.sourceKind },
    name,
  );
}

function matchesRequirement(
  pkg: { source: string; name: string | undefined; hasPackageName: boolean; sourceKind: "npm" | "git" | "local" },
  name: string,
): boolean {
  if (SOURCE_LIKE.test(name)) return sourcesMatch(pkg.source, name);
  if (pkg.name === name || npmNameOf(pkg.source) === name) return true;
  if (pkg.hasPackageName) return false;
  return pkg.sourceKind !== "npm" && sourcesMatch(pkg.source, `npm:${name}`);
}

/** Plugins whose `requires.piExtensions` names this owned package part. */
export function pluginsRequiringPart(
  plugins: readonly CatalogPluginInput[],
  part: Pick<AddonPackagePart, "source" | "packageName" | "sourceKind">,
): CatalogPluginInput[] {
  const pkg = {
    source: part.source,
    name: part.packageName ?? npmNameOf(part.source),
    hasPackageName: !!part.packageName,
    sourceKind: part.sourceKind,
  };
  return plugins.filter((p) => p.requiresPiExtensions.some((n) => matchesRequirement(pkg, n)));
}

function managedRowMatchesBridge(row: CatalogPackageInput, bridgePath: string): boolean {
  const candidates = [row.source, row.installedPath].filter((c): c is string => !!c);
  const resolved = path.resolve(bridgePath);
  return candidates.some((c) => {
    const p = path.resolve(c);
    return p === resolved || resolved.startsWith(p + path.sep);
  });
}

function isFirstPartyName(name: string | undefined): boolean {
  return typeof name === "string" && name.startsWith(FIRST_PARTY_SCOPE);
}

/** Label for a non-first-party package name (npm scope, else unscoped name). */
function labelForName(name: string): string {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    return slash > 0 ? name.slice(0, slash) : name;
  }
  return name;
}

/** Author label of a package part (design D8). */
function packageLabel(rec: PkgRec): string {
  if (rec.sourceKind === "npm") return labelForName(rec.name ?? rec.input.source);
  if (rec.sourceKind === "git") {
    // git:<host>/<owner>/<repo>[@ref|#ref] → <owner>/<repo>
    const id = rec.identity.slice("git:".length); // host/owner/repo
    const segs = id.replace(/[@#][^/]*$/, "").split("/");
    return segs.length >= 3 ? `${segs[segs.length - 2]}/${segs[segs.length - 1]}` : id;
  }
  return rec.input.packageName ?? path.basename(rec.input.installedPath ?? rec.input.source);
}

function toPart(rec: PkgRec): AddonPackagePart {
  const i = rec.input;
  return {
    source: i.source,
    scope: i.scope,
    identity: rec.identity,
    sourceKind: rec.sourceKind,
    ...(i.packageName ? { packageName: i.packageName } : {}),
    ...(i.version ? { version: i.version } : {}),
    ...(i.description ? { description: i.description } : {}),
    ...(i.installedPath ? { installedPath: i.installedPath } : {}),
    entryOff: i.entryOff,
    ...(i.publishedVariantSource ? { publishedVariantSource: i.publishedVariantSource } : {}),
    ...(i.publishedVariantVersion ? { publishedVariantVersion: i.publishedVariantVersion } : {}),
    contents: i.contents ?? EMPTY_CONTENTS,
  };
}

function toPluginPart(p: CatalogPluginInput): AddonPluginPart {
  return {
    id: p.id,
    enabled: p.enabled,
    loaded: p.loaded,
    ...(p.error ? { error: p.error } : {}),
    hasSettings: p.hasSettings,
    missingRequirements: p.missingRequirements,
    dependsOn: p.dependsOn,
  };
}

function deriveKind(d: Draft): AddonFeatureKind {
  if (d.core) return "core";
  if (d.plugin) return d.pkgs.length > 0 ? "agent-and-dashboard" : "dashboard-only";
  return "agent-only";
}

interface Part {
  firstParty: boolean;
  label: string;
}

function deriveOrigin(d: Draft): { origin: AddonOrigin; authorLabels: string[] } {
  if (d.core === "pi") return { origin: "upstream", authorLabels: [] };
  if (d.core) return { origin: "first-party", authorLabels: [] };
  const parts: Part[] = [];
  if (d.plugin) {
    const fp = isFirstPartyName(d.plugin.packageName);
    parts.push({ firstParty: fp, label: labelForName(d.plugin.packageName || d.plugin.id) });
  }
  for (const rec of d.pkgs) {
    parts.push({ firstParty: isFirstPartyName(rec.input.packageName ?? rec.name), label: packageLabel(rec) });
  }
  const authorLabels: string[] = [];
  for (const p of parts) if (!p.firstParty && !authorLabels.includes(p.label)) authorLabels.push(p.label);
  const fpCount = parts.filter((p) => p.firstParty).length;
  const origin: AddonOrigin =
    fpCount === parts.length && parts.length > 0 ? "first-party" : fpCount > 0 ? "mixed" : "community";
  return { origin, authorLabels };
}

function deriveState(d: Draft): AddonFeatureState {
  if (d.core) return "on";
  const pluginOn = d.plugin ? d.plugin.enabled : true;
  const pluginOff = d.plugin ? !d.plugin.enabled : true;
  const allOff = d.pkgs.every((r) => r.input.entryOff);
  if (pluginOn && !d.pkgs.some((r) => r.input.entryOff)) return "on";
  if (pluginOff && allOff) return "off";
  return "partial";
}

function displayNameOf(d: Draft): string {
  if (d.core === "pi") return "pi core agent";
  if (d.core) return "pi-dashboard bridge";
  if (d.plugin) return d.plugin.displayName;
  const rec = d.pkgs[0];
  return rec.input.displayName ?? rec.name ?? rec.input.source;
}

function descriptionOf(d: Draft): string {
  if (d.core === "pi") return "The pi coding agent the dashboard drives.";
  if (d.plugin?.description) return d.plugin.description;
  for (const rec of d.pkgs) if (rec.input.description) return rec.input.description;
  if (d.core) return "Connects every pi session to this dashboard.";
  return "";
}

function compareFeatures(a: AddonFeature, b: AddonFeature): number {
  const ac = a.kind === "core" ? 0 : 1;
  const bc = b.kind === "core" ? 0 : 1;
  if (ac !== bc) return ac - bc;
  const an = a.displayName.toLowerCase();
  const bn = b.displayName.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildAddonCatalog(inputs: CatalogInputs): AddonFeature[] {
  const { plugins, recommended, baseDir } = inputs;

  // One record per distinct identity; extra rows with the same identity are the
  // same package (the toggle refuses duplicate entries separately).
  const seen = new Set<string>();
  const pkgs: PkgRec[] = [];
  for (const input of inputs.packages) {
    if (input.scope !== "user" || input.dashboardManaged) continue;
    const identity = packageIdentity(input.source, baseDir);
    if (seen.has(identity)) continue;
    seen.add(identity);
    pkgs.push({
      input,
      identity,
      sourceKind: kindOfIdentity(identity),
      name: input.packageName ?? npmNameOf(input.source),
      claimed: false,
    });
  }

  const drafts: Draft[] = [{ id: "core:pi", pkgs: [], requiredBy: [], core: "pi" }];
  const bridgePkg = pkgs.find((r) => r.name === DASHBOARD_BRIDGE_PACKAGE);
  if (bridgePkg) {
    bridgePkg.claimed = true;
    drafts.push({ id: "core:dashboard-bridge", pkgs: [bridgePkg], requiredBy: [], core: "dashboard-bridge" });
  }

  const pluginDrafts = new Map<string, Draft>();
  for (const p of plugins) {
    const d: Draft = { id: `plugin:${p.id}`, plugin: p, pkgs: [], requiredBy: [] };
    pluginDrafts.set(p.id, d);
    drafts.push(d);
  }

  const join = (rec: PkgRec, d: Draft) => {
    rec.claimed = true;
    d.pkgs.push(rec);
  };
  const requiringPlugins = (rec: PkgRec): CatalogPluginInput[] =>
    plugins.filter((p) => p.requiresPiExtensions.some((n) => reqMatches(rec, n)));

  // 1 — plugin's own package.
  for (const p of plugins) {
    if (!p.packageName) continue;
    const rec = pkgs.find((r) => !r.claimed && r.name === p.packageName);
    if (rec) join(rec, pluginDrafts.get(p.id) as Draft);
  }

  // 2 — managed bridge. `dashboardManaged` rows were set aside above (they are
  // plumbing, never packages); the plugin's bridge path rides on its feature.
  for (const p of plugins) {
    if (p.bridgeEntryPath) (pluginDrafts.get(p.id) as Draft).bridgePath = p.bridgeEntryPath;
  }

  // 3 — required by ≥ 2 plugins → own feature.
  for (const rec of pkgs) {
    if (rec.claimed) continue;
    const req = requiringPlugins(rec);
    if (req.length >= 2) {
      rec.claimed = true;
      drafts.push({ id: `pkg:${rec.identity}`, pkgs: [rec], requiredBy: req.map((p) => `plugin:${p.id}`) });
    }
  }

  // 4 — recommended manifest link.
  for (const rec of pkgs) {
    if (rec.claimed) continue;
    const link = recommended.find((r) => r.dashboardPlugin && sourcesMatch(r.source, rec.input.source));
    const d = link?.dashboardPlugin ? pluginDrafts.get(link.dashboardPlugin) : undefined;
    if (d) join(rec, d);
  }

  // 5 — required by exactly one plugin.
  for (const rec of pkgs) {
    if (rec.claimed) continue;
    const req = requiringPlugins(rec);
    if (req.length === 1) join(rec, pluginDrafts.get(req[0].id) as Draft);
  }

  // 6 — remainder.
  for (const rec of pkgs) {
    if (rec.claimed) continue;
    rec.claimed = true;
    drafts.push({ id: `pkg:${rec.identity}`, pkgs: [rec], requiredBy: [] });
  }

  // Requirements that resolve to a package another feature owns.
  const ownerOf = new Map<PkgRec, Draft>();
  for (const d of drafts) for (const rec of d.pkgs) ownerOf.set(rec, d);

  const features: AddonFeature[] = drafts.map((d) => {
    const requires: AddonRequirementRef[] = [];
    if (d.plugin) {
      for (const name of d.plugin.requiresPiExtensions) {
        const rec = pkgs.find((r) => reqMatches(r, name));
        const owner = rec ? ownerOf.get(rec) : undefined;
        if (owner && owner !== d) requires.push({ name, featureId: owner.id });
      }
    }
    const { origin, authorLabels } = deriveOrigin(d);
    return {
      id: d.id,
      displayName: displayNameOf(d),
      description: descriptionOf(d),
      kind: deriveKind(d),
      origin,
      authorLabels,
      state: deriveState(d),
      ...(d.plugin ? { plugin: toPluginPart(d.plugin) } : {}),
      ...(d.bridgePath ? { bridge: { path: d.bridgePath } } : {}),
      packages: d.pkgs.map(toPart),
      requires,
      requiredBy: d.requiredBy,
    };
  });

  return features.sort(compareFeatures);
}

/**
 * `dashboardManaged` rows matching no discovered plugin's bridge entry. They
 * belong to no feature; the route logs them once per catalog build.
 */
export function orphanManagedSources(inputs: CatalogInputs): string[] {
  const bridges = inputs.plugins.map((p) => p.bridgeEntryPath).filter((b): b is string => !!b);
  return inputs.packages
    .filter((row) => row.scope === "user" && row.dashboardManaged)
    .filter((row) => !bridges.some((b) => managedRowMatchesBridge(row, b)))
    .map((row) => row.source);
}
