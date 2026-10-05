// Ported from InvoiceBot `src/auth/identity-context.tsx`
// (BlackBeltTechnology/invoice-bot-dashboard) WITHOUT its product role read
// (`useAccessMe`); roles come from an optional caller-supplied resolver
// (change: extract-standalone-app-kit, design D8).
//
// ONE React seam the app reads: the identity mode, whether a sign-in flow is
// possible, whether an operator is signed in, who the operator is, an optional
// product role, and the sign-in / sign-out actions. The real value is built
// from `react-oidc-context`; tests and non-OIDC hosts inject a plain value via
// `IdentityProvider`.
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "react-oidc-context";
import type { IdentityMode, Operator } from "../identity-state.js";
import { getIdentityMode, onSessionRefused, setAccessToken, setActingOperator } from "../identity-state.js";

export interface Identity {
  /** The identity mode the bridge rendered for. */
  mode: IdentityMode;
  /** True when a sign-in flow exists (the host published an OIDC provider). */
  available: boolean;
  /** A provider redirect or the callback exchange is in flight. */
  loading: boolean;
  authenticated: boolean;
  operator: Operator | null;
  /** Display label: the operator's username from the provider's claims. */
  username?: string;
  /** Display label: the identity provider's own name (`Keycloak`), when published. */
  providerLabel?: string;
  /** The host's published sign-in entry, when it published one. */
  loginUrl?: string;
  /** The product role from `resolveRole`; `null` when none is resolved. */
  role?: string | null;
  /**
   * True when starting a sign-in actually WORKS: the OIDC client is initialised
   * AND the discovery document has been read. Until then the sign-in control
   * should be disabled, so a click during boot is never a silent no-op.
   */
  signInReady: boolean;
  signIn: () => void;
  signOut: () => void;
}

/** The operator exposed in `none` mode (the host admitted the caller without a credential). */
export const LOCAL_OPERATOR: Operator = Object.freeze({ iss: "local", sub: "local" });

/** Resolves the product role for an operator; `null` = no role. */
export type RoleResolver = (operator: Operator) => Promise<string | null>;

const IdentityContext = createContext<Identity | undefined>(undefined);

/** Read the acting identity. Throws outside an identity provider — a bug, not a state. */
export function useIdentity(): Identity {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside an identity provider");
  return value;
}

/** Read the acting identity, or `undefined` outside an identity provider. */
export function useOptionalIdentity(): Identity | undefined {
  return useContext(IdentityContext);
}

