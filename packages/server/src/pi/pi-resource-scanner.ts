/**
 * Pi Resource Scanner — discovers extensions, skills, and prompts
 * from local (.pi/), global (~/.pi/agent/), and installed packages.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as npm from "@blackbelt-technology/pi-dashboard-shared/platform/npm.js";
import type { PiPackageInfo, PiResource, PiResourceScope, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  buildEnabledMap,
  resolveActivation as defaultResolveActivation,
  lookupEnabled,
  type ResolvedPaths,
  type ResolvedResource,
  type ResolveActivationFn,
} from "./pi-resource-activation.js";

// ── Frontmatter Parsing ─────────────────────────────────────────────

export function parseFrontmatter(
  content: string,
  fallbackFirstLine = false,
): { name?: string; description?: string; model?: string; tools?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    if (fallbackFirstLine) {
      const firstLine = content.split(/\r?\n/).find((l) => l.trim().length > 0);
      return { description: firstLine?.trim() };
    }
    return {};
  }

  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const model = yaml.match(/^model:\s*(.+)$/m)?.[1]?.trim();
  const tools = parseToolsSummary(yaml.match(/^tools:\s*(.+)$/m)?.[1]?.trim());

  // Handle both single-line and multi-line (>) description
  let description: string | undefined;
  // Check for multi-line (> or |) first, then single-line
  const multiMatch = yaml.match(/^description:\s*[>|]-?\s*\r?\n((?:[ \t]+.+(?:\r?\n|$))*)/m);
  if (multiMatch) {
    description = multiMatch[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
  } else {
    const singleLine = yaml.match(/^description:\s*(.+)$/m);
    if (singleLine) {
      // Strip YAML quoting so `description: ""` reads as empty, not as two
      // quote characters — pi's load gate rejects it and so must we.
      // See change: fix-skill-discovery-parity.
      description = singleLine[1].trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    }
  }

  return { name, description, model, tools };
}

/**
 * Compress a frontmatter `tools` value into a compact card summary. Accepts a
 * bracketed/comma list (`[edit, read]` → `edit,read`) or a scalar (`all`).
 * Returns undefined when absent. See change: resources-card-tabs.
 */
function parseToolsSummary(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return undefined;
  return inner
    .split(",")
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .join(",");
}

// ── Directory Scanning Helpers ──────────────────────────────────────

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeReadFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function safeIsDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function discoverSkills(skillsDir: string): PiResource[] {
  const skills: PiResource[] = [];
  for (const entry of safeReaddir(skillsDir)) {
    const entryPath = path.join(skillsDir, entry);
    if (safeIsDirectory(entryPath)) {
      // Directory with SKILL.md
      const skillFile = path.join(entryPath, "SKILL.md");
      const content = safeReadFile(skillFile);
      if (content) {
        const fm = parseFrontmatter(content);
        skills.push({
          name: fm.name ?? entry,
          description: fm.description,
          filePath: skillFile,
          type: "skill",
          enabled: true,
        });
      }
    } else if (entry.endsWith(".md")) {
      // Root .md file as single skill
      const content = safeReadFile(entryPath);
      const fm = content ? parseFrontmatter(content) : {};
      skills.push({
        name: fm.name ?? entry.replace(/\.md$/, ""),
        description: fm.description,
        filePath: entryPath,
        type: "skill",
        enabled: true,
      });
    }
  }
  return skills;
}

function discoverExtensions(extDir: string): PiResource[] {
  const extensions: PiResource[] = [];
  for (const entry of safeReaddir(extDir)) {
    const entryPath = path.join(extDir, entry);
    if (entry.endsWith(".ts") || entry.endsWith(".js")) {
      extensions.push({
        name: entry.replace(/\.(ts|js)$/, ""),
        filePath: entryPath,
        type: "extension",
        enabled: true,
      });
    } else if (safeIsDirectory(entryPath)) {
      const indexTs = path.join(entryPath, "index.ts");
      const indexJs = path.join(entryPath, "index.js");
      const indexFile = fs.existsSync(indexTs) ? indexTs : fs.existsSync(indexJs) ? indexJs : null;
      if (indexFile) {
        extensions.push({
          name: entry,
          filePath: indexFile,
          type: "extension",
          enabled: true,
        });
      }
    }
  }
  return extensions;
}

