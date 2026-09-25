/**
 * Dashboard-UI login seam (openspec add-multi-user-identity-plane, D22).
 *
 * The dashboard SPA is the frontend; a trusted login plugin owns the IdP flow.
 * No cookies anywhere:
 *   1. `startSignIn` makes a PKCE pair, keeps ONLY the verifier in
 *      `sessionStorage` (it is not a credential), and navigates the tab straight
 *      to the plugin's `loginUrl?returnTo=…&challenge=…`. The plugin redirects to
 *      the IdP at once.
 *   2. The plugin returns to `returnTo#pi_handoff=<one-time code>` (or
 *      `#pi_login_error=<reason>`). `readLoginReturn` reads it; the caller strips
 *      the fragment immediately via `stripLoginReturn`.
 *   3. `completeHandoff` POSTs `{code, verifier}` to the plugin's `tokenUrl` and
 *      stores the bearer IN MEMORY only (`token-store`). The fetch wrapper and
 *      the WS ticket path already present that store.
 *   4. `signOutTarget` → the plugin's `logoutUrl?returnTo=/`, which ends the IdP
 *      session and lands on its `postLogoutUrl`.
 *
 * Every function takes its DOM dependencies as arguments so it unit-tests
 * without a browser.
 */
import { createPkcePair, type PkcePair } from "@blackbelt-technology/pi-dashboard-client-utils/identity/pkce";
import { providerRedirect, safeReturnTo } from "./gate.js";
import type { LoginConfig, LoginProvider } from "./login-config.js";

/** sessionStorage key for the in-flight PKCE verifier (never a credential). */
export const VERIFIER_KEY = "pi-dashboard:login-verifier";
/** sessionStorage: which provider started the in-flight sign-in (D25; not a credential). */
export const PROVIDER_KEY = "pi-dashboard:login-provider";
/** localStorage: the provider last signed in with — picks the silent sign-in (not a credential). */
export const LAST_PROVIDER_KEY = "pi-dashboard:last-login-provider";
/** Signed-out landing marker (`/login?pi_signed_out=1`). */
export const SIGNED_OUT_PARAM = "pi_signed_out";

/** The core login page (a full page; nothing of the dashboard renders). */
export const LOGIN_PATH = "/login";
/** OIDC "no usable IdP session" marker returned by a silent attempt. */
export const LOGIN_REQUIRED = "login_required";

/** `/login` carrying where the user was going; `/` and `/login…` collapse. */
export function loginPathFor(target: string): string {
  if (!target || target === "/" || target === LOGIN_PATH || target.startsWith(`${LOGIN_PATH}?`)) return LOGIN_PATH;
  return `${LOGIN_PATH}?returnTo=${encodeURIComponent(target)}`;
}

const HANDOFF_KEY = "pi_handoff";
const ERROR_KEY = "pi_login_error";

/** `loginUrl?returnTo=<validated>&challenge=<S256>`, or null for an unsafe loginUrl. */
export function buildSignInUrl(
  loginUrl: string | undefined,
  returnTo: string,
  challenge: string,
  origin: string,
  silent = false,
): string | null {
  const base = providerRedirect(loginUrl, origin);
  if (!base) return null;
  const url = new URL(base, origin);
  url.searchParams.set("returnTo", safeReturnTo(returnTo, origin));
  url.searchParams.set("challenge", challenge);
  if (silent) url.searchParams.set("prompt", "none");
  return `${url.pathname}${url.search}`;
}

export interface StartSignInDeps {
  origin: string;
  returnTo: string;
  storage: Storage;
  assign: (url: string) => void;
  pkce?: () => Promise<PkcePair>;
  /** OIDC prompt=none: sign in with no click when the IdP session is alive. */
  silent?: boolean;
}

/** Navigate the tab straight to the login plugin (no intermediate page). */
export async function startSignIn(provider: Pick<LoginProvider, "pluginId" | "loginUrl">, deps: StartSignInDeps): Promise<void> {
  if (!providerRedirect(provider.loginUrl, deps.origin)) return;
  const { verifier, challenge } = await (deps.pkce ?? createPkcePair)();
  const target = buildSignInUrl(provider.loginUrl, deps.returnTo, challenge, deps.origin, deps.silent === true);
  if (!target) return;
  deps.storage.setItem(VERIFIER_KEY, verifier);
  deps.storage.setItem(PROVIDER_KEY, provider.pluginId);
  deps.assign(target);
}

