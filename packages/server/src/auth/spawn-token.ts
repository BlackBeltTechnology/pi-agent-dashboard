/**
 * Spawn correlation token: server-minted UUIDv4 per `spawnPiSession` call.
 *
 * Flow: `mintSpawnToken()` → injected into spawned process env as
 * `PI_DASHBOARD_SPAWN_TOKEN` → bridge reads it → bridge echoes back in
 * `session_register.spawnToken` → server links via `linkByToken`.
 *
 * In-memory only; no persistence. TTL aligned to spawn-register-watchdog.
 *
 * See change: spawn-correlation-token.
 */
import { randomUUID } from "node:crypto";

/** Mint a fresh UUIDv4 spawn correlation token. */
export function mintSpawnToken(): string {
  return randomUUID();
}

/** Env-var name used for the correlation token in spawned pi processes. */
export const SPAWN_TOKEN_ENV_VAR = "PI_DASHBOARD_SPAWN_TOKEN";
