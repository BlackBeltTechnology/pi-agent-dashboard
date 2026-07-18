/**
 * pi.dev version-check client. Mirrors the implementation pi itself
 * uses for self-update checks (see `@earendil-works/pi-coding-agent/dist/
 * utils/version-check.js`). Returns `{ version, packageName? }` so the
 * dashboard can:
 *   1. Detect the genuinely-newest pi without npm-registry lag.
 *   2. Pick up pi's npm-scope migration dynamically (the response's
 *      `packageName` field is the upstream's authoritative answer to
 *      "which package should be installed for the latest pi?").
 *
 * Falls back to `undefined` on any error so callers can degrade to
 * the npm-registry path. Honours `PI_OFFLINE` and `PI_SKIP_VERSION_CHECK`
 * envs identically to pi.
 *
 * See change: improve-pi-update-detection.
 */

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface PiDevReleaseInfo {
  /** Latest version string as published by pi.dev (e.g. `"0.74.0"`). */
  version: string;
  /**
   * Authoritative package name for fresh installs. Pi 0.73.1+ returns
   * this so consumers can follow npm-scope migrations without code
   * changes. Absent for older pi.dev responses.
   */
  packageName?: string;
}

export interface PiDevVersionCheckOptions {
  /** Override fetch timeout. Default 10 s, matching pi. */
  timeoutMs?: number;
  /** Test seam: override fetch implementation. */
  fetchImpl?: typeof fetch;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * Parse a semver-ish version string. Mirrors pi's `parsePackageVersion`.
 * Returns `undefined` for unparseable input so callers fall back to a
 * conservative comparison.
 */
export function parsePackageVersion(version: string): ParsedSemver | undefined {
  const match = version
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!match) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * Compare two semver strings: -ve when left < right, 0 when equal,
 * +ve when left > right. Returns `undefined` when either side is
 * unparseable.
 */
export function comparePackageVersions(
  leftVersion: string,
  rightVersion: string,
): number | undefined {
  const left = parsePackageVersion(leftVersion);
  const right = parsePackageVersion(rightVersion);
  if (!left || !right) return undefined;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

/** True when `candidateVersion` is strictly newer than `currentVersion`. */
export function isNewerPackageVersion(
  candidateVersion: string,
  currentVersion: string,
): boolean {
  const cmp = comparePackageVersions(candidateVersion, currentVersion);
  if (cmp !== undefined) return cmp > 0;
  return candidateVersion.trim() !== currentVersion.trim();
}

/**
 * Build the User-Agent string pi sends on its self-update calls.
 * Format: `pi/<version> (<platform>; <runtime>; <arch>)`.
 *
 * `<runtime>` is `bun/<version>` when running under Bun, otherwise
 * `node/<process.version>`. We don't identify the dashboard separately
 * so pi.dev treats the request the same way as a self-update from pi.
 */
export function getPiUserAgent(version: string, runtime?: string): string {
  const rt =
    runtime ??
    ((globalThis as { Bun?: { version: string } }).Bun?.version
      ? `bun/${(globalThis as { Bun?: { version: string } }).Bun!.version}`
      : `node/${process.version}`);
  return `pi/${version} (${process.platform}; ${rt}; ${process.arch})`;
}

/**
 * Query pi.dev for the latest release info. Returns `undefined` on
 * any of: env-skipped, network error, non-2xx response, malformed
 * JSON, missing `version` field, timeout.
 */
export async function getLatestPiRelease(
  currentVersion: string,
  opts: PiDevVersionCheckOptions = {},
): Promise<PiDevReleaseInfo | undefined> {
  if (process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE) {
    return undefined;
  }
  const fetchFn = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetchFn(LATEST_VERSION_URL, {
      headers: {
        "User-Agent": getPiUserAgent(currentVersion),
        accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { version?: unknown; packageName?: unknown };
    if (typeof data.version !== "string" || !data.version.trim()) return undefined;
    const packageName =
      typeof data.packageName === "string" && data.packageName.trim()
        ? data.packageName.trim()
        : undefined;
    return { version: data.version.trim(), packageName };
  } catch {
    return undefined;
  }
}
