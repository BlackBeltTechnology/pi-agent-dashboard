/**
 * test-plan #E19 (refresh-electron-bundled-components, task 1.6): the legacy-
 * artifact lists mirrored in `routes/openspec-routes.ts` track the installed
 * `@fission-ai/openspec` `dist/core/legacy-cleanup.js`.
 *
 * The mirror drives the overwrite-confirm gate of POST /api/openspec/init:
 * `--tools` alone authorizes the CLI's cleanup, so a legacy location the mirror
 * misses is an unconfirmed destructive edit. Drift in the other direction only
 * adds a confirmation. The test reads BOTH sides from disk, so a CLI bump that
 * moves a location fails here instead of silently.
 *
 * Mapping:
 *  - upstream `LEGACY_CONFIG_FILES`                       == mirror LEGACY_CONFIG_FILES
 *  - upstream `type: "directory"` paths                   == mirror LEGACY_COMMAND_DIRS
 *  - parent dir of every upstream `type: "files"` pattern == mirror LEGACY_COMMAND_FILE_DIRS,
 *    plus the documented extras below (the mirror is intentionally a superset).
 *
 * See change: refresh-electron-bundled-components.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEGACY_COMMAND_DIRS,
  LEGACY_COMMAND_FILE_DIRS,
  LEGACY_CONFIG_FILES,
} from "../routes/openspec-routes.js";

/** Mirror entries the pinned CLI does not list; kept so the gate over-confirms rather than under. */
const DOCUMENTED_EXTRAS = [".junie/commands"];

function openspecPackageDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "node_modules", "@fission-ai", "openspec");
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("@fission-ai/openspec not installed");
    dir = parent;
  }
}

interface UpstreamPattern {
  type: "directory" | "files";
  path?: string;
  pattern?: string | string[];
}
interface UpstreamModule {
  LEGACY_CONFIG_FILES: string[];
  LEGACY_SLASH_COMMAND_PATHS: Record<string, UpstreamPattern>;
}

/** Directory-type paths, and the parent dir of every file-type pattern. */
function splitUpstream(upstream: UpstreamModule): { dirs: string[]; fileDirs: string[] } {
  const dirs: string[] = [];
  const fileDirs: string[] = [];
  for (const entry of Object.values(upstream.LEGACY_SLASH_COMMAND_PATHS)) {
    if (entry.type === "directory" && entry.path) dirs.push(entry.path);
    else if (entry.type === "files" && entry.pattern) {
      const patterns = Array.isArray(entry.pattern) ? entry.pattern : [entry.pattern];
      for (const p of patterns) fileDirs.push(path.posix.dirname(p));
    }
  }
  return { dirs, fileDirs };
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

describe("legacy-cleanup mirror parity (E19)", () => {
  it("matches the installed CLI's legacy-cleanup lists", async () => {
    const pkgDir = openspecPackageDir();
    const upstream = (await import(
      pathToFileURL(path.join(pkgDir, "dist/core/legacy-cleanup.js")).href
    )) as UpstreamModule;

    const { dirs: upstreamDirs, fileDirs: upstreamFileDirs } = splitUpstream(upstream);

    expect(sorted(LEGACY_CONFIG_FILES)).toEqual(sorted(upstream.LEGACY_CONFIG_FILES));
    expect(sorted(LEGACY_COMMAND_DIRS)).toEqual(sorted(upstreamDirs));
    expect(sorted(LEGACY_COMMAND_FILE_DIRS)).toEqual(
      sorted([...upstreamFileDirs, ...DOCUMENTED_EXTRAS]),
    );
  });
});
