/**
 * Local-IPC allowlist token (D10, narrowed).
 *
 * An affirmative genuine-local credential for same-host process callers (CLI
 * tools, the model proxy) that grants the auth exemption WITHOUT relying on the
 * TCP loopback address alone (which a tunnel can forge). The token is a
 * high-entropy secret written to `~/.pi/dashboard/local/token` with the parent
 * dir `0700` and the file `0600`, so only the same OS user can read it. A caller
 * presents it via the `X-Pi-Local-Token` header; a remote attacker over a
 * tunnel cannot read the file, so cannot forge the header.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOCAL_TOKEN_HEADER = "x-pi-local-token";
const TOKEN_BYTES = 32;

export function defaultLocalTokenDir(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "local");
}

/**
 * Ensure the local IPC token exists (0700 dir, 0600 file) and return it.
 * Regenerated only if absent — a restart reuses it so live local callers keep
 * working across a server restart.
 */
export function ensureLocalToken(dir = defaultLocalTokenDir()): string {
  const file = path.join(dir, "token");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Enforce 0700 even if the dir pre-existed with a looser mode.
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best-effort (e.g. Windows) */
  }
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf-8").trim();
    if (existing) return existing;
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  fs.writeFileSync(file, token, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort */
  }
  return token;
}

/** Constant-time compare of a presented local-token header against expected. */
export function verifyLocalToken(
  headers: Record<string, unknown> | undefined,
  expected: string,
): boolean {
  const raw = headers?.[LOCAL_TOKEN_HEADER];
  const presented = Array.isArray(raw) ? raw[0] : raw;
  if (typeof presented !== "string" || presented.length === 0) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
