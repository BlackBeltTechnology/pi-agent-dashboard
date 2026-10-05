#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
/**
 * pi-dashboard CLI entry point.
 *
 * The actual CLI is `../src/cli.ts`. This wrapper exists because a
 * `#!/usr/bin/env` shebang cannot interpolate a dynamic `--import`
 * loader path. The wrapper selects the TypeScript loader at runtime and
 * re-execs Node with `--import <loader-url> cli.ts <args>`:
 *   - default: the Node-native loader shipped by
 *     `@blackbelt-technology/pi-dashboard-shared` (`platform/native-ts-register.mjs`),
 *     located by package specifier from this file;
 *   - `PI_DASHBOARD_TS_LOADER=jiti`: jiti, resolved from `process.argv[1]`.
 * Selection uses the shared `.mjs` helper `platform/ts-loader-select.mjs`
 * (plain JS — runs before any TS loader). A missing jiti is fatal only when
 * jiti is selected. See change: fix-appimage-cold-boot-latency (D1, D4, D8).
 *
 * Since `@blackbelt-technology/pi-dashboard-server` declares `jiti` as
 * a direct runtime dependency, `createRequire(argv[1]).resolve("jiti/...")`
 * SHALL succeed in any well-formed npm install layout (flat, scoped,
 * hoisted, pnpm). A miss therefore indicates a corrupted install, not
 * a missing prerequisite. The error message reflects that.
 *
 * No tsx fallback. The jiti lookup mirrors the resolution shape in
 * `packages/shared/src/platform/binary-lookup.ts::ToolResolver.resolveJiti`
 * (cannot import the .ts module before a TS loader is registered, so
 * the lookup is inlined).
 *
 * See change: replace-tsx-with-jiti, enable-standalone-npm-install.
 */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
      process.stdout.write(`${pkg.version}\n`);
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

// Loader selection via the shared helper. Dynamic import so a corrupted
// install (helper unresolvable) still reaches a readable error, and the jiti
// opt-in still works without it.
let tsLoaderSelect = null;
try {
  tsLoaderSelect = await import("@blackbelt-technology/pi-dashboard-shared/platform/ts-loader-select.mjs");
} catch {
  /* handled below */
}
const loaderKind = tsLoaderSelect
  ? tsLoaderSelect.selectTsLoader(process.env)
  : process.env.PI_DASHBOARD_TS_LOADER === "jiti" ? "jiti" : null;
if (!loaderKind) {
  process.stderr.write(
    "pi-dashboard: cannot find the native TypeScript loader (@blackbelt-technology/pi-dashboard-shared).\n" +
      "Your install may be corrupted. Try:\n" +
      "  npm install -g @blackbelt-technology/pi-agent-dashboard\n" +
      "Workaround: set PI_DASHBOARD_TS_LOADER=jiti to boot with the jiti loader.\n",
  );
  process.exit(1);
}

const loader = loaderKind === "jiti"
  ? resolveJitiUrl()
  : tsLoaderSelect.resolveNativeTsLoader({ anchor: fileURLToPath(import.meta.url) });
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
// re-prepended with cwd as if it were a relative specifier), so jiti gets
// the RAW path on every platform. The native loader keeps Node's default
// rule: `file://` on win32 (A:/B: drive safety), raw on POSIX. The mirror
// lives in `wrapperEntryArg` (ts-loader-select.mjs), pinned by a parity
// test. See changes: fix-windows-standalone-spawn, fix-appimage-cold-boot-latency.
const entry = loaderKind === "jiti" ? cliPath : tsLoaderSelect.wrapperEntryArg(loaderKind, cliPath);

// Heap ceiling for the standalone launch path, from `serverHeap.maxOldSpaceMb`.
//
// Read by plain `JSON.parse` rather than by importing the shared config module:
// this wrapper runs BEFORE jiti is registered, so it cannot load TypeScript at
// all. Tolerated duplication of one integer (design D8) — the alternative is a
// bootstrap cycle. `packages/shared/src/heap-limits.ts` holds the same literal
// and a test asserts the two agree.
//
// Any failure — no config file, malformed JSON, a non-integer or below-floor
// value — takes the default. A bad config must not stop the server starting.
const DEFAULT_SERVER_MAX_OLD_SPACE_MB = 1536;
const MIN_HEAP_MB = 64;
const HEAP_FLAG_MARKER_ENV = "PI_DASHBOARD_HEAP_FLAG";

function readServerMaxOldSpaceMb() {
  try {
    const file = join(process.env.HOME ?? homedir(), ".pi", "dashboard", "config.json");
    const raw = JSON.parse(readFileSync(file, "utf-8"))?.serverHeap?.maxOldSpaceMb;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= MIN_HEAP_MB) return raw;
  } catch {
    // absent / unreadable / malformed / not an object — all take the default
  }
  return DEFAULT_SERVER_MAX_OLD_SPACE_MB;
}

