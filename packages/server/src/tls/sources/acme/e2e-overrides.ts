/**
 * E2E test seams (design D10): `PI_E2E_CLOUDFLARE_API` and
 * `PI_E2E_DNS_AUTHORITATIVE`. Honoured ONLY with `PI_E2E_SEED=1` and a host that
 * is `localhost` or under `.test`; anything else is logged and ignored, so a
 * stray seed flag can never send a real token to another host.
 *
 * See change: add-acme-dns01-certs (design D10).
 */
const CLOUDFLARE_API_DEFAULT = "https://api.cloudflare.com/client/v4";

const hostAllowed = (host: string): boolean => host === "localhost" || host.endsWith(".test");

export interface AcmeE2eOverrides {
  cloudflareApiBase: string;
  authoritativeOverride?: { host: string; port: number };
}

export function resolveAcmeE2eOverrides(
  env: NodeJS.ProcessEnv,
  log: { warn(msg: string): void },
): AcmeE2eOverrides {
  const out: AcmeE2eOverrides = { cloudflareApiBase: CLOUDFLARE_API_DEFAULT };
  const cf = env.PI_E2E_CLOUDFLARE_API?.trim();
  const dns = env.PI_E2E_DNS_AUTHORITATIVE?.trim();
  if (!cf && !dns) return out;
  if (env.PI_E2E_SEED !== "1") return out; // seam inactive: silently ignored
  if (cf) {
    try {
      const u = new URL(cf);
      if ((u.protocol === "http:" || u.protocol === "https:") && hostAllowed(u.hostname.toLowerCase())) {
        out.cloudflareApiBase = cf.replace(/\/+$/, "");
      } else {
        log.warn(`PI_E2E_CLOUDFLARE_API refused: host "${u.hostname}" is neither localhost nor under .test`);
      }
    } catch {
      log.warn("PI_E2E_CLOUDFLARE_API refused: not a URL");
    }
  }
  if (dns) {
    const m = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(dns);
    const port = m ? Number(m[2]) : 0;
    if (m && port >= 1 && port <= 65535 && hostAllowed(m[1].toLowerCase())) {
      out.authoritativeOverride = { host: m[1].toLowerCase(), port };
    } else {
      log.warn("PI_E2E_DNS_AUTHORITATIVE refused: expected host:port with a localhost or .test host");
    }
  }
  return out;
}
