/**
 * Spawn-correlation token: read + scrubbed ONCE at bridge activation, kept in
 * process-global state until the first `session_register` consumes it.
 *
 * Why at activation (not at first register): the bridge's `project_trust`
 * decision treats a process as dashboard-spawned from this capture, and a pi
 * the agent starts later must never inherit the token — even while the dashboard
 * is unreachable and no register has happened. Process-global (like
 * `BRIDGE_KEY`) so a `/reload` before the first register keeps the value.
 *
 * See change: mirror-dashboard-trust-to-pi, fix-spawn-token-env-leak.
 */
const ENV_VAR = "PI_DASHBOARD_SPAWN_TOKEN";
const KEY = "__pi_dashboard_spawn_token__";

type Holder = { [KEY]?: string };

/**
 * Capture-once, idempotent: remove the token from the environment and keep a
 * NON-EMPTY value for the first register. Returns whether this process is
 * dashboard-spawned (a non-empty token was present). A repeat call after the
 * env is gone (reload) returns `false` and never overwrites the kept token —
 * callers persist the first result (`BridgeState.dashboardSpawned`).
 */
export function captureSpawnTokenAtActivation(): boolean {
  const token = process.env[ENV_VAR];
  delete process.env[ENV_VAR];
  if (typeof token === "string" && token.length > 0) {
    (process as unknown as Holder)[KEY] = token;
    return true;
  }
  return false;
}

/** Consume-once: the kept token (first caller wins), then `undefined`. */
export function consumeSpawnToken(): string | undefined {
  const holder = process as unknown as Holder;
  const token = holder[KEY];
  delete holder[KEY];
  return token;
}

/** Test seam: forget any kept token. */
export function __resetSpawnToken(): void {
  delete (process as unknown as Holder)[KEY];
}
