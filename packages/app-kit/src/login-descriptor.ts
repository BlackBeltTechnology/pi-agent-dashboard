// Ported from InvoiceBot `src/auth/login-descriptor.ts`
// (BlackBeltTechnology/invoice-bot-dashboard); generalised with identity modes
// (change: extract-standalone-app-kit, design D3).
//
// The SPA is a public OIDC client and needs the host's COMPONENT descriptor kind
// `{ issuer, clientId }` — read at boot from the pre-auth relay
// `GET /api/identity/login-config`, never hard-coded. Outcomes:
//   • active + issuer + clientId → `oidc`
//   • `{active:false}`           → `none` (no OIDC provider; NOT "no auth" — the
//                                   host still decides admission per caller)
//   • anything else (transport error, non-2xx, malformed body, an active
//     separate-view provider without issuer/clientId) → `unavailable`, which
//     fails CLOSED: it never selects `none`.
import { apiUrl } from "./config.js";
import { setIdentityMode } from "./identity-state.js";

export interface LoginDescriptor {
  issuer: string;
  clientId: string;
  /** The provider's sign-in entry, when published. */
  loginUrl?: string;
  /** The provider's own display name (`Keycloak`), when the deployment names one. */
  label?: string;
}

export type LoginDescriptorResult =
  | { ok: true; mode: "oidc"; descriptor: LoginDescriptor }
  | { ok: false; mode: "none"; reason: "inactive" }
  | { ok: false; mode: "unavailable"; reason: "unavailable" };

export interface FetchLoginDescriptorOptions {
  fetchImpl?: typeof fetch;
}

const UNAVAILABLE: LoginDescriptorResult = { ok: false, mode: "unavailable", reason: "unavailable" };

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Read the dashboard's login descriptor — without a bearer and without cookies.
 * Never throws.
 */
export async function fetchLoginDescriptor(opts: FetchLoginDescriptorOptions = {}): Promise<LoginDescriptorResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(apiUrl("/api/identity/login-config"), { credentials: "omit" });
    if (!res.ok) return UNAVAILABLE;
    const body = (await res.json()) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return UNAVAILABLE;
    const record = body as Record<string, unknown>;
    if (record.active === false) return { ok: false, mode: "none", reason: "inactive" };
    if (record.active !== true) return UNAVAILABLE;
    // The top-level fields mirror the first provider.
    const issuer = str(record.issuer);
    const clientId = str(record.clientId);
    if (!issuer || !clientId) return UNAVAILABLE;
    const loginUrl = str(record.loginUrl);
    const label = str(record.label);
    return {
      ok: true,
      mode: "oidc",
      descriptor: { issuer, clientId, ...(loginUrl ? { loginUrl } : {}), ...(label ? { label } : {}) },
    };
  } catch {
    return UNAVAILABLE;
  }
}

/** Read the descriptor and set the identity mode from it. */
export async function initIdentity(opts: FetchLoginDescriptorOptions = {}): Promise<LoginDescriptorResult> {
  const result = await fetchLoginDescriptor(opts);
  setIdentityMode(result.mode);
  return result;
}
