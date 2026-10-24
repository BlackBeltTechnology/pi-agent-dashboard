/**
 * One-shot rotation of secrets that may already have been read through the
 * `~/.pi` file anchor by a bare-loopback caller (the local IPC token and the
 * auth HMAC secret). Runs once per HOME at server start, before anything reads
 * either value.
 *
 * - Exclusive `local/rotation.lock`, claimed with a hard link (atomic, fails
 *   with EEXIST when held). Stale after 30 s or when the holder pid is dead;
 *   the wait is capped at 35 s.
 * - `local/rotation-epoch` below `REQUIRED_ROTATION_EPOCH` → write a new token
 *   (0600, atomic), replace `auth.secret` via `writeConfigFileSecure`, and only
 *   then write the epoch. The epoch is last, so any failure retries the whole
 *   rotation on the next start (a second token rotation is harmless).
 * - Failure is closed: callers exit 1 before listening (`RotationError`).
 *
 * `close-loopback-legacy-window` reuses this lock and raises the epoch to 2.
 * See change: close-container-loopback-impersonation (D11).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeConfigFileSecure } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

/** Bump (never reuse) when another one-time rotation becomes necessary. */
export const REQUIRED_ROTATION_EPOCH = 1;
const ROTATION_LOCK_STALE_MS = 30_000;
export const ROTATION_LOCK_WAIT_CAP_MS = 35_000;
const POLL_MS = 100;
const TOKEN_BYTES = 32;

/** The failed step is named so the single log line tells the operator what to look at. */
export class RotationError extends Error {
  readonly step: "lock" | "token" | "secret" | "epoch";
  readonly paths: { lock: string; epoch: string };

  constructor(step: "lock" | "token" | "secret" | "epoch", message: string, paths: { lock: string; epoch: string }) {
    super(message);
    this.name = "RotationError";
    this.step = step;
    this.paths = paths;
  }

  /** One line: step, cause, lock and epoch paths. */
  describe(): string {
    return `[rotation] secret rotation failed at step=${this.step}: ${this.message} (lock=${this.paths.lock} epoch=${this.paths.epoch}); exiting before listen`;
  }
}

export interface RotationDeps {
  /** `~/.pi/dashboard/local` */
  localDir?: string;
  /** `~/.pi/dashboard/config.json` */
  configFile?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isPidAlive?: (pid: number) => boolean;
  /** Replaces `writeConfigFileSecure` (fault injection). */
  writeConfig?: (file: string, text: string) => void;
}

export interface RotationResult {
  rotated: boolean;
  /** The replacement `auth.secret`, when one existed to replace. */
  newSecret?: string;
}

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      /* best-effort (Windows) */
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw err;
  }
}