/**
 * Which provider may sign in with no click (OIDC prompt=none): the only one,
 * or — with several — the one last signed in with. Only if it declares
 * `silentSignIn`; otherwise the login page waits for a click (D25).
 */
export function silentProviderFor(config: Pick<LoginConfig, "providers">, lastProviderId: string | null): LoginProvider | undefined {
  const candidate =
    config.providers.length === 1 ? config.providers[0] : config.providers.find((p) => p.pluginId === lastProviderId);
  return candidate?.silentSignIn === true ? candidate : undefined;
}

export type LoginReturn = { kind: "handoff"; code: string } | { kind: "error"; reason: string };

function hashParams(hash: string | null | undefined): URLSearchParams {
  return new URLSearchParams(hash?.startsWith("#") ? hash.slice(1) : (hash ?? ""));
}

/** What the plugin sent back in the fragment, or null for an ordinary page load. */
export function readLoginReturn(hash: string | null | undefined): LoginReturn | null {
  const p = hashParams(hash);
  const code = p.get(HANDOFF_KEY);
  if (code) return { kind: "handoff", code };
  const reason = p.get(ERROR_KEY);
  if (reason) return { kind: "error", reason };
  return null;
}

/** Remove the keys this module owns, keeping any other fragment. */
export function stripLoginReturn(hash: string): string {
  const p = hashParams(hash);
  p.delete(HANDOFF_KEY);
  p.delete(ERROR_KEY);
  const rest = p.toString();
  return rest ? `#${rest}` : "";
}

export type HandoffResult = { ok: true } | { ok: false; reason: "missing_verifier" | "exchange_failed" };

/** Exchange the one-time code for an in-memory bearer. Fails closed. */
export async function completeHandoff(opts: {
  code: string;
  tokenUrl: string;
  storage: Storage;
  fetchFn: typeof fetch;
  setToken: (accessToken: string, expiresInSeconds: number) => void;
  /** Keeps the IdP id_token in memory — only ever sent back as `id_token_hint` on sign-out. */
  setIdToken?: (idToken: string) => void;
}): Promise<HandoffResult> {
  const verifier = opts.storage.getItem(VERIFIER_KEY);
  opts.storage.removeItem(VERIFIER_KEY);
  if (!verifier) return { ok: false, reason: "missing_verifier" };
  // Defence in depth (the host already sanitises it): the code + verifier are
  // only ever posted to a same-origin PATH.
  if (!isSameOriginPath(opts.tokenUrl)) return { ok: false, reason: "exchange_failed" };
  try {
    const res = await opts.fetchFn(opts.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: opts.code, verifier }),
    });
    if (!res.ok) return { ok: false, reason: "exchange_failed" };
    const data = (await res.json()) as { access_token?: unknown; id_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string" || data.access_token.length === 0) return { ok: false, reason: "exchange_failed" };
    const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 0;
    opts.setToken(data.access_token, expiresIn);
    if (typeof data.id_token === "string" && data.id_token.length > 0) opts.setIdToken?.(data.id_token);
    return { ok: true };
  } catch {
    return { ok: false, reason: "exchange_failed" };
  }
}

/** Where Sign out navigates: the plugin's logoutUrl, else the signed-out landing. */
export function signOutTarget(provider: Pick<LoginProvider, "logoutUrl"> | undefined, origin: string, idToken?: string | null): string {
  const logout = providerRedirect(provider?.logoutUrl, origin);
  if (!logout) return `${LOGIN_PATH}?${SIGNED_OUT_PARAM}=1`;
  const url = new URL(logout, origin);
  url.searchParams.set("returnTo", LOGIN_PATH);
  // OIDC RP-initiated logout: the IdP then knows who leaves and skips its confirm page.
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  return `${url.pathname}${url.search}`;
}

/** A same-origin path: `/x`, never `//host`, `/\\host`, or an absolute / scheme URL. */
function isSameOriginPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return false;
  try {
    return new URL(value, "http://origin.invalid").origin === "http://origin.invalid";
  } catch {
    return false;
  }
}
