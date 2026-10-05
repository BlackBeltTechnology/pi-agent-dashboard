// Ported from InvoiceBot `src/auth/oidc-config.ts`
// (BlackBeltTechnology/invoice-bot-dashboard) (change: extract-standalone-app-kit,
// design D6). Lives in `./react` because it returns `react-oidc-context` props.
//
// Authorization Code + PKCE as a PUBLIC client: no client secret exists in the
// browser, and the authorization server + client id come from the host's login
// descriptor at boot — never a literal here. The user (token) lives in
// `sessionStorage`, keyed per issuer + client: it survives a reload within the
// tab session and is never written to durable storage. The descriptor's
// `silentSignIn` (a separate-view `prompt=none` property) is not consulted.
import { WebStorageStateStore } from "oidc-client-ts";
import type { AuthProviderNoUserManagerProps } from "react-oidc-context";
import type { LoginDescriptor } from "../login-descriptor.js";

/** oidc-client-ts's public-client response type (PKCE is applied automatically). */
const AUTHORIZATION_CODE = "code";

export interface BuildOidcConfigOptions {
  /** Where the provider returns the browser; must match the client's registered redirect URI exactly. */
  redirectUri: string;
}

/** Per-realm session store, so a different issuer never reuses another's session. */
function sessionUserStore(descriptor: Pick<LoginDescriptor, "issuer" | "clientId">): WebStorageStateStore {
  const key = `oidc.user:${descriptor.issuer}:${descriptor.clientId}`;
  const store = {
    get length(): number {
      return 0;
    },
    clear(): void {
      window.sessionStorage.removeItem(key);
    },
    getItem(): string | null {
      return window.sessionStorage.getItem(key);
    },
    key(): string | null {
      return null;
    },
    removeItem(): void {
      window.sessionStorage.removeItem(key);
    },
    setItem(_k: string, value: string): void {
      window.sessionStorage.setItem(key, value);
    },
  };
  return new WebStorageStateStore({ store: store as unknown as Storage });
}

/**
 * Build the `AuthProvider` props from the host descriptor: public client, PKCE,
 * silent renewal, session-scoped user store, and a callback that strips the
 * provider's query params from the URL once the code is redeemed.
 */
export function buildOidcConfig(
  descriptor: Pick<LoginDescriptor, "issuer" | "clientId">,
  opts: BuildOidcConfigOptions,
): AuthProviderNoUserManagerProps {
  return {
    authority: descriptor.issuer,
    client_id: descriptor.clientId,
    redirect_uri: opts.redirectUri,
    post_logout_redirect_uri: opts.redirectUri,
    response_type: AUTHORIZATION_CODE,
    automaticSilentRenew: true,
    userStore: sessionUserStore(descriptor),
    onSigninCallback: () => {
      // Remove ?code&state from the address bar so a reload does not replay the
      // exchange (the library has already redeemed it).
      window.history.replaceState({}, document.title, window.location.pathname);
    },
  };
}
