/**
 * REST route for `GET /api/pi-core/changelog`.
 *
 * Returns the parsed `CHANGELOG.md` for a core package filtered to
 * a `(from, to]` half-open version range, plus a derived `hasBreaking`
 * flag and a public GitHub URL for the full changelog.
 *
 * See change: pi-update-whats-new-panel. Bootstrap gate removed under
 * change: eliminate-electron-runtime-install (task 3.5).
 */
import type { FastifyInstance } from "fastify";
import type {
  ChangelogResponse,
} from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";
import { CORE_PACKAGE_NAMES } from "../pi-core-checker.js";
import { parseVersion, compareVersions } from "../pi-version-skew.js";
import {
  findChangelogPath,
  readPackageJson,
  deriveChangelogUrl,
} from "../changelog-fs.js";
import {
  parseChangelog,
  readAndParseChangelog,
  getCachedRemoteChangelog,
  setRemoteChangelog,
  refreshRemoteChangelogTtl,
} from "../changelog-parser.js";
import {
  deriveChangelogRawUrl,
  fetchRemoteChangelog,
} from "../changelog-remote.js";
import type { ChangelogRelease } from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";

export interface PiChangelogRouteDeps {
  // Bootstrap gate field removed; route is unconditionally available.
}

interface QueryShape {
  pkg?: string;
  from?: string;
  to?: string;
}

export function registerPiChangelogRoutes(
  fastify: FastifyInstance,
  _deps: PiChangelogRouteDeps,
): void {


  fastify.get<{ Querystring: QueryShape }>(
    "/api/pi-core/changelog",
    async (request, reply) => {
      const pkg = (request.query.pkg ?? "").trim();
      const from = (request.query.from ?? "").trim();
      const to = (request.query.to ?? "").trim();

      // Validate `pkg` against the core whitelist BEFORE touching
      // the filesystem — prevents arbitrary path reads via crafted
      // input.
      if (!pkg || !CORE_PACKAGE_NAMES.includes(pkg)) {
        return reply.code(400).send({
          success: false,
          error: `pkg must be one of: ${CORE_PACKAGE_NAMES.join(", ")}`,
        });
      }

      // Validate version range using the existing parseVersion helper
      // from pi-version-skew. Both endpoints are required.
      if (!from || !to) {
        return reply.code(400).send({
          success: false,
          error: "from and to query params are required",
        });
      }
      if (!parseVersion(from) || !parseVersion(to)) {
        return reply.code(400).send({
          success: false,
          error: "from and to must be parseable semver versions",
        });
      }

      const located = findChangelogPath(pkg);

      // Spec: package not installed / CHANGELOG missing → 200 with empty body.
      if (!located) {
        const body: ChangelogResponse = {
          pkg,
          from,
          to,
          releases: [],
          hasBreaking: false,
          changelogUrl: null,
          parsedAt: new Date().toISOString(),
        };
        return body;
      }

      // Read package.json once for both URLs (raw for the parser,
      // human for the dialog footer link).
      const pkgJson = readPackageJson(located.packageDir);
      const rawUrl = pkgJson ? deriveChangelogRawUrl(pkgJson.repository) : null;
      const changelogUrl = pkgJson ? deriveChangelogUrl(pkgJson.repository) : null;

      // Try remote first — the upstream CHANGELOG describes versions
      // newer than the locally-installed tarball. Fall back to local
      // on failure / offline / non-GitHub repo. See change:
      // read-changelog-from-github.
      let allReleases: ChangelogRelease[] | undefined;
      let usedRemote = false;

      if (rawUrl) {
        const cached = getCachedRemoteChangelog(pkg);
        if (cached && !cached.expired) {
          // Within TTL — reuse cached result, no fetch.
          allReleases = cached.releases;
          usedRemote = true;
        } else {
          const fetchResult = await fetchRemoteChangelog(rawUrl, {
            etag: cached?.etag ?? null,
          });
          if (fetchResult?.status === "ok") {
            const parsed = parseChangelog(fetchResult.text);
            setRemoteChangelog(pkg, parsed, fetchResult.etag);
            allReleases = parsed;
            usedRemote = true;
          } else if (fetchResult?.status === "not-modified" && cached) {
            refreshRemoteChangelogTtl(pkg);
            allReleases = cached.releases;
            usedRemote = true;
          }
          // null result (network error / offline / non-2xx): fall through
          // to local read below.
        }
      }

      if (!usedRemote) {
        try {
          allReleases = readAndParseChangelog(pkg, located.changelogPath);
        } catch (err: any) {
          request.log.warn(
            { err: err?.message },
            "[pi-changelog-routes] local read/parse failed; returning empty",
          );
          allReleases = [];
        }
      }

      // Filter to (from, to]. Unparseable release versions are
      // dropped — conservative.
      const filtered = (allReleases ?? []).filter((r) => {
        const rv = parseVersion(r.version);
        if (!rv) return false;
        return compareVersions(r.version, from) > 0 &&
          compareVersions(r.version, to) <= 0;
      });

      const hasBreaking = filtered.some((r) => r.breaking.length > 0);

      const body: ChangelogResponse = {
        pkg,
        from,
        to,
        releases: filtered,
        hasBreaking,
        changelogUrl,
        parsedAt: new Date().toISOString(),
      };
      return body;
    },
  );
}

// Re-export for tests that need to bypass the cache.
export { parseChangelog };