/** Inject an identity value (the real OIDC bridge or a test double). */
export function IdentityProvider({ value, children }: { value: Identity; children: ReactNode }) {
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

/** The operator `(iss, sub)` + username from the provider's validated user. */
export function operatorFromUser(user: { profile?: Record<string, unknown> } | null | undefined): {
  operator: Operator | null;
  username?: string;
} {
  const profile = user?.profile ?? {};
  const iss = typeof profile.iss === "string" ? profile.iss : undefined;
  const sub = typeof profile.sub === "string" ? profile.sub : undefined;
  if (!iss || !sub) return { operator: null };
  const username =
    (typeof profile.preferred_username === "string" && profile.preferred_username) ||
    (typeof profile.name === "string" && profile.name) ||
    (typeof profile.email === "string" && profile.email) ||
    sub;
  return { operator: { iss, sub }, username };
}

/** Resolve the role for `operator`; a missing resolver, a failure or no operator is `null`. */
function useResolvedRole(operator: Operator | null, resolveRole: RoleResolver | undefined): string | null {
  const [role, setRole] = useState<string | null>(null);
  const iss = operator?.iss;
  const sub = operator?.sub;
  useEffect(() => {
    setRole(null);
    if (!resolveRole || !iss || !sub) return;
    let cancelled = false;
    resolveRole({ iss, sub }).then(
      (r) => {
        if (!cancelled) setRole(typeof r === "string" ? r : null);
      },
      () => {
        // A failed read is never a role.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [iss, sub, resolveRole]);
  return role;
}

export interface OidcIdentityBridgeProps {
  loginUrl?: string;
  providerLabel?: string;
  /** Product role source; omitted ⇒ `role` is `null`. */
  resolveRole?: RoleResolver;
  /** Defaults to the module identity mode (`initIdentity`). */
  mode?: IdentityMode;
  children: ReactNode;
}

/**
 * The REAL identity value. In `oidc` mode it is built from `react-oidc-context`
 * (must sit inside its `AuthProvider`): mirrors the live token and operator into
 * the transport state and returns the operator to the sign-in state when the
 * server refuses the token — without re-triggering a redirect loop. In `none`
 * mode it renders the local operator and never touches the OIDC client.
 */
export function OidcIdentityBridge({ mode = getIdentityMode(), ...props }: OidcIdentityBridgeProps) {
  if (mode === "none") return <LocalIdentity {...props} />;
  return <OidcIdentity mode={mode} {...props} />;
}

function LocalIdentity({ resolveRole, children }: Omit<OidcIdentityBridgeProps, "mode">) {
  useEffect(() => {
    setActingOperator(LOCAL_OPERATOR);
    return () => setActingOperator(null);
  }, []);
  const role = useResolvedRole(LOCAL_OPERATOR, resolveRole);
  const value: Identity = {
    mode: "none",
    available: false,
    loading: false,
    authenticated: true,
    operator: LOCAL_OPERATOR,
    role,
    signInReady: false,
    signIn: () => {},
    signOut: () => {},
  };
  return <IdentityProvider value={value}>{children}</IdentityProvider>;
}

function OidcIdentity({ mode, loginUrl, providerLabel, resolveRole, children }: OidcIdentityBridgeProps & { mode: IdentityMode }) {
  const auth = useAuth();
  const user = auth.user ?? null;
  const { operator, username } = useMemo(() => operatorFromUser(user as { profile?: Record<string, unknown> } | null), [user]);

  const token = user?.access_token ?? null;
  useEffect(() => {
    setAccessToken(token);
    setActingOperator(operator);
  }, [token, operator]);

  const role = useResolvedRole(operator, resolveRole);

  // `auth.isLoading` covers the client's own initialisation; the discovery read
  // is a separate, lazily-triggered fetch that `signinRedirect` requires, so it
  // is awaited here and NOT assumed.
  const [metadataReady, setMetadataReady] = useState(false);
  useEffect(() => {
    if (auth.isLoading) return;
    let cancelled = false;
    const metadata = (auth.settings as { metadataService?: { getMetadata: () => Promise<unknown> } } | undefined)?.metadataService;
    if (!metadata) {
      setMetadataReady(true);
      return;
    }
    metadata.getMetadata().then(
      () => {
        if (!cancelled) setMetadataReady(true);
      },
      () => {
        // A failed discovery leaves sign-in disabled: the action would fail anyway.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth.isLoading, auth.settings]);

  useEffect(
    () =>
      onSessionRefused(() => {
        // Clear the local session; do NOT auto-redirect (that would loop).
        setAccessToken(null);
        setActingOperator(null);
        void auth.removeUser();
      }),
    [auth],
  );

  const value: Identity = {
    mode,
    available: true,
    loading: auth.isLoading || auth.activeNavigator === "signinRedirect",
    authenticated: auth.isAuthenticated,
    operator,
    ...(username ? { username } : {}),
    ...(loginUrl ? { loginUrl } : {}),
    ...(providerLabel ? { providerLabel } : {}),
    role,
    signInReady: !auth.isLoading && metadataReady,
    signIn: () => void auth.signinRedirect(),
    signOut: () => {
      setAccessToken(null);
      setActingOperator(null);
      // The provider's own end-session endpoint. A failed end-session call still
      // drops the local user.
      auth.signoutRedirect().catch(() => {
        void auth.removeUser();
      });
    },
  };

  return <IdentityProvider value={value}>{children}</IdentityProvider>;
}
