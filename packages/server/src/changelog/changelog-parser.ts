/**
 * Pure parser for Keep-a-Changelog-style markdown files.
 *
 * Pi (`@earendil-works/pi-coding-agent` (formerly `@mariozechner/pi-coding-agent`)) ships a `CHANGELOG.md` whose
 * format is mechanically reliable:
 *   - H2 release headers: `## [<version>] - <date>`
 *   - H3 sub-section headers: `### Breaking Changes`, `### New Features`,
 *     `### Added`, `### Changed`, `### Fixed`
 *   - Bullets at column 0 starting `- `
 *   - Issue/PR links as `([#NNN](URL))` at end of bullet
 *
 * The parser is regex-based on purpose — a full markdown AST would
 * add hundreds of LOC of dependency surface for marginal gain. When
 * the file deviates from convention the parser degrades gracefully:
 * unrecognized H3 headings are dropped from typed slots but the
 * release's `raw` field still contains the verbatim section.
 *
 * Plus a 60-second mtime-keyed in-memory cache so the REST route
 * doesn't re-parse 150 KB of markdown on every dialog open.
 *
 * See change: pi-update-whats-new-panel.
 */
import fs from "node:fs";
import type { ChangelogBullet, ChangelogRelease } from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";

/** Single line, anchors at line start: `## [<version>] - <date>` (date optional). */
const RELEASE_HEADER_RE = /^## \[([^\]]+)\](?:\s*-\s*(.+?))?\s*$/gm;

/** Single line, anchors at line start: `### <heading>`. */
const SUBSECTION_HEADER_RE = /^### (.+?)\s*$/gm;

/** End-of-bullet issue ref: `([#NNN](URL))`. */
const ISSUE_LINK_RE = /\(\[#(\d+)\]\((https?:\/\/[^)]+)\)\)/g;

/** Subset of YYYY-MM-DD-ish date strings we treat as "valid enough". */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Recognized H3 sub-section names → release-field key. */
const KNOWN_SUBSECTIONS: Record<string, "breaking" | "features" | "changed" | "fixed"> = {
  "Breaking Changes": "breaking",
  "New Features": "features",
  "Added": "features",
  "Changed": "changed",
  "Fixed": "fixed",
};

/**
 * Parse a CHANGELOG.md text into a list of release entries, latest
 * first. Pure function — no I/O. Returns `[]` when the input contains
 * no recognizable H2 release headers.
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  if (!markdown || typeof markdown !== "string") return [];

  // Locate every H2 release header and split the document by them.
  // The regex's `lastIndex` walks the string giving us each header's
  // (start offset, captured groups) in one pass.
  const headers: { version: string; date: string | null; start: number; bodyStart: number }[] = [];

  // Reset the global regex lastIndex to be safe across re-entrant calls.
  RELEASE_HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RELEASE_HEADER_RE.exec(markdown)) !== null) {
    const version = m[1].trim();
    const dateRaw = (m[2] ?? "").trim();
    const date = ISO_DATE_RE.test(dateRaw) ? dateRaw : null;
    headers.push({
      version,
      date,
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }

  if (headers.length === 0) return [];

  // Sort by occurrence order (already in order since regex walks
  // left→right). Assemble each release as the slice from this
  // header's start to (the next header's start, or EOF).
  const releases: ChangelogRelease[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i + 1].start : markdown.length;
    const raw = markdown.slice(h.start, nextStart).replace(/\s+$/, "");
    const body = markdown.slice(h.bodyStart, nextStart);
    const sections = splitSubsections(body);

    const release: ChangelogRelease = {
      version: h.version,
      date: h.date,
      breaking: [],
      features: [],
      changed: [],
      fixed: [],
      raw,
    };

    for (const sec of sections) {
      const slot = KNOWN_SUBSECTIONS[sec.heading];
      if (!slot) continue;
      const bullets = extractBullets(sec.body);
      // `features` is the merge of New Features + Added; both map to
      // the same slot, so just push in source order.
      release[slot].push(...bullets);
    }
    releases.push(release);
  }

  return releases;
}

/**
 * Walk a release's body (text between its H2 and the next H2) and
 * return one entry per H3 sub-heading. Text before the first H3 is
 * dropped — pi never puts content there.
 */
function splitSubsections(body: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  const positions: { heading: string; bodyStart: number; headerStart: number }[] = [];

  SUBSECTION_HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SUBSECTION_HEADER_RE.exec(body)) !== null) {
    positions.push({
      heading: m[1].trim(),
      headerStart: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const nextStart = i + 1 < positions.length ? positions[i + 1].headerStart : body.length;
    out.push({ heading: p.heading, body: body.slice(p.bodyStart, nextStart) });
  }
  return out;
}

/**
 * Extract bullets from a sub-section body. A bullet starts with `- `
 * at column 0 and continues until the next column-0 `- ` line, the
 * next H-heading line, or end-of-section.
 */
function extractBullets(body: string): ChangelogBullet[] {
  const lines = body.split("\n");
  const bullets: string[] = [];
  let current: string | null = null;

  for (const line of lines) {
    if (/^- /.test(line)) {
      if (current !== null) bullets.push(current);
      current = line.slice(2);
    } else if (current !== null) {
      // Continuation of the current bullet only when the line is
      // either blank-and-followed-by-content (we drop blanks) or
      // indented. Stop on an undented non-bullet line that looks
      // like new content.
      if (line.trim() === "") {
        // Skip blank lines inside a bullet block; they may separate
        // paragraphs but don't terminate the bullet.
        continue;
      }
      if (/^\s/.test(line)) {
        current += "\n" + line.replace(/^\s+/, "");
      } else {
        // Undented non-bullet line: treat as end of bullet block.
        bullets.push(current);
        current = null;
      }
    }
  }
  if (current !== null) bullets.push(current);

  return bullets.map((text) => ({
    text: text.trim(),
    issues: extractIssues(text),
  }));
}

/** Collect all `([#NNN](URL))` matches in a bullet's prose. */
function extractIssues(text: string): { num: number; url: string }[] {
  const out: { num: number; url: string }[] = [];
  ISSUE_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ISSUE_LINK_RE.exec(text)) !== null) {
    const num = parseInt(m[1], 10);
    if (!Number.isNaN(num)) out.push({ num, url: m[2] });
  }
  return out;
}

// ── Cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;

export type ChangelogSource = "local" | "remote";

interface CacheEntry {
  /** Result of parsing the file/text. */
  releases: ChangelogRelease[];
  /**
   * mtime of the source file when this entry was created (local source
   * only). 0 for remote entries (mtime irrelevant; ETag drives remote
   * freshness).
   */
  mtimeMs: number;
  /** Wall-clock expiry. */
  expiresAt: number;
  /** ETag from a remote response, if any. Used for conditional GET. */
  etag: string | null;
}

/** Cache key combines pkg + source so remote and local don't collide. */
function cacheKey(pkg: string, source: ChangelogSource): string {
  return `${source}:${pkg}`;
}

const cache = new Map<string, CacheEntry>();

/**
 * Read + parse a CHANGELOG.md file with a 60-second mtime-keyed
 * cache. The cache is keyed by `pkg`; the entry is invalidated when
 * the file's mtime changes (e.g. after a fresh `npm install`) or
 * when 60 seconds have elapsed.
 *
 * Returns `[]` (not throwing) for ENOENT — callers treat "not found"
 * the same as "no releases". Other I/O errors propagate.
 */
export function readAndParseChangelog(
  pkg: string,
  filePath: string,
  now: () => number = Date.now,
): ChangelogRelease[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const mtimeMs = stat.mtimeMs;
  const t = now();

  const key = cacheKey(pkg, "local");
  const hit = cache.get(key);
  if (hit && hit.mtimeMs === mtimeMs && t < hit.expiresAt) {
    return hit.releases;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const releases = parseChangelog(content);
  cache.set(key, {
    releases,
    mtimeMs,
    expiresAt: t + CACHE_TTL_MS,
    etag: null,
  });
  return releases;
}

/**
 * Cache-hit accessor for the remote-source entry. Returns the cached
 * releases + last-known ETag. Caller decides what to do with `expired`
 * (typically: try a conditional GET, reuse on 304).
 */
export function getCachedRemoteChangelog(
  pkg: string,
  now: () => number = Date.now,
): { releases: ChangelogRelease[]; etag: string | null; expired: boolean } | undefined {
  const hit = cache.get(cacheKey(pkg, "remote"));
  if (!hit) return undefined;
  return {
    releases: hit.releases,
    etag: hit.etag,
    expired: now() >= hit.expiresAt,
  };
}

/** Store a remote fetch result. */
export function setRemoteChangelog(
  pkg: string,
  releases: ChangelogRelease[],
  etag: string | null,
  now: () => number = Date.now,
): void {
  cache.set(cacheKey(pkg, "remote"), {
    releases,
    mtimeMs: 0,
    expiresAt: now() + CACHE_TTL_MS,
    etag,
  });
}

/**
 * Extend a remote cache entry's TTL without re-parsing. Used after a
 * 304 Not Modified response.
 */
export function refreshRemoteChangelogTtl(
  pkg: string,
  now: () => number = Date.now,
): void {
  const entry = cache.get(cacheKey(pkg, "remote"));
  if (entry) entry.expiresAt = now() + CACHE_TTL_MS;
}

/** Clear all cache entries. Test seam + invalidation hook. */
export function _resetChangelogCache(): void {
  cache.clear();
}

/**
 * Clear a single package's cache entries (both local and remote
 * sources). Wired into PiCoreChecker.invalidate.
 */
export function invalidateChangelogCache(pkg?: string): void {
  if (pkg === undefined) {
    cache.clear();
    return;
  }
  cache.delete(cacheKey(pkg, "local"));
  cache.delete(cacheKey(pkg, "remote"));
}
