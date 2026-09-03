/**
 * Vitest setupFiles hook: per-file HOME isolation.
 *
 * Wired via `test.setupFiles` in a package's `vitest.config.ts`. Unlike
 * `globalSetup` (runs ONCE at vitest boot), `setupFiles` runs inside EACH
 * worker fork, before that test file's module imports execute. Assigning
 * `process.env.HOME` here gives every test FILE a private HOME directory
 * before any production code calls `os.homedir()` / reads `$HOME`.
 *
 * Why per-file (not the single per-run HOME the npm script sets):
 *   With `pool: "forks"` + `maxWorkers > 1`, multiple files run in parallel
 *   forks. Sharing one HOME means they contend on `$HOME/.pi/dashboard/*.json`
 *   and `server.lock`. A fresh HOME per file removes that contention so the
 *   server suite can run in parallel.
 *
 * Combined with `isolate: true` (fresh module registry per file), no singleton
 * that captured the old HOME at import time leaks across files in a fork.
 *
 * The `globalSetup` tripwire (setup-home.ts) stays wired as the second-line
 * guard: it aborts the run if the per-run HOME ever equals the real user home.
 *
 * NOTE on localStorage: no node-env test writes Node's `--localstorage-file`
 * (only client jsdom tests use localStorage, which jsdom backs in-memory
 * per-fork). So no per-file localStorage path is needed here.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(os.tmpdir(), "pi-test-"));
process.env.HOME = home;
if (process.platform === "win32") { // platform-branch-ok: test HOME isolation; win32 os.homedir() reads USERPROFILE not HOME
  // On win32 os.homedir() reads USERPROFILE (fallback HOMEDRIVE+HOMEPATH), not
  // HOME — set them too or tests would still resolve to the real user home.
  process.env.USERPROFILE = home;
  process.env.HOMEDRIVE = home.slice(0, 2);
  process.env.HOMEPATH = home.slice(2) || "\\";
}

// Pre-create expected .pi subdirectories (mirrors globalSetup bootstrap) so
// production code that reads those paths finds empty but well-formed dirs.
mkdirSync(join(home, ".pi", "agent", "sessions"), { recursive: true });
mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });

// The gateway's TCP listener is an explicit opt-in in production (D10, task
// 8.1 — a default POSIX start binds no bridge port at all), but the server
// corpus dials `ws://127.0.0.1:<piPort>` throughout. Opt in here so tests keep
// exercising the TCP transport, which remains supported for remote and
// container bridges. See change: add-pi-gateway-transport-identity.
process.env.PI_GATEWAY_TCP ??= "1";

// Scrub the dashboard's session-pin env. When the suite itself is run from a
// dashboard-spawned session (a very natural way to work in this repo), the
// child vitest process inherits PI_DASHBOARD_URL / PI_DASHBOARD_SOCKET /
// PI_DASHBOARD_SPAWN_TOKEN / PI_DASHBOARD_SPAWNED — and every suite that
// reads them inherits the LIVE dashboard as a phantom dependency:
// auto-start's pinned-endpoint gate then skips launches suite-wide, and
// spawned faux pi sessions register against the live dashboard instead of
// the test server ("did not register within timeout"). Tests that need a
// pin set their own (per-test) value after this scrub.
// See change: fix-bridge-autostart-port-resolution.
for (const k of [
  "PI_DASHBOARD_URL",
  "PI_DASHBOARD_SOCKET",
  "PI_DASHBOARD_SPAWN_TOKEN",
  "PI_DASHBOARD_SPAWNED",
] as const) {
  delete process.env[k];
}
