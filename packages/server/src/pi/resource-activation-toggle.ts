/**
 * Resource activation toggle — replays pi's own `config-selector` enable/disable
 * write, delegating persistence to pi's `SettingsManager`. Zero glob logic is
 * re-implemented: the pattern, the `+/-` precedence, and the JSONC-preserving
 * write are all pi's. The dashboard only decides which resource + scope.
 *
 * Write format (verified against pi source):
 *   - Loose (top-level) resource: in the scope's `settings.json`
 *     `extensions|skills|prompts|themes` array, strip any existing entry whose
 *     `!+-`-stripped value equals `pattern = relative(baseDir, path)`, then push
 *     `+<pattern>` (enable) or `-<pattern>` (disable).
 *   - Package resource: find the package in `settings.packages`, convert
 *     string→object form, push `+/-<pattern>` into `pkg[type]` (partial-key
 *     object form is intended), cleaning the object back to a bare string when
 *     no filters remain. Never uninstalls.
 *
 * Concurrency: callers serialize per settings-file via a write mutex (see
 * resource-activation-routes.ts), because each toggle is a whole-file
 * read-modify-write.
 *
 * See change: folder-resource-activation-toggle.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  AGENT_DIR,
  getPiCore,
  type PiPackageEntry,
  type PiSettings,
  type PiSettingsManager,
  type ResolvedResource,
} from "./pi-resource-activation.js";

export type ToggleScope = "local" | "global";
export type ToggleType = "extension" | "skill" | "prompt" | "theme";
type ArrayKey = "extensions" | "skills" | "prompts" | "themes";

const TYPE_TO_KEY: Record<ToggleType, ArrayKey> = {
  extension: "extensions",
  skill: "skills",
  prompt: "prompts",
  theme: "themes",
};

export interface ToggleRequest {
  scope: ToggleScope;
  cwd?: string;
  type: ToggleType;
  filePath: string;
  enabled: boolean;
  packageSource?: string;
}

export type ToggleResult = { ok: true } | { ok: false; status: number; error: string };

/** Absolute settings.json path a toggle for this scope will write. */
export function settingsPathForScope(scope: ToggleScope, cwd?: string): string {
  return scope === "local"
    ? path.join(cwd ?? process.cwd(), ".pi", "settings.json")
    : path.join(AGENT_DIR, "settings.json");
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Strip pi's `!`/`+`/`-` precedence prefix from a settings-array entry. */
function stripPrefix(p: string): string {
  return p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
}

function isValidType(t: unknown): t is ToggleType {
  return t === "extension" || t === "skill" || t === "prompt" || t === "theme";
}

function validate(req: ToggleRequest): ToggleResult | null {
  const { scope, type, filePath, enabled } = req;
  if (scope !== "local" && scope !== "global") {
    return { ok: false, status: 400, error: "scope must be 'local' or 'global'" };
  }
  if (!isValidType(type)) {
    return { ok: false, status: 400, error: "type must be extension|skill|prompt|theme" };
  }
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, status: 400, error: "filePath is required" };
  }
  if (typeof enabled !== "boolean") {
    return { ok: false, status: 400, error: "enabled must be a boolean" };
  }
  if (scope === "local" && !req.cwd) {
    return { ok: false, status: 400, error: "cwd is required for local scope" };
  }
  return null;
}

/** Filter out any existing entry for `pattern`, then push `+pattern`/`-pattern`. */
function rewriteArray(current: string[], pattern: string, enabled: boolean): string[] {
  const updated = current.filter((p) => stripPrefix(p) !== pattern);
  updated.push(`${enabled ? "+" : "-"}${pattern}`);
  return updated;
}

/**
 * Apply an activation toggle. Reuses pi's `PackageManager.resolve()` to locate
 * the resource (404 when absent — this also rejects `../` escapes, since an
 * out-of-tree path is never in the scanned set) and pi's `SettingsManager` to
 * persist. Returns a structured result; never throws on validation failures.
 */
