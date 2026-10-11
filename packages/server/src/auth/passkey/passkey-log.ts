/**
 * `[passkey]` lifecycle log lines (design D7).
 *
 * Fixed vocabulary, one truncated identifier, nothing else: never codes,
 * challenges, credential ids, User-Agent, IP, or client-controlled text. A
 * non-hex id is hashed rather than echoed, so the line shape
 * `^\[passkey\] [a-z_]+ id=[0-9a-f]{8}$` holds for any input.
 *
 * See change: add-passkey-user-auth.
 */
import crypto from "node:crypto";

export const PASSKEY_EVENTS = [
  "invite_created",
  "enrolled",
  "login",
  "phone_pending",
  "phone_approved",
  "phone_denied",
  "phone_expired",
  "revoked",
  "orphaned",
] as const;

export type PasskeyEvent = (typeof PASSKEY_EVENTS)[number];

export function passkeyLogLine(event: PasskeyEvent, id: string): string {
  const short = /^[0-9a-f]{8}/.test(id) ? id.slice(0, 8) : crypto.createHash("sha256").update(id).digest("hex").slice(0, 8);
  return `[passkey] ${event} id=${short}`;
}

export function logPasskey(event: PasskeyEvent, id: string, log: (line: string) => void = console.log): void {
  log(passkeyLogLine(event, id));
}
