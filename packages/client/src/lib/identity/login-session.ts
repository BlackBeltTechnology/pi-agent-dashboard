/**
 * Page-lifetime login state for the dashboard-UI login seam (D22 + login page).
 *
 * `bootLoginSession` runs once in `main.tsx` BEFORE <App/> mounts. Phase starts
 * `checking` (the root renders nothing) until it has decided:
 *   - `#pi_handoff=<code>`      → exchange at `tokenUrl` (phase `signing-in`).
 *   - `#pi_login_error=<why>`   → remembered for the login page; `login_required`
 *                                 (a silent attempt found no IdP session) is NOT
 *                                 an error — the page just waits for a click.
 *   - `?pi_signed_out=1`        → the "You're signed out" variant.
 *   - enforced + no token       → straight to `/login?returnTo=<target>`, so no
 *                                 dashboard ever renders while signed out.
 * Memory only; a reload starts fresh (D22: no cookies, no stored credential).
 */
import { useSyncExternalStore } from "react";
import {
  completeHandoff,
  LAST_PROVIDER_KEY,
  LOGIN_PATH,
  LOGIN_REQUIRED,
  loginPathFor,
  PROVIDER_KEY,
  readLoginReturn,
  SIGNED_OUT_PARAM,
  stripLoginReturn,
} from "./dashboard-login.js";
import { type LoginConfig, providerById } from "./login-config.js";

export interface LoginSessionState {
  phase: "checking" | "idle" | "signing-in";
  hadToken: boolean;
  signedOut: boolean;
  error?: string;
  /** A silent (prompt=none) attempt came back `login_required`: show the page, don't retry. */
  silentMissed?: boolean;
  /** The login provider this page signed in with (user line label, sign-out target; D25). */
  providerId?: string;
}

const INITIAL: LoginSessionState = { phase: "checking", hadToken: false, signedOut: false };
let state: LoginSessionState = INITIAL;
const listeners = new Set<() => void>();

function update(patch: Partial<LoginSessionState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getLoginSession(): LoginSessionState {
  return state;
}

export function subscribeLoginSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLoginSession(): LoginSessionState {
  return useSyncExternalStore(subscribeLoginSession, getLoginSession, getLoginSession);
}

export interface BootDeps {
  location: Pick<Location, "pathname" | "search" | "hash">;
  history: Pick<History, "state" | "replaceState">;
  storage: Storage;
  fetchFn: typeof fetch;
  fetchConfig: () => Promise<LoginConfig>;
  setToken: (accessToken: string, expiresInSeconds: number) => void;
  setIdToken?: (idToken: string) => void;
  hasToken: () => boolean;
  /** localStorage: remembers the last-used provider for the silent sign-in (not a credential). */
  persist: Pick<Storage, "setItem">;
  /** Client-side route change (replace), so the root switches to the login page. */
  navigate: (to: string) => void;
}

/** Routes the boot redirect never leaves (they own their own flow). */
const PRE_SHELL_ROUTES = new Set([LOGIN_PATH, "/pair", "/callback", "/logout"]);

/** Consume the login plugin's return markers once, then decide login page vs dashboard. */
export async function bootLoginSession(deps: BootDeps): Promise<void> {
  const { location: loc } = deps;
  const ret = readLoginReturn(loc.hash);
  const search = new URLSearchParams(loc.search);
  const signedOut = search.get(SIGNED_OUT_PARAM) === "1";
  search.delete(SIGNED_OUT_PARAM);
  const qs = search.toString();
  const here = `${loc.pathname}${qs ? `?${qs}` : ""}`;

  // Strip first, before any await, so the one-time code never lingers.
  if (ret || signedOut) deps.history.replaceState(deps.history.state, "", `${here}${stripLoginReturn(loc.hash)}`);
  if (signedOut) update({ signedOut: true });
  if (ret?.kind === "error") update(ret.reason === LOGIN_REQUIRED ? { silentMissed: true } : { error: ret.reason });
  if (ret?.kind === "handoff") update({ phase: "signing-in" });

  let config: LoginConfig;
  try {
    config = await deps.fetchConfig();
  } catch {
    // Fail open to the dashboard: the server floor (D24) still refuses data.
    update({ phase: "idle" });
    return;
  }
  if (ret?.kind === "handoff") await redeemHandoff(ret.code, config, deps);
  if (config.active === true && !deps.hasToken() && !PRE_SHELL_ROUTES.has(loc.pathname)) deps.navigate(loginPathFor(here));
  update({ phase: "idle" });
}

/** Redeem at the tokenUrl of the provider that STARTED the sign-in (D25). */
async function redeemHandoff(code: string, config: LoginConfig, deps: BootDeps): Promise<void> {
  const provider = providerById(config, deps.storage.getItem(PROVIDER_KEY)) ?? config.providers[0];
  deps.storage.removeItem(PROVIDER_KEY);
  const result = provider?.tokenUrl
    ? await completeHandoff({
        code,
        tokenUrl: provider.tokenUrl,
        storage: deps.storage,
        fetchFn: deps.fetchFn,
        setToken: deps.setToken,
        setIdToken: deps.setIdToken,
      })
    : ({ ok: false, reason: "exchange_failed" } as const);
  if (!result.ok || !provider) {
    update({ error: result.ok ? "exchange_failed" : result.reason });
    return;
  }
  deps.persist.setItem(LAST_PROVIDER_KEY, provider.pluginId);
  update({ hadToken: true, error: undefined, providerId: provider.pluginId });
}

/**
 * Sign-in lost mid-page (expiry, server restart…): where to send the tab, or
 * null. Nothing of the dashboard stays on screen while signed out.
 */
export function loginRedirectFor(status: string, pathname: string, search: string): string | null {
  if (status !== "auth_required" || pathname === LOGIN_PATH) return null;
  return loginPathFor(`${pathname}${search}`);
}

/** Test seam. */
export function setLoginSessionForTests(patch: Partial<LoginSessionState>): void {
  update(patch);
}

/** Test seam. */
export function resetLoginSessionForTests(): void {
  state = INITIAL;
  for (const l of listeners) l();
}