export async function applyResourceToggle(req: ToggleRequest): Promise<ToggleResult> {
  const invalid = validate(req);
  if (invalid) return invalid;

  const { type, filePath, enabled } = req;
  const cwd = req.cwd ?? process.cwd();
  const agentDir = AGENT_DIR;
  const isProject = req.scope === "local";
  const arrKey = TYPE_TO_KEY[type];

  const { DefaultPackageManager, SettingsManager } = await getPiCore();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });

  const resolved = await pm.resolve(async () => "skip");
  const list = resolved[arrKey] ?? [];
  const targetReal = realpathOr(filePath);
  const item = list.find((r) => r.path === filePath || realpathOr(r.path) === targetReal);
  if (!item) {
    return { ok: false, status: 404, error: "resource not found in scanned set for scope" };
  }

  const settings = isProject ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();

  const result =
    item.metadata?.origin === "package"
      ? togglePackage(settingsManager, settings, isProject, arrKey, item, enabled, req.packageSource)
      : toggleLoose(settingsManager, settings, isProject, arrKey, item, enabled, cwd, agentDir);
  if (result) return result;

  await settingsManager.flush();
  return { ok: true };
}

function togglePackage(
  sm: PiSettingsManager,
  settings: PiSettings,
  isProject: boolean,
  arrKey: ArrayKey,
  item: ResolvedResource,
  enabled: boolean,
  packageSource?: string,
): ToggleResult | null {
  // Guard: a caller-supplied packageSource must match the resolved resource's
  // own package source, else we could rewrite an unrelated package's filters
  // using this resource's relative path.
  if (packageSource !== undefined && packageSource !== item.metadata.source) {
    return { ok: false, status: 400, error: "packageSource does not match the resolved resource" };
  }
  const source = item.metadata.source;
  const packages: PiPackageEntry[] = [...(settings.packages ?? [])];
  const idx = packages.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === source);
  if (idx === -1) {
    return { ok: false, status: 404, error: "package not found in settings for scope" };
  }
  const raw = packages[idx];
  const pkg = typeof raw === "string" ? { source: raw } : { ...raw };
  const baseDir = item.metadata.baseDir ?? path.dirname(item.path);
  const pattern = path.relative(baseDir, item.path);
  const updated = rewriteArray(pkg[arrKey] ?? [], pattern, enabled);
  pkg[arrKey] = updated.length > 0 ? updated : undefined;
  // Collapse back to a bare string when no filters remain.
  const hasFilters = (["extensions", "skills", "prompts", "themes"] as const).some(
    (k) => pkg[k] !== undefined,
  );
  packages[idx] = hasFilters ? pkg : pkg.source;
  if (isProject) sm.setProjectPackages(packages);
  else sm.setPackages(packages);
  return null;
}

function toggleLoose(
  sm: PiSettingsManager,
  settings: PiSettings,
  isProject: boolean,
  arrKey: ArrayKey,
  item: ResolvedResource,
  enabled: boolean,
  cwd: string,
  agentDir: string,
): ToggleResult | null {
  const baseDir = item.metadata?.baseDir ?? (isProject ? path.join(cwd, ".pi") : agentDir);
  // Scope-bounded guard: the resource must live under the scope's base dir.
  // A global toggle can therefore never write a folder file, and a `../` escape
  // is rejected. (The 404 above already rejects out-of-scan paths.)
  const realItem = realpathOr(item.path);
  const realRoot = realpathOr(baseDir);
  if (realItem !== realRoot && !realItem.startsWith(realRoot + path.sep)) {
    return { ok: false, status: 400, error: "resource escapes scope base directory" };
  }
  const pattern = path.relative(baseDir, item.path);
  const updated = rewriteArray([...(settings[arrKey] ?? [])], pattern, enabled);
  persistLoose(sm, isProject, arrKey, updated);
  return null;
}

function persistLoose(sm: PiSettingsManager, isProject: boolean, arrKey: ArrayKey, updated: string[]): void {
  if (isProject) {
    if (arrKey === "extensions") sm.setProjectExtensionPaths(updated);
    else if (arrKey === "skills") sm.setProjectSkillPaths(updated);
    else if (arrKey === "prompts") sm.setProjectPromptTemplatePaths(updated);
    else sm.setProjectThemePaths(updated);
  } else {
    if (arrKey === "extensions") sm.setExtensionPaths(updated);
    else if (arrKey === "skills") sm.setSkillPaths(updated);
    else if (arrKey === "prompts") sm.setPromptTemplatePaths(updated);
    else sm.setThemePaths(updated);
  }
}
