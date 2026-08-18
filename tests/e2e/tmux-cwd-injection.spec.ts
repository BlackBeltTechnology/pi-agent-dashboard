/**
 * L3 — command-injection regression on the tmux spawn path.
 *
 * The harness spawns with `PI_SPAWN_STRATEGY=tmux` (`docker/compose.yml`,
 * `test-entrypoint.sh` default), so every session here is a tmux-spawned pi.
 * The claim under test is about the CONTAINER's filesystem + tmux panes, not
 * the dashboard's own bookkeeping, so the assertions read `/tmp` and
 * `tmux list-panes -a -F '#{pane_current_path}'` inside the container via
 * `docker exec`, out-of-band.
 *
 * Pre-fix, `buildTmuxCommand` returned a shell STRING and `spawnTmux` ran it
 * with `execSync(cmd)`. The cwd was interpolated into a DOUBLE-QUOTED pane
 * segment (`cd <cwd> && pi`), where `/bin/sh` still performs `$(…)`/backtick
 * command substitution and `$VAR` expansion — single-quote escaping is inert
 * there. So a directory whose name contains `$(touch /tmp/PWNED)` executed the
 * substitution when a session was spawned into it.
 *
 * Post-fix, tmux is invoked as argv (`buildSafeArgv` + `execFileSync`,
 * `shell: false`) and the `cd` prefix is dropped — `-c <cwd>` travels as a
 * literal argv element, so the pane opens in the literal directory and nothing
 * extra executes. The pane command is `pi` (or `pi <escaped flags>`), never a
 * `cd`.
 *
 * Exemplar: `tests/e2e/tmux-session-shutdown.spec.ts` (headless `BusClient`
 * against the harness, container inspected out-of-band with `docker exec`,
 * port from `.pi-test-harness.json` via `DASHBOARD_PORT` — never hardcoded).
 *
 * See change: fix-tmux-cwd-command-injection (test-plan #T1, #T2).
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SpawnResultBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Resolve the harness container by the dashboard port it publishes — the same
 * port-derived lookup as `tmux-session-shutdown.spec.ts` (container name is
 * hash-derived per worktree, not knowable here).
 */
function resolveContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

function inContainer(container: string, script: string): string {
  return execFileSync("docker", ["exec", container, "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

/**
 * Check a path exists WITHOUT interpolating it into a shell string — the path
 * is passed as a positional `$1` so `$(…)`, quotes and `;` are inert.
 */
function fileExists(container: string, path: string): boolean {
  const out = execFileSync(
    "docker",
    ["exec", container, "sh", "-c", 'test -e "$1" && echo yes || echo no', "_", path],
    { encoding: "utf8" },
  ).trim();
  return out === "yes";
}

/** Create a directory literally — `mkdir` gets the path as argv, no shell. */
function mkdirLiteral(container: string, path: string): void {
  execFileSync("docker", ["exec", container, "mkdir", "-p", path], { encoding: "utf8" });
}

/** Every pane's current working directory, from tmux (the image has no `ps`). */
function panePaths(container: string): string[] {
  const out = inContainer(
    container,
    "tmux list-panes -a -F '#{pane_current_path}' 2>/dev/null || true",
  );
  return out.split("\n").filter(Boolean);
}

async function withBus<T>(fn: (client: BusClient) => Promise<T>): Promise<T> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Spawn a session and await the `spawn_result` ack — no registration needed. */
async function spawnResult(client: BusClient, cwd: string): Promise<void> {
  const requestId = crypto.randomUUID();
  const result = client.await<SpawnResultBrowserMessage>(
    { type: "spawn_result" },
    { timeout: 45_000 },
  );
  client.send({ type: "spawn_session", cwd, requestId });
  const res = await result;
  expect(res.success, res.message).toBe(true);
}

/** Spawn a session and resolve its id once the bridge registers (session live). */
async function spawnSession(client: BusClient, cwd: string): Promise<string> {
  const before = new Set(client.read.sessions().map((s) => s.id));
  const requestId = crypto.randomUUID();
  const result = client.await<SpawnResultBrowserMessage>(
    { type: "spawn_result" },
    { timeout: 45_000 },
  );
  client.send({ type: "spawn_session", cwd, requestId });
  const res = await result;
  expect(res.success, res.message).toBe(true);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const fresh = client.read.sessions().find((s) => !before.has(s.id));
    if (fresh) return fresh.id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no new session appeared after spawn_result success");
}

test.describe("tmux cwd command injection (L3)", () => {
  test("T1: a cwd containing $(…) is a literal directory — nothing executes", async () => {
    const container = resolveContainer();
    const hostile = "/tmp/$(touch /tmp/PWNED) hostile;x";
    const sentinel = "/tmp/PWNED";

    // Create the LITERAL directory. `mkdir` receives the name as argv (no
    // shell), so `$(touch /tmp/PWNED)` does not expand during setup — the
    // sentinel must not exist before the spawn.
    mkdirLiteral(container, hostile);
    expect(fileExists(container, hostile), "hostile dir must exist").toBe(true);
    expect(fileExists(container, sentinel), "sentinel must not pre-exist").toBe(false);

    await withBus((client) => spawnResult(client, hostile));

    // The injection did NOT fire: the substitution never ran. `spawn_result`
    // already means tmux was invoked, so this needs no wait.
    expect(fileExists(container, sentinel), "command substitution executed").toBe(false);

    // Poll for the pane — `spawn_result` does not mean the pane is registered.
    let paths: string[] = [];
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      paths = panePaths(container);
      if (paths.includes(hostile)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(paths, "no pane opened in the literal hostile directory").toContain(hostile);

    // Re-check after the pane exists: nothing ran during pane startup either.
    expect(fileExists(container, sentinel), "command substitution executed").toBe(false);
  });

  test("T2: -c alone sets the pane cwd for a quote/separator-bearing dir", async () => {
    const container = resolveContainer();
    const dir = `/tmp/a"b'c;d e`;

    mkdirLiteral(container, dir);
    expect(fileExists(container, dir), "dir must exist").toBe(true);

    const panesBefore = panePaths(container).length;

    const sessionId = await withBus((client) => spawnSession(client, dir));
    expect(sessionId, "session did not reach live").toBeTruthy();

    // The pane's working directory is the literal dir — proving `-c` alone
    // sets it once `cd <cwd> &&` is dropped (design D2).
    const paths = panePaths(container);
    expect(paths, "pane did not open in the literal dir").toContain(dir);
    expect(paths.length, "pane count did not increase").toBeGreaterThan(panesBefore);
  });
});
