/**
 * Google endpoint resolution with the test-only override. `PI_E2E_GOOGLE_BASE_URL`
 * redirects authorize/token/revoke to ONE fake-Google server — honoured ONLY for a
 * loopback `http://127.0.0.1:*` or `http://localhost:*` value, so a production
 * install can never be pointed at a foreign token endpoint (same rule as the gmail
 * plugin). See change: add-google-connect.
 */

const GOOGLE_BASE_URL_ENV = "PI_E2E_GOOGLE_BASE_URL";

export interface GoogleEndpoints {
  issuer: string;
  authorize: string;
  token: string;
  revoke: string;
  /** True when the loopback test override is active (plain-HTTP allowed). */
  overridden: boolean;
}

export const GOOGLE_DEFAULTS: GoogleEndpoints = {
  issuer: "https://accounts.google.com",
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  overridden: false,
};

function loopbackBase(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:") return null;
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
  if (u.username || u.password) return null;
  return u.origin;
}

/** A non-loopback override is ignored with ONE warning (the value is not echoed — it may be hostile). */
export function resolveGoogleEndpoints(
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = (m) => console.warn(m),
): GoogleEndpoints {
  const raw = env[GOOGLE_BASE_URL_ENV];
  if (!raw) return GOOGLE_DEFAULTS;
  const base = loopbackBase(raw);
  if (!base) {
    warn(`[google] ${GOOGLE_BASE_URL_ENV} ignored: only http://127.0.0.1:* or http://localhost:* is honoured`);
    return GOOGLE_DEFAULTS;
  }
  return {
    issuer: base,
    authorize: `${base}/o/oauth2/v2/auth`,
    token: `${base}/token`,
    revoke: `${base}/revoke`,
    overridden: true,
  };
}