function discoverPrompts(promptsDir: string): PiResource[] {
  const prompts: PiResource[] = [];
  for (const entry of safeReaddir(promptsDir)) {
    if (!entry.endsWith(".md")) continue;
    const entryPath = path.join(promptsDir, entry);
    if (safeIsDirectory(entryPath)) continue;
    const content = safeReadFile(entryPath);
    const fm = content ? parseFrontmatter(content, true) : {};
    prompts.push({
      name: entry.replace(/\.md$/, ""),
      description: fm.description,
      filePath: entryPath,
      type: "prompt",
      enabled: true,
    });
  }
  return prompts;
}

/**
 * Discover subagents from `agents/*.md`, parsing `model` + `tools` from
 * frontmatter (in addition to `name` / `description`). Mirrors
 * `discoverSkills` for root `.md` files. See change: resources-card-tabs.
 */
function discoverAgents(agentsDir: string): PiResource[] {
  const agents: PiResource[] = [];
  for (const entry of safeReaddir(agentsDir)) {
    if (!entry.endsWith(".md")) continue;
    const entryPath = path.join(agentsDir, entry);
    if (safeIsDirectory(entryPath)) continue;
    const content = safeReadFile(entryPath);
    const fm = content ? parseFrontmatter(content) : {};
    agents.push({
      name: fm.name ?? entry.replace(/\.md$/, ""),
      description: fm.description,
      filePath: entryPath,
      type: "agent",
      enabled: true,
      ...(fm.model ? { model: fm.model } : {}),
      ...(fm.tools ? { tools: fm.tools } : {}),
    });
  }
  return agents;
}

function emptyScope(): PiResourceScope {
  return { extensions: [], skills: [], prompts: [], agents: [], themes: [] };
}

// ── Scope Scanners ──────────────────────────────────────────────────

export function scanLocalResources(cwd: string): PiResourceScope {
  const piDir = path.join(cwd, ".pi");
  if (!fs.existsSync(piDir)) return emptyScope();
  return {
    extensions: discoverExtensions(path.join(piDir, "extensions")),
    skills: discoverSkills(path.join(piDir, "skills")),
    prompts: discoverPrompts(path.join(piDir, "prompts")),
    agents: discoverAgents(path.join(piDir, "agents")),
    themes: [],
  };
}

export function scanGlobalResources(globalDir: string): PiResourceScope {
  if (!fs.existsSync(globalDir)) return emptyScope();
  return {
    extensions: discoverExtensions(path.join(globalDir, "extensions")),
    skills: discoverSkills(path.join(globalDir, "skills")),
    prompts: discoverPrompts(path.join(globalDir, "prompts")),
    agents: discoverAgents(path.join(globalDir, "agents")),
    themes: [],
  };
}

// ── Package Resolution ──────────────────────────────────────────────

let cachedNpmGlobalRoot: string | null = null;

function getNpmGlobalRoot(): string | null {
  if (cachedNpmGlobalRoot !== null) return cachedNpmGlobalRoot;
  // Delegate to shared npm module which caches the result itself and
  // handles windowsHide / timeout. See change: platform-command-executor.
  cachedNpmGlobalRoot = npm.rootGlobalOr("");
  return cachedNpmGlobalRoot || null;
}

/** Visible for testing — reset cached npm root */
export function _resetNpmRootCache() {
  cachedNpmGlobalRoot = null;
}

