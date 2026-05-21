#!/usr/bin/env node
/**
 * pi-dashboard CLI entry point.
 *
 * The actual CLI is `../src/cli.ts`. This wrapper exists because a
 * `#!/usr/bin/env` shebang cannot interpolate a dynamic `--import`
 * loader path. The wrapper resolves jiti from `process.argv[1]`'s
 * module graph at runtime and re-execs Node with
 * `--import <jiti-url> cli.ts <args>`.
 *
 * Since `@blackbelt-technology/pi-dashboard-server` declares `jiti` as
 * a direct runtime dependency, `createRequire(argv[1]).resolve("jiti/...")`
 * SHALL succeed in any well-formed npm install layout (flat, scoped,
 * hoisted, pnpm). A miss therefore indicates a corrupted install, not
 * a missing prerequisite. The error message reflects that.
 *
 * No tsx fallback: jiti is the sole supported TypeScript loader.
 * Mirrors the resolution shape in
 * `packages/shared/src/platform/binary-lookup.ts::ToolResolver.resolveJiti`
 * (cannot import the .ts module before a TS loader is registered, so
 * the lookup is inlined).
 *
 * See change: replace-tsx-with-jiti, enable-standalone-npm-install.
 */
import { createRequire } from "node:module";
import { realpathSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "..", "src", "cli.ts");

// Metadata short-circuit: --version / -v / version SHALL NOT require jiti.
// See change: fix-electron-cold-launch-probe-cascade (Bug B).
//
// Why: every metadata-only consumer (npmGlobal probe, doctor, the user
// asking "what's installed") was previously blocked when the wrapper
// couldn't resolve jiti — even when the install was perfectly capable
// of answering the query from its sibling package.json. Reading the
// version is a pure metadata operation; gating it on a TS loader was
// over-aggressive.
//
// Falls through (no exit) on read/parse error so the legacy install
// hint still surfaces for genuinely corrupt installs.
const metaArg = process.argv[2];
if (metaArg === "--version" || metaArg === "-v" || metaArg === "version") {
  try {
    const pkgPath = resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg && typeof pkg.version === "string" && pkg.version.length > 0) {
      process.stdout.write(pkg.version + "\n");
      process.exit(0);
    }
  } catch {
    /* fall through to jiti-resolve path so the legacy error still fires */
  }
}

// Mirrors packages/shared/src/platform/binary-lookup.ts JITI_PACKAGES.
// Kept in sync by repo-lint: packages/shared/src/__tests__/jiti-packages-parity.test.ts.
// See change: enable-standalone-npm-install task 7.3.
const JITI_PACKAGES = ["jiti", "@mariozechner/jiti"];

/** Resolve pi's jiti register hook as a file:// URL. Returns null on miss. */
function resolveJitiUrl() {
  const anchor = process.argv[1];
  if (!anchor) return null;
  let resolved;
  try {
    resolved = realpathSync(anchor);
  } catch {
    return null;
  }
  const req = createRequire(resolved);
  for (const pkg of JITI_PACKAGES) {
    try {
      const pkgJson = req.resolve(`${pkg}/package.json`);
      const registerPath = join(dirname(pkgJson), "lib", "jiti-register.mjs");
      return pathToFileURL(registerPath).href;
    } catch {
      /* try next */
    }
  }
  return null;
}

const loader = resolveJitiUrl();
if (!loader) {
  // jiti is a direct dep of @blackbelt-technology/pi-dashboard-server, so a
  // miss here means the install is corrupted (deleted node_modules entry,
  // partial extract, etc.). The legacy "install pi globally" hint is kept
  // as a workaround for users who can't reinstall the dashboard cleanly.
  process.stderr.write(
    "pi-dashboard: cannot find jiti.\n" +
      "This is unexpected: jiti ships as a direct dependency of pi-dashboard-server.\n" +
      "Your install may be corrupted. Try:\n" +
      "  npm install -g @blackbelt-technology/pi-agent-dashboard\n" +
      "Workaround: install pi globally (provides a fallback jiti):\n" +
      "  npm install -g @earendil-works/pi-coding-agent\n" +
      "Please report at https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues\n",
  );
  process.exit(1);
}

// Mirrors shouldUrlWrapEntry() in packages/shared/src/platform/node-spawn.ts:
// jiti misnormalises file:/// URL entries on Windows (verified live on
// Node 22.18.0 + jiti 2.7.0 in a standalone install — the entry gets
// re-prepended with cwd as if it were a relative specifier). Pass the
// RAW path on every platform; Node's drive-letter heuristic handles
// `C:\…` entries directly. See change: fix-windows-standalone-spawn.
const entry = cliPath;

const child = spawn(
  process.execPath,
  ["--import", loader, entry, ...process.argv.slice(2)],
  { stdio: "inherit", windowsHide: true },
);

child.on("exit", (code, signal) => {
  if (signal) {
    // Re-raise the signal so the parent shell sees the same exit reason.
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

child.on("error", (err) => {
  process.stderr.write(`pi-dashboard: failed to spawn Node: ${err.message}\n`);
  process.exit(1);
});
