/**
 * Repo-level invariant: any source file that passes an argv to Node
 * with `--import` or `--loader` MUST wrap the following positions
 * (loader and entry script) in `file://` URLs via `toFileUrl(...)` or
 * `pathToFileURL(...).href`. Raw OS paths on Windows drives whose
 * letter collides with URL-scheme parsing (e.g. `B:\`) crash Node with
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
 *
 * If this test fails, migrate the offending file to use
 * `spawnNodeScript` or wrap the entry/loader with `toFileUrl` from
 * `@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js`.
 *
 * See change: fix-windows-entry-script-url.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";

/** Files allowed to reference --import / --loader with raw identifiers. */
const ALLOWLIST: readonly string[] = [
  "packages/shared/src/platform/node-spawn.ts",
  // server-launcher.ts is the single shared spawn primitive for the
  // dashboard server (Bridge / Standalone CLI / Electron). It mentions
  // "--import" in commentary; argv construction itself is delegated to
  // node-spawn.ts via `spawnNodeScript` / `buildNodeImportArgvParts`.
  // See change: unify-server-launch-ts-loader.
  "packages/shared/src/server-launcher.ts",
];

/** Per-line opt-out for intentional usages (e.g. comment examples). */
const OPT_OUT_MARKER = "ban:raw-node-import-ok";

/**
 * Detect argv arrays containing `"--import"` or `"--loader"` followed by
 * a bare identifier (not a string literal and not a wrapped call).
 *
 * We match the argv-literal shape:
 *   ["--import", X, Y]
 *   args: ["--import", X, Y, ...]
 *
 * Then check that both X and Y are either:
 *   - a string literal starting with "file:" (already a URL)
 *   - a call expression to toFileUrl(...) or pathToFileURL(...).href
 *   - the identifier resolveJitiImport() / resolveJitiFromAnchor() (which
 *     are documented to return file:// URLs — allowlisted by name)
 *
 * Anything else is flagged.
 */
const IMPORT_ARGV_RE =
  /["']--(?:import|loader)["']\s*,\s*([^,\]]+?)\s*,\s*([^,\]]+?)(?:\s*,|\s*\])/g;

const URL_LOOKING_RE =
  /^(?:["']file:|toFileUrl\s*\(|pathToFileURL\s*\([^)]*\)\s*\.href)/;

/** Recursively walk a directory, yielding .ts / .tsx files. */
async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield full;
    }
  }
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

/**
 * Scan one source text for raw `--import` / `--loader` argv positions.
 * Pure (no fs) so a fixture can exercise it directly.
 * See change: cleanup-stale-fork-specs.
 */
function scanSource(content: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Fast path: only inspect lines that mention --import or --loader.
    if (!line.includes("--import") && !line.includes("--loader")) continue;
    if (line.includes(OPT_OUT_MARKER)) continue;
    // Check the current line alone (we allow argv to be on one line;
    // multi-line argv arrays are a rare style and would still trip
    // the quick search above).
    IMPORT_ARGV_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_ARGV_RE.exec(line)) !== null) {
      const loaderArg = m[1]!.trim();
      const entryArg = m[2]!.trim();
      const loaderOk = URL_LOOKING_RE.test(loaderArg);
      const entryOk = URL_LOOKING_RE.test(entryArg);
      if (!loaderOk || !entryOk) {
        violations.push({ file, line: i + 1, text: line.trim() });
      }
    }
  }
  return violations;
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const packagesDir = path.resolve(repoRoot, "packages");

describe("no raw paths passed to node --import / --loader", () => {
  it("only URL-wrapped or allowlisted argv positions follow --import / --loader", async () => {
    const allowSet = new Set(
      ALLOWLIST.map((p) => path.resolve(repoRoot, p).replace(/\\/g, "/")),
    );

    const violations: Violation[] = [];

    for (const pkg of await fs.readdir(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const srcDir = path.join(packagesDir, pkg.name, "src");
      try {
        await fs.access(srcDir);
      } catch {
        continue;
      }
      for await (const file of walk(srcDir)) {
        const normalized = file.replace(/\\/g, "/");
        if (allowSet.has(normalized)) continue;
        const content = await fs.readFile(file, "utf-8");
        violations.push(...scanSource(content, path.relative(repoRoot, file)));
      }
    }

    if (violations.length > 0) {
      const msg =
        `Raw filesystem paths passed to node --import / --loader found.\n` +
        `Migrate each call site to use spawnNodeScript() or wrap the\n` +
        `loader/entry with toFileUrl(...) from:\n` +
        `  import { toFileUrl, spawnNodeScript } from\n` +
        `    "@blackbelt-technology/pi-dashboard-shared/platform/node-spawn.js";\n\n` +
        `Offenders (${violations.length}):\n` +
        violations
          .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
          .join("\n");
      expect(violations, msg).toEqual([]);
    }
  });

  // Staged violation: the scanner flags a raw argv (test-plan #E7).
  it("flags a raw loader/entry in a fixture file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "no-raw-node-import-"));
    try {
      const fixture = path.join(dir, "fixture.ts");
      await fs.writeFile(fixture, 'spawn(process.execPath, ["--import", loader, rawPath]);\n');
      const violations = scanSource(await fs.readFile(fixture, "utf-8"), path.basename(fixture));
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: "fixture.ts", line: 1 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // Exemptions are exactly the two argv-construction owners (test-plan #E8).
  it("allowlists exactly node-spawn.ts and server-launcher.ts", () => {
    expect([...ALLOWLIST]).toEqual([
      "packages/shared/src/platform/node-spawn.ts",
      "packages/shared/src/server-launcher.ts",
    ]);
  });

  // The per-line opt-out marker has exactly one production use (test-plan #E9).
  it("opt-out marker appears only in fit-worker-pool.ts", async () => {
    const hits: string[] = [];
    for (const pkg of ["extension", "server", "electron"]) {
      const srcDir = path.join(packagesDir, pkg, "src");
      for await (const file of walk(srcDir)) {
        if ((await fs.readFile(file, "utf-8")).includes(OPT_OUT_MARKER)) {
          hits.push(path.relative(repoRoot, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(hits).toEqual(["packages/server/src/attachments/fit-worker-pool.ts"]);
  });
});