const existingNodeOptions = process.env.NODE_OPTIONS ?? "";
// Provenance: record the exact token stamped, so the spawn-side strip in
// `process-manager.buildSpawnEnv` can tell THIS flag from one the operator
// pinned. A token we wrote on a previous launch (marker matches) is re-stamped
// rather than treated as a pin, so a changed config is adopted on cold start.
// See change: bound-session-heap-and-gc-telemetry (D4, D8).
const heapFlag = `--max-old-space-size=${readServerMaxOldSpaceMb()}`;
const ourPreviousFlag = process.env[HEAP_FLAG_MARKER_ENV];
// Quote-aware option spans `[start, end)`: whitespace separates options only
// OUTSIDE double quotes; inside, a backslash escapes the next char. Mirrors
// `optionSpans` in packages/shared/src/heap-flags.ts (this file runs before
// jiti and cannot import it). See change: guard-server-heap-and-store-coupling
// (CodeRabbit PR #780).
function optionSpans(options) {
  const spans = [];
  let i = 0;
  while (i < options.length) {
    while (i < options.length && /\s/.test(options[i])) i++;
    if (i >= options.length) break;
    const start = i;
    let quoted = false;
    for (; i < options.length; i++) {
      const c = options[i];
      if (quoted && c === "\\") i++;
      else if (c === '"') quoted = !quoted;
      else if (!quoted && /\s/.test(c)) break;
    }
    spans.push([start, Math.min(i, options.length)]);
  }
  return spans;
}
// Remove options exactly equal to `token`, every other byte as written.
// Mirrors `withoutToken` in packages/shared/src/heap-flags.ts.
function withoutToken(options, token) {
  if (!token) return options;
  let out = options;
  const hits = optionSpans(options).filter(([a, b]) => options.slice(a, b) === token);
  for (const [a, b] of hits.reverse()) {
    let start = a;
    let end = b;
    while (start > 0 && /\s/.test(options[start - 1])) start--;
    if (start === a) while (end < options.length && /\s/.test(options[end])) end++;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}
const nodeOptionTokens = optionSpans(existingNodeOptions).map(([a, b]) => existingNodeOptions.slice(a, b));
// BOTH spellings: V8 accepts `--max_old_space_size=N` and resolves a repeated
// flag last-wins, so a hyphen-only detector would append our value after an
// operator's underscore pin and silently defeat it. Kept in lockstep with
// `MAX_OLD_SPACE_FLAG_PATTERN` in packages/shared/src/heap-flags.ts (asserted
// by a test — this file runs before jiti and cannot import that module).
const MAX_OLD_SPACE_RE = /^--max[-_]old[-_]space[-_]size/;
const operatorPinned = nodeOptionTokens.some(
  (t) => MAX_OLD_SPACE_RE.test(t) && t !== ourPreviousFlag,
);
// An operator pin wins, and OUR stale marker is dropped with it: a marker that
// no longer describes a present token would let the spawn-side strip misread
// their flag as ours.
// Drop OUR previous token without a split/join round-trip and without
// matching inside a quoted value, so every other byte survives.
// See change: guard-server-heap-and-store-coupling (CodeRabbit PR #780).
const keptNodeOptions = withoutToken(existingNodeOptions, ourPreviousFlag).trimEnd();
const childEnvBase = operatorPinned
  ? (() => {
      // Their pin wins, but OUR stale token goes with the marker: V8 is
      // last-wins, so leaving it could override the pin we just honoured.
      const e = { ...process.env };
      if (!keptNodeOptions) delete e.NODE_OPTIONS;
      else e.NODE_OPTIONS = keptNodeOptions;
      delete e[HEAP_FLAG_MARKER_ENV];
      return e;
    })()
  : {
      ...process.env,
      NODE_OPTIONS: keptNodeOptions ? `${keptNodeOptions} ${heapFlag}` : heapFlag,
      [HEAP_FLAG_MARKER_ENV]: heapFlag,
    };

const child = spawn(
  process.execPath,
  ["--import", loader, entry, ...process.argv.slice(2)],
  { stdio: "inherit", windowsHide: true, env: childEnvBase },
);

// Forward termination signals to the real server child.
//
// This wrapper is the process every external supervisor sees: it owns
// `argv[1]`, so `kill <pid>`, a service manager tracking the CLI pid, and
// Ctrl-C in a foreground shell all land HERE, not on the child. Without
// forwarding, the wrapper died on SIGTERM and left the server child orphaned
// and running — which also meant the server's own SIGTERM/SIGINT handler
// (records `exitIntent:"signal"`, flushes `.meta.json` writes) never ran on
// this path. Verified live: `kill <wrapper-pid>` left the server answering
// /api/health with no exit intent recorded.
//
// Idempotent: repeat signals re-forward harmlessly; the child's own handler
// is itself idempotent. After the child exits, the `exit` handler below
// re-raises so the parent shell still sees the true exit reason.
// See change: fix-recovery-exit-intent (task 3.5).
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {
      /* child already gone — the exit handler below still fires */
    }
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    // Re-raise the signal so the parent shell sees the same exit reason.
    // Drop our own handler first, or the re-raise is swallowed by it.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

child.on("error", (err) => {
  process.stderr.write(`pi-dashboard: failed to spawn Node: ${err.message}\n`);
  process.exit(1);
});
