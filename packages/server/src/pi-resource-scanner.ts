/**
 * Pi Resource Scanner — discovers extensions, skills, and prompts
 * from local (.pi/), global (~/.pi/agent/), and installed packages.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as npm from "@blackbelt-technology/pi-dashboard-shared/platform/npm.js";
import type { PiResource, PiResourceScope, PiPackageInfo, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

// ── Frontmatter Parsing ─────────────────────────────────────────────

export function parseFrontmatter(
  content: string,
  fallbackFirstLine = false,
): { name?: string; description?: string } {
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
      description = singleLine[1].trim();
    }
  }

  return { name, description };
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
    });
  }
  return prompts;
}

function emptyScope(): PiResourceScope {
  return { extensions: [], skills: [], prompts: [] };
}

// ── Scope Scanners ──────────────────────────────────────────────────

export function scanLocalResources(cwd: string): PiResourceScope {
  const piDir = path.join(cwd, ".pi");
  if (!fs.existsSync(piDir)) return emptyScope();
  return {
    extensions: discoverExtensions(path.join(piDir, "extensions")),
    skills: discoverSkills(path.join(piDir, "skills")),
    prompts: discoverPrompts(path.join(piDir, "prompts")),
  };
}

export function scanGlobalResources(globalDir: string): PiResourceScope {
  if (!fs.existsSync(globalDir)) return emptyScope();
  return {
    extensions: discoverExtensions(path.join(globalDir, "extensions")),
    skills: discoverSkills(path.join(globalDir, "skills")),
    prompts: discoverPrompts(path.join(globalDir, "prompts")),
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
                scope.extensions.push({ name, filePath: resolved, type: "extension" });
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

  return {
    local,
    global,
    packages: [...localPackages, ...dedupedGlobal],
  };
}
