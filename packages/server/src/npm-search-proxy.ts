/**
 * Cached proxy for npm registry search (keywords:pi-package) and README fetch.
 */

const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SEARCH_SIZE = 250;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const searchCache = new Map<string, CacheEntry<any>>();
const readmeCache = new Map<string, CacheEntry<any>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/** Type keywords to match (same logic as pi.dev/packages) */
const TYPE_KEYWORDS: Record<string, string[]> = {
  extension: ["extension", "pi-extension", "extensions"],
  skill: ["skill", "pi-skill", "skills"],
  theme: ["theme", "pi-theme", "themes"],
  prompt: ["prompt", "pi-prompt", "prompts"],
};

function extractTypes(keywords: string[]): string[] {
  const lc = keywords.map((k) => k.toLowerCase());
  const types: string[] = [];
  for (const [type, matchers] of Object.entries(TYPE_KEYWORDS)) {
    if (lc.some((k) => matchers.includes(k))) types.push(type);
  }
  return types;
}

export interface NpmSearchOptions {
  query?: string;
  type?: string;
}

export interface NpmPackageSearchResult {
  name: string;
  description?: string;
  version: string;
  keywords: string[];
  date: string;
  publisher?: { username: string; email?: string };
  links?: { npm?: string; homepage?: string; repository?: string };
  downloads?: { weekly: number; monthly: number };
  types: string[];
}

export interface NpmSearchResult {
  packages: NpmPackageSearchResult[];
  total: number;
}

export async function searchPackages(options: NpmSearchOptions = {}): Promise<NpmSearchResult> {
  const { query = "", type } = options;
  const cacheKey = `${query}::${type ?? ""}`;

  const cached = searchCache.get(cacheKey);
  if (isFresh(cached)) return cached.data;

  // Build search text
  let text = "keywords:pi-package";
  if (query.trim()) text += ` ${query.trim()}`;

  const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(text)}&size=${SEARCH_SIZE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm search failed: ${res.status}`);

  const json = await res.json();
  let packages: NpmPackageSearchResult[] = (json.objects ?? []).map((obj: any) => {
    const pkg = obj.package ?? {};
    const keywords = pkg.keywords ?? [];
    return {
      name: pkg.name,
      description: pkg.description,
      version: pkg.version,
      keywords,
      date: pkg.date,
      publisher: pkg.publisher,
      links: pkg.links,
      downloads: obj.downloads,
      types: extractTypes(keywords),
    };
  });

  // Filter by type if requested
  if (type) {
    packages = packages.filter((p) => p.types.includes(type));
  }

  const result: NpmSearchResult = { packages, total: packages.length };

  searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

export interface NpmReadmeResult {
  readme: string;
  name: string;
  version: string;
}

export async function fetchReadme(packageName: string): Promise<NpmReadmeResult> {
  const cached = readmeCache.get(packageName);
  if (isFresh(cached)) return cached.data;

  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new PackageNotFoundError(packageName);
    throw new Error(`npm registry fetch failed: ${res.status}`);
  }

  const json = await res.json();
  const result: NpmReadmeResult = {
    readme: json.readme ?? "",
    name: json.name ?? packageName,
    version: json["dist-tags"]?.latest ?? json.version ?? "unknown",
  };

  readmeCache.set(packageName, { data: result, timestamp: Date.now() });
  return result;
}

export class PackageNotFoundError extends Error {
  constructor(name: string) {
    super(`Package not found: ${name}`);
    this.name = "PackageNotFoundError";
  }
}

// ── Lightweight metadata helpers for recommended-extensions enrichment ──

export interface PackageMeta {
  description?: string;
  version?: string;
  /** Skill ids derived from the package's `pi.skills` manifest. */
  skills?: string[];
}

/**
 * Derive skill ids from a package.json `pi.skills` array. The skill id is
 * the final path segment (the SKILL.md directory name, e.g.
 * `.pi/skills/document-converter` -> `document-converter`).
 *
 * Convention container dirs (`skills` / `skill`) are skipped: they hold
 * multiple SKILL.md subfolders whose individual ids cannot be resolved from
 * the path alone (that needs a file listing of the published tarball).
 * Packages that point `pi.skills` at a specific skill directory resolve
 * correctly; packages that point at a `skills/` container yield no derived
 * ids (better than reporting the meaningless name "skills").
 *
 * Returns `undefined` when no resolvable skill ids remain.
 */
export function deriveSkillIds(piSkills: unknown): string[] | undefined {
  if (!Array.isArray(piSkills)) return undefined;
  const ids = piSkills
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.split("/").filter(Boolean).pop() ?? "")
    .filter(Boolean)
    .filter((id) => {
      const lower = id.toLowerCase();
      return lower !== "skills" && lower !== "skill";
    });
  return ids.length ? ids : undefined;
}

const metaCache = new Map<string, CacheEntry<PackageMeta | null>>();

/**
 * Fetch a minimal package.json-ish blob for an npm package (description,
 * version) from the registry's `/<name>/latest` endpoint. Returns `null`
 * on any network or parse failure.
 */
export async function fetchPackageMeta(packageName: string): Promise<PackageMeta | null> {
  const cached = metaCache.get(`npm:${packageName}`);
  if (isFresh(cached)) return cached.data;
  try {
    const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      metaCache.set(`npm:${packageName}`, { data: null, timestamp: Date.now() });
      return null;
    }
    const json: any = await res.json();
    const meta: PackageMeta = {
      description: typeof json?.description === "string" ? json.description : undefined,
      version: typeof json?.version === "string" ? json.version : undefined,
      skills: deriveSkillIds(json?.pi?.skills),
    };
    metaCache.set(`npm:${packageName}`, { data: meta, timestamp: Date.now() });
    return meta;
  } catch {
    metaCache.set(`npm:${packageName}`, { data: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Fetch `package.json` from a public GitHub repository's default branch
 * via `raw.githubusercontent.com`. Returns `{description, version}` or
 * `null` on any failure.
 */
export async function fetchGithubPackageJson(
  owner: string,
  repo: string,
): Promise<PackageMeta | null> {
  const key = `gh:${owner}/${repo}`;
  const cached = metaCache.get(key);
  if (isFresh(cached)) return cached.data;
  // HEAD resolves to the default branch on raw.githubusercontent.com.
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      metaCache.set(key, { data: null, timestamp: Date.now() });
      return null;
    }
    const json: any = await res.json();
    const meta: PackageMeta = {
      description: typeof json?.description === "string" ? json.description : undefined,
      version: typeof json?.version === "string" ? json.version : undefined,
      skills: deriveSkillIds(json?.pi?.skills),
    };
    metaCache.set(key, { data: meta, timestamp: Date.now() });
    return meta;
  } catch {
    metaCache.set(key, { data: null, timestamp: Date.now() });
    return null;
  }
}

/** Clear all caches (for testing). */
export function clearCaches() {
  searchCache.clear();
  readmeCache.clear();
  metaCache.clear();
}
