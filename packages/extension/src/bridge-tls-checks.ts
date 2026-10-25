/**
 * The per-call TLS checks a REMOTE bridge runs before every credential call
 * (ticket mint, identity challenge, live trust query) and dial, plus the
 * `certValidation` declaration that follows from them.
 *
 * Order (the caller runs `bad-http-url` first, in `resolveDashboardHttpOrigin`):
 *   2. `tls-only-token`     — a `pi_tls_` token to a non-`https` origin
 *   3. `tls-verify-disabled` — `NODE_TLS_REJECT_UNAUTHORIZED=0`, TLS only
 * A refusal means: no bearer is sent and nothing is dialled. `env` is read per
 * call, so a variable flipped at runtime is caught on the next reconnect.
 * Plain `ws`/`http` stays untouched for plain tokens.
 *
 * See change: prove-vault-bridge-tls (D7, D9).
 */
import { TLS_VERIFY_ENV, tlsVerifyDisabled } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { isTlsOnlyToken } from "@blackbelt-technology/pi-dashboard-shared/tls-only-token.js";
import { isRemoteEndpoint } from "./remote-registration-gate.js";

type TlsRefusalCause = "tls-only-token" | "tls-verify-disabled";

export interface TlsRefusal {
  cause: TlsRefusalCause;
  reason: string;
}

function protocolOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol;
  } catch {
    return undefined;
  }
}

/**
 * Check one remote call.
 * - `origin`: the HTTP origin the bearer would go to (absent for a pure dial check).
 * - `token`: the bearer that call would carry.
 * - `dialUrl`: the gateway URL dialled afterwards; a `wss:` dial is a TLS use too.
 */
export function checkTlsCall(input: {
  origin?: string;
  token?: string;
  dialUrl?: string;
  env: Record<string, string | undefined>;
}): TlsRefusal | undefined {
  const originProto = protocolOf(input.origin);
  if (input.token !== undefined && isTlsOnlyToken(input.token) && originProto !== "https:") {
    return {
      cause: "tls-only-token",
      reason:
        `a pi_tls_ token is never sent to a non-https origin (${input.origin ?? "none"}) — ` +
        "use a wss:// PI_DASHBOARD_URL, or set PI_DASHBOARD_HTTP_URL to an https:// origin",
    };
  }
  const usesTls = originProto === "https:" || protocolOf(input.dialUrl) === "wss:";
  if (usesTls && tlsVerifyDisabled(input.env)) {
    return {
      cause: "tls-verify-disabled",
      reason:
        `${TLS_VERIFY_ENV}=0 disables certificate validation, so no bearer is sent and nothing is dialled — ` +
        "unset it and trust a private CA with NODE_EXTRA_CA_CERTS",
    };
  }
  return undefined;
}

/**
 * `"enforced"` when this bridge applied the TLS checks to a connection on
 * `endpoint`: a remote `wss:` endpoint with validation not disabled. Plain `ws`,
 * loopback and the local socket never declare it.
 */
export function certValidationFor(
  endpoint: string,
  env: Record<string, string | undefined> = process.env,
): "enforced" | undefined {
  if (protocolOf(endpoint) !== "wss:" || !isRemoteEndpoint(endpoint)) return undefined;
  return tlsVerifyDisabled(env) ? undefined : "enforced";
}
