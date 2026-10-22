/**
 * Pure resolver for the absolute origin used in `GET /api/sessions` `uiUrl` /
 * `diffUrl`: the origin the caller actually used, never a reflected raw header.
 *
 * 1. Configured match — the first of (first `X-Forwarded-Host` value, `Host`)
 *    whose normalized hostname equals a configured origin's hostname selects
 *    that origin (scheme + port from the configured entry).
 * 2. Admitted direct host — `Host` passes `isAdmitted` (checked even when the
 *    host gate runs in `report` mode): `<protocol>://<normalized host>[:port]`.
 * 3. Otherwise `<protocol>://localhost:<port>` — deliberately NOT
 *    `resolveRedirectBase`, which would hand the tunnel origin to an unadmitted
 *    caller in report mode.
 *
 * `X-Forwarded-Host` can only SELECT a configured origin; it never mints one.
 * See change: add-session-ui-deep-links-for-agents (D1).
 */
import { hostnameFromUrl, parseHostname } from "@blackbelt-technology/pi-dashboard-shared/host-admission.js";

export interface UiBaseInput {
  /** Raw `Host` header. */
  host: string | undefined;
  /** Raw `X-Forwarded-Host` header (only its first comma-separated value is read). */
  forwardedHost: string | undefined;
  /** `request.protocol` (accurate for direct connections; `trustProxy` is off). */
  protocol: string;
  /** Public bases, every live tunnel origin and `auth.redirectBaseUrl`, in precedence order. */
  configuredOrigins: string[];
  /** `isHostAdmitted` bound to the server's current options. */
  isAdmitted: (hostHeader: string | undefined) => boolean;
  /** The server's listening port. */
  port: number;
}

const stripSlashes = (s: string): string => s.replace(/\/+$/, "");

/** Trailing `:digits` of a raw Host (after `]` for IPv6), only when 1–65535. */
function validPort(hostHeader: string): string | null {
  const m = /:(\d{1,5})$/.exec(hostHeader.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 65535 ? String(n) : null;
}

/** Configured origin whose hostname equals the first matching candidate (candidate order, then origin order). */
function matchConfiguredOrigin(candidates: string[], origins: string[]): string | null {
  for (const candidate of candidates) {
    for (const origin of origins) {
      if (hostnameFromUrl(origin) !== candidate) continue;
      try {
        return stripSlashes(new URL(origin).origin);
      } catch {
        // unparseable entry: skip, never throw
      }
    }
  }
  return null;
}

/** `<protocol>://<normalized host>[:port]` for an admitted `Host`, else null. */
function admittedDirectBase(input: UiBaseInput): string | null {
  if (input.host === undefined || !input.isAdmitted(input.host)) return null;
  const hostname = parseHostname(input.host);
  if (!hostname) return null;
  const bracketed = hostname.includes(":") ? `[${hostname}]` : hostname;
  const port = validPort(input.host);
  return `${input.protocol}://${bracketed}${port ? `:${port}` : ""}`;
}

export function resolveRequestUiBase(input: UiBaseInput): string {
  const firstForwarded = input.forwardedHost?.split(",")[0];
  const candidates = [parseHostname(firstForwarded), parseHostname(input.host)].filter(
    (h): h is string => h !== null,
  );
  return (
    matchConfiguredOrigin(candidates, input.configuredOrigins) ??
    admittedDirectBase(input) ??
    `${input.protocol}://localhost:${input.port}`
  );
}