function readEpoch(file: string): number {
  try {
    const n = Number.parseInt(fs.readFileSync(file, "utf-8").trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

interface LockBody {
  pid: number;
  at: number;
}

function readLock(lock: string): LockBody | null {
  try {
    const body = JSON.parse(fs.readFileSync(lock, "utf-8")) as Partial<LockBody>;
    if (typeof body.pid === "number" && typeof body.at === "number") return { pid: body.pid, at: body.at };
  } catch {
    /* unreadable / half-written: judged by mtime below */
  }
  return null;
}

/** Try once. `true` when this process now holds the lock. */
function tryClaim(lock: string, now: () => number, isPidAlive: (pid: number) => boolean, stalePath: () => string): boolean {
  const mine = `${lock}.${process.pid}.${crypto.randomUUID()}`;
  fs.writeFileSync(mine, JSON.stringify({ pid: process.pid, at: now() } satisfies LockBody), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.linkSync(mine, lock); // atomic; EEXIST when held
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      const held = readLock(lock);
      let stale: boolean;
      if (held) {
        stale = now() - held.at > ROTATION_LOCK_STALE_MS || !isPidAlive(held.pid);
      } else {
        // Half-written or foreign content: fall back to the file's age.
        try {
          stale = now() - fs.statSync(lock).mtimeMs > ROTATION_LOCK_STALE_MS;
        } catch {
          stale = true; // vanished between link and stat → retry the link
        }
      }
      if (!stale) return false;
      // Move (not unlink) the stale lock aside: rename is atomic, so exactly one
      // contender removes it and a fresh lock claimed since is not unlinked by name.
      try {
        fs.renameSync(lock, stalePath());
      } catch {
        /* someone else cleared it first */
      }
    }
    return false;
  } finally {
    try {
      fs.unlinkSync(mine);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Rotate the local token and `auth.secret` once per HOME. Idempotent: a second
 * call (or a second process) finds the epoch and returns `{ rotated: false }`.
 * Throws `RotationError` on any failure; the epoch is then still unwritten.
 */
export async function rotateSecretsOnce(deps: RotationDeps = {}): Promise<RotationResult> {
  const dashDir = getDashboardConfigDir();
  const localDir = deps.localDir ?? path.join(dashDir, "local");
  const configFile = deps.configFile ?? path.join(os.homedir(), ".pi", "dashboard", "config.json");
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const isPidAlive = deps.isPidAlive ?? ((pid: number) => isProcessAlive(pid, { epermAlive: true }));
  const writeConfig = deps.writeConfig ?? writeConfigFileSecure;

  const lockPath = path.join(localDir, "rotation.lock");
  const epochPath = path.join(localDir, "rotation-epoch");
  const tokenPath = path.join(localDir, "token");
  const paths = { lock: lockPath, epoch: epochPath };
  const fail = (step: RotationError["step"], err: unknown): never => {
    throw new RotationError(step, err instanceof Error ? err.message : String(err), paths);
  };

  // Cheap path: already rotated, no lock needed.
  if (readEpoch(epochPath) >= REQUIRED_ROTATION_EPOCH) return { rotated: false };

  try {
    fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(localDir, 0o700);
    } catch {
      /* best-effort (Windows) */
    }
  } catch (err) {
    return fail("lock", err);
  }

  const started = now();
  let claimed = false;
  const stalePath = () => `${lockPath}.stale.${process.pid}.${crypto.randomUUID()}`;
  while (!claimed) {
    try {
      claimed = tryClaim(lockPath, now, isPidAlive, stalePath);
    } catch (err) {
      return fail("lock", err);
    }
    if (claimed) break;
    if (now() - started >= ROTATION_LOCK_WAIT_CAP_MS) {
      return fail("lock", new Error(`rotation.lock still held after ${ROTATION_LOCK_WAIT_CAP_MS / 1000}s`));
    }
    await sleep(POLL_MS);
  }

  try {
    // Another process may have finished while we waited.
    if (readEpoch(epochPath) >= REQUIRED_ROTATION_EPOCH) return { rotated: false };

    try {
      atomicWrite(tokenPath, crypto.randomBytes(TOKEN_BYTES).toString("base64url"));
    } catch (err) {
      return fail("token", err);
    }

    let newSecret: string | undefined;
    try {
      if (fs.existsSync(configFile)) {
        const parsed = JSON.parse(fs.readFileSync(configFile, "utf-8")) as { auth?: { secret?: unknown } } | null;
        if (parsed && typeof parsed === "object" && parsed.auth && typeof parsed.auth.secret === "string" && parsed.auth.secret) {
          newSecret = crypto.randomBytes(32).toString("hex"); // 32 bytes, as `ensureAuthSecret` (harden-auth-credentials B17)
          parsed.auth.secret = newSecret;
          writeConfig(configFile, `${JSON.stringify(parsed, null, 2)}\n`);
        }
      }
    } catch (err) {
      return fail("secret", err);
    }

    try {
      atomicWrite(epochPath, `${REQUIRED_ROTATION_EPOCH}\n`);
    } catch (err) {
      return fail("epoch", err);
    }
    return { rotated: true, ...(newSecret ? { newSecret } : {}) };
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  }
}
