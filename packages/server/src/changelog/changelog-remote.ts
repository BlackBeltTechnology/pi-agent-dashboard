/**
 * Fetches the upstream CHANGELOG.md from GitHub raw, so the dashboard
 * can show release notes for versions newer than the locally-installed
 * tarball describes.
 *
 * Trust model identical to `pi-dev-version-check`: HTTPS, default Node
 * trust store, 10-second timeout, env-skippable via `PI_OFFLINE`.
 *
 * See change: read-changelog-from-github.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/** Discriminated result of a remote fetch attempt. */
export type RemoteChangelogResult =
  | { status: "ok"; text: string; etag: string | null }
  | { status: "not-modified" }
  | null; // hard failure (network, parse, env-skipped) → caller falls back to local

export interface FetchRemoteChangelogOptions {
  /** Optional ETag from a previous response. When set, sent as `If-None-Match`. */
  etag?: string | null;
  /** Override fetch timeout. Default 10 s. */
  timeoutMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

/**
 * Sibling of `deriveChangelogUrl` that returns the *raw* form suitable
 * for parsing (vs the `/blob/main/` URL which is for human viewing).
 *
 * Accepts the same `repository` field shapes:
 *   - `"github:org/repo"` shorthand
 *   - URL strings (`"https://github.com/org/repo.git"`, `"git@github.com:org/repo.git"`, etc.)
 *   - object form `{ url, directory? }` (monorepos)
 *
 * Returns `null` for non-GitHub or unparseable input.
 */
export function deriveChangelogRawUrl(repository: unknown): string | null {
  if (!repository) return null;

  let urlStr: string | null = null;
  let directory: string | null = null;

  if (typeof repository === "string") {
    urlStr = repository;
  } else if (typeof repository === "object" && repository !== null) {
    const rec = repository as Record<string, unknown>;
    if (typeof rec.url === "string") urlStr = rec.url;
    if (typeof rec.directory === "string" && rec.directory.length > 0) {
      directory = rec.directory.replace(/^\/+|\/+$/g, "");
    }
  }
  if (!urlStr) return null;

  const m = parseGitHubUrl(urlStr);
  if (!m) return null;

  const subPath = directory ? `${directory}/` : "";
  return `https://raw.githubusercontent.com/${m.org}/${m.repo}/main/${subPath}CHANGELOG.md`;
}

/**
 * Parse the various GitHub URL forms used in `package.json#repository`
 * into `{ org, repo }`. Internal helper duplicating the same logic in
 * `changelog-fs.ts::parseGitHubUrl` — kept inline to avoid cross-module
 * coupling for a 10-line regex.
 */
function parseGitHubUrl(s: string): { org: string; repo: string } | null {
  const trimmed = s.trim();

  // github:org/repo shorthand
  let m = trimmed.match(/^github:([^/]+)\/([^/#]+)/i);
  if (m) return { org: m[1], repo: stripGitSuffix(m[2]) };

  // git+https://github.com/org/repo.git
  // https://github.com/org/repo
  // ssh://git@github.com/org/repo.git
  // git@github.com:org/repo.git
  m = trimmed.match(/(?:^|[/@:])github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (m) return { org: m[1], repo: stripGitSuffix(m[2]) };

  return null;
}

function stripGitSuffix(repo: string): string {
  return repo.replace(/\.git$/i, "");
}

/**
 * Fetch the markdown text at `rawUrl`. Returns:
 *   - `{ status: "ok", text, etag }` on 2xx
 *   - `{ status: "not-modified" }` on 304 (when If-None-Match was sent and
 *     server confirmed the cached body is current)
 *   - `null` for: PI_OFFLINE / env-skipped, non-2xx (other than 304),
 *     network error, abort, malformed response.
 *
 * Caller is responsible for falling back to the local CHANGELOG on
 * `null` return.
 */
export async function fetchRemoteChangelog(
  rawUrl: string,
  opts: FetchRemoteChangelogOptions = {},
): Promise<RemoteChangelogResult> {
  if (process.env.PI_OFFLINE) return null;

  const fetchFn = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = { accept: "text/plain, */*" };
  if (opts.etag) headers["If-None-Match"] = opts.etag;

  try {
    const response = await fetchFn(rawUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });

    // 304: server confirms cache is current. Caller reuses cached body.
    if (response.status === 304) {
      return { status: "not-modified" };
    }
    if (!response.ok) return null;

    const text = await response.text();
    if (typeof text !== "string" || text.length === 0) return null;

    const etag = response.headers.get("etag");
    return { status: "ok", text, etag };
  } catch {
    return null;
  }
}