function resolvePackagePath(entry: string, settingsDir: string, scope: "local" | "global", cwd?: string): { resolved: string; source: string } | null {
  if (typeof entry === "object") {
    // Object-form package with source key
    entry = (entry as any).source ?? "";
  }

  if (entry.startsWith("npm:")) {
    const pkgName = entry.slice(4).replace(/@[^/]*$/, ""); // strip version
    const npmRoot = getNpmGlobalRoot();
    if (!npmRoot) return null;
    return { resolved: path.join(npmRoot, pkgName), source: entry };
  }

  if (entry.startsWith("git:") || entry.startsWith("https://") || entry.startsWith("ssh://") || entry.startsWith("http://")) {
    // Extract host/path from git URL
    let url = entry.replace(/^git:/, "");
    // Handle git@host:path format
    url = url.replace(/^git@([^:]+):/, "$1/");
    // Strip protocol
    url = url.replace(/^(https?|ssh|git):\/\//, "");
    // Strip auth
    url = url.replace(/^[^@]+@/, "");
    // Strip .git suffix and version ref
    url = url.replace(/\.git$/, "").replace(/@[^/]*$/, "");

    const baseDir = scope === "local" && cwd
      ? path.join(cwd, ".pi", "git")
      : path.join(os.homedir(), ".pi", "agent", "git");
    return { resolved: path.join(baseDir, url), source: entry };
  }

  // Local path (relative or absolute)
  if (path.isAbsolute(entry)) {
    return { resolved: entry, source: entry };
  }
  return { resolved: path.resolve(settingsDir, entry), source: entry };
}

function scanPackageDir(pkgDir: string): PiResourceScope {
  // Try pi manifest from package.json
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkgJsonStr = safeReadFile(pkgJsonPath);
  if (pkgJsonStr) {
    try {
      const pkgJson = JSON.parse(pkgJsonStr);
      if (pkgJson.pi) {
        const scope = emptyScope();
        if (Array.isArray(pkgJson.pi.extensions)) {
          for (const extPath of pkgJson.pi.extensions) {
            const resolved = path.resolve(pkgDir, extPath);
            if (fs.existsSync(resolved)) {
              if (safeIsDirectory(resolved)) {
                scope.extensions.push(...discoverExtensions(resolved));
              } else {
                const name = path.basename(resolved).replace(/\.(ts|js)$/, "");
                scope.extensions.push({ name, filePath: resolved, type: "extension", enabled: true });
              }
            }
          }
        }
        if (Array.isArray(pkgJson.pi.skills)) {
          for (const skillPath of pkgJson.pi.skills) {
            const resolved = path.resolve(pkgDir, skillPath);
            if (safeIsDirectory(resolved)) {
              scope.skills.push(...discoverSkills(resolved));
            }
          }
        }
        if (Array.isArray(pkgJson.pi.prompts)) {
          for (const promptPath of pkgJson.pi.prompts) {
            const resolved = path.resolve(pkgDir, promptPath);
            if (safeIsDirectory(resolved)) {
              scope.prompts.push(...discoverPrompts(resolved));
            }
          }
        }
        if (Array.isArray(pkgJson.pi.agents)) {
          for (const agentPath of pkgJson.pi.agents) {
            const resolved = path.resolve(pkgDir, agentPath);
            if (safeIsDirectory(resolved)) {
              scope.agents.push(...discoverAgents(resolved));
            }
          }
        }
        return scope;
      }
    } catch {
      // Invalid JSON, fall through to conventional
    }
  }

  // Conventional directory discovery
  return {
    extensions: discoverExtensions(path.join(pkgDir, "extensions")),
    skills: discoverSkills(path.join(pkgDir, "skills")),
    prompts: discoverPrompts(path.join(pkgDir, "prompts")),
    agents: discoverAgents(path.join(pkgDir, "agents")),
    themes: [],
  };
}

function readSettingsPackages(settingsPath: string): string[] {
  const content = safeReadFile(settingsPath);
  if (!content) return [];
  try {
    const settings = JSON.parse(content);
    if (!Array.isArray(settings.packages)) return [];
    return settings.packages.map((p: string | { source: string }) =>
      typeof p === "string" ? p : p.source,
    );
  } catch {
    return [];
  }
}

export function resolvePackages(
  entries: string[],
  settingsDir: string,
  scope: "local" | "global" = "local",
  cwd?: string,
): PiPackageInfo[] {
  const packages: PiPackageInfo[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const resolved = resolvePackagePath(entry, settingsDir, scope, cwd);
    if (!resolved || !fs.existsSync(resolved.resolved)) continue;

    const realDir = resolved.resolved;
    if (seen.has(realDir)) continue;
    seen.add(realDir);

    // Read package.json for metadata
    const pkgJsonStr = safeReadFile(path.join(realDir, "package.json"));
    let name = path.basename(realDir);
    let description: string | undefined;
    if (pkgJsonStr) {
      try {
        const pkgJson = JSON.parse(pkgJsonStr);
        name = pkgJson.name ?? name;
        description = pkgJson.description;
      } catch { /* ignore */ }
    }

    const resources = scanPackageDir(realDir);
    packages.push({ name, description, source: resolved.source, resources, scope });
  }

  return packages;
}

// ── Main Entry Point ────────────────────────────────────────────────

export interface ScanOptions {
  globalDir?: string;
  /** Injectable for tests. Defaults to pi's real `PackageManager.resolve()`. */
  resolveActivation?: ResolveActivationFn;
}

/** Set `enabled` on every resource in a scope from pi's resolver output. */
function applyActivationToScope(scope: PiResourceScope, map: Map<string, boolean>): void {
  for (const r of scope.extensions) r.enabled = lookupEnabled(map, r.filePath);
  for (const r of scope.skills) r.enabled = lookupEnabled(map, r.filePath);
  for (const r of scope.prompts) r.enabled = lookupEnabled(map, r.filePath);
  for (const r of scope.agents) r.enabled = lookupEnabled(map, r.filePath);
  for (const r of scope.themes) r.enabled = lookupEnabled(map, r.filePath);
}

// ── Resolver-sourced discovery (D1 / D2) ────────────────────────────
//
// Skills, prompts and themes come from pi's own `PackageManager.resolve()`
// output rather than a parallel filesystem walk. `metadata.scope` supplies the
// local/global bucket, `metadata.origin` + `metadata.source` the package
// provenance, and `enabled` the activation state — all already computed by pi.
// See change: fix-skill-discovery-parity.

/** pi's `scope` enum → the dashboard's local/global bucket. `temporary` is local. */
function bucketForScope(scope: string): "local" | "global" {
  return scope === "user" ? "global" : "local";
}

/**
 * pi's source identity (`npm:<name>`, `local:<abs path>`) → a comparable key.
 * Version suffixes are stripped so `npm:foo@1.2.3` and `npm:foo` match.
 */
function normalizeSource(source: string): string {
  const withoutScheme = source.replace(/^(npm|local|git):/, "");
  return withoutScheme.replace(/@[^/@]*$/, "").replace(/\/+$/, "");
}

/**
 * Name a resolved resource. `SKILL.md` takes its containing directory's
 * basename (pi's own convention); any other file takes its stem.
 */
function nameForResolved(filePath: string): string {
  const base = path.basename(filePath);
  if (base === "SKILL.md") return path.basename(path.dirname(filePath));
  return base.replace(/\.[^.]+$/, "");
}

/**
 * pi's load gate (`loadSkillFromFile`): a skill with no non-empty frontmatter
 * `description` is not loaded, so it is not reported. Unreadable or
 * unparseable frontmatter yields no description and is therefore omitted too —
 * the scan still completes. No name-based exclusion rule is used.
 */
function resolvedToSkill(r: ResolvedResource): PiResource | null {
  const content = safeReadFile(r.path);
  if (content === undefined) return null;
  let fm: ReturnType<typeof parseFrontmatter>;
  try {
    fm = parseFrontmatter(content);
  } catch {
    return null;
  }
  const description = fm.description?.trim();
  if (!description) return null;
  return {
    name: fm.name ?? nameForResolved(r.path),
    description,
    filePath: r.path,
    type: "skill",
    enabled: r.enabled,
  };
}

function resolvedToPrompt(r: ResolvedResource): PiResource {
  const content = safeReadFile(r.path);
  const fm = content ? parseFrontmatter(content, true) : {};
  return {
    name: fm.name ?? nameForResolved(r.path),
    description: fm.description,
    filePath: r.path,
    type: "prompt",
    enabled: r.enabled,
  };
}

function resolvedToTheme(r: ResolvedResource): PiResource {
  return {
    name: nameForResolved(r.path),
    filePath: r.path,
    type: "theme",
    enabled: r.enabled,
  };
}

/**
 * Route resolver-sourced resources into the payload: package-origin entries go
 * to their matching package row; an unmatched source is still reported in the
 * scope bucket, labelled with the raw `metadata.source`. Nothing is dropped.
 */
function distributeResolved(
  entries: ResolvedResource[],
  build: (r: ResolvedResource) => PiResource | null,
  key: "skills" | "prompts" | "themes",
  local: PiResourceScope,
  global: PiResourceScope,
  packages: PiPackageInfo[],
): void {
  const bySource = new Map<string, PiPackageInfo>();
  for (const pkg of packages) {
    bySource.set(normalizeSource(pkg.source), pkg);
    bySource.set(pkg.name, pkg);
  }

  for (const entry of entries) {
    const resource = build(entry);
    if (!resource) continue;
    const bucket = bucketForScope(entry.metadata?.scope ?? "project");
    if (entry.metadata?.origin === "package") {
      const source = entry.metadata.source ?? "";
      const pkg = bySource.get(normalizeSource(source)) ?? bySource.get(source);
      if (pkg) {
        pkg.resources[key].push(resource);
        continue;
      }
      // Unmatched source — report it anyway, labelled with the raw string.
      resource.packageSource = source;
    }
    (bucket === "global" ? global : local)[key].push(resource);
  }
}

function totalOf(key: "skills" | "prompts" | "themes", local: PiResourceScope, global: PiResourceScope, packages: PiPackageInfo[]): number {
  return local[key].length + global[key].length + packages.reduce((n, p) => n + p.resources[key].length, 0);
}

/** True when pi resolved nothing at all across the three resolver-owned types. */
function resolverReturnedNothing(resolved: ResolvedPaths): boolean {
  return (resolved.skills?.length ?? 0) === 0 && (resolved.prompts?.length ?? 0) === 0 && (resolved.themes?.length ?? 0) === 0;
}

export async function scanPiResources(cwd: string, options?: ScanOptions): Promise<PiResourcesResult> {
  const globalDir = options?.globalDir ?? path.join(os.homedir(), ".pi", "agent");

  const local = scanLocalResources(cwd);
  const global = scanGlobalResources(globalDir);

  // Collect package entries from both settings files
  const localSettingsPath = path.join(cwd, ".pi", "settings.json");
  const globalSettingsPath = path.join(globalDir, "settings.json");

  const localPackageEntries = readSettingsPackages(localSettingsPath);
  const globalPackageEntries = readSettingsPackages(globalSettingsPath);

  // Local packages first (they win on dedup)
  const localPackages = resolvePackages(localPackageEntries, path.dirname(localSettingsPath), "local", cwd);
  const globalPackages = resolvePackages(globalPackageEntries, path.dirname(globalSettingsPath), "global");

  // Deduplicate: local wins
  const localNames = new Set(localPackages.map((p) => p.name));
  const dedupedGlobal = globalPackages.filter((p) => !localNames.has(p.name));

  const allPackages = [...localPackages, ...dedupedGlobal];

  // Consume pi's own resolver. It is the source of truth for skills, prompts
  // and themes (D1) and for `enabled` on every resource type. A `null` return
  // — pi unavailable, resolution threw, or the 5s timeout expired — falls back
  // to the walk above and marks the payload degraded.
  // See change: folder-resource-activation-toggle, fix-skill-discovery-parity.
  const resolveFn = options?.resolveActivation ?? defaultResolveActivation;
  let resolved: ResolvedPaths | null;
  try {
    resolved = await resolveFn(cwd, globalDir);
  } catch {
    resolved = null;
  }

  if (!resolved) {
    return { local, global, packages: allPackages, degraded: true };
  }

  // A successful-but-empty resolve that the fallback walk contradicts is a
  // failure shape too: shipping an authoritative empty list is worse than the
  // bug. Only the fallback's own findings can contradict it.
  const fallbackFound = totalOf("skills", local, global, allPackages) + totalOf("prompts", local, global, allPackages);
  if (resolverReturnedNothing(resolved) && fallbackFound > 0) {
    const map = buildEnabledMap(resolved);
    applyActivationToScope(local, map);
    applyActivationToScope(global, map);
    for (const pkg of allPackages) applyActivationToScope(pkg.resources, map);
    return { local, global, packages: allPackages, degraded: true };
  }

  // Resolver is authoritative — discard the walk's skills/prompts and rebuild
  // all three resolver-owned types from `ResolvedPaths`. `extensions` and
  // `agents` stay scanner-discovered (pi has no `agents` resource type).
  for (const scope of [local, global, ...allPackages.map((p) => p.resources)]) {
    scope.skills = [];
    scope.prompts = [];
    scope.themes = [];
  }
  distributeResolved(resolved.skills ?? [], resolvedToSkill, "skills", local, global, allPackages);
  distributeResolved(resolved.prompts ?? [], resolvedToPrompt, "prompts", local, global, allPackages);
  distributeResolved(resolved.themes ?? [], resolvedToTheme, "themes", local, global, allPackages);

  // `enabled` for the scanner-owned types still comes from the same resolve().
  const map = buildEnabledMap(resolved);
  applyActivationToScope(local, map);
  applyActivationToScope(global, map);
  for (const pkg of allPackages) applyActivationToScope(pkg.resources, map);

  return {
    local,
    global,
    packages: allPackages,
  };
}
