/**
 * Same-origin sign-in through the dashboard's own login seam (D14): no second
 * OIDC client. `/api/identity/login-config` → provider `loginUrl?returnTo&challenge`
 * → `returnTo#pi_handoff=<code>` → `tokenUrl` → in-memory bearer (app-kit
 * transport state). Exposes the same `Identity` value the OIDC bridge does, so
 * the Gate / user chip don't care which road is in use.
 * See change: add-team-plugin.
 */
import {
  apiUrl,
  setActingOperator,
  setCredential,
  setIdentityMode,
  type Operator,
} from "@blackbelt-technology/pi-dashboard-app-kit";
import { type Identity, IdentityProvider } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { completeHandoff, readLoginReturn, startSignIn, stripLoginReturn, signOutTarget } from "@dash/lib/identity/dashboard-login";
import type { LoginProvider } from "@dash/lib/identity/login-config";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SeamPhase =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "signedOut"; provider: LoginProvider; error?: string }
  | { kind: "redirecting"; provider: LoginProvider }
  | { kind: "signedIn"; provider: LoginProvider; operator: Operator; username?: string };

export interface SeamDeps {
  fetchFn: typeof fetch;
  storage: Storage;
  origin: string;
  hash: string;
  pathWithSearch: string;
  assign(url: string): void;
  replaceHash(hash: string): void;
}

const SILENT_FLAG = "team:silent-signin-attempted";

function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function operatorFromToken(token: string): { operator: Operator; username?: string } {
  const c = decodeJwt(token);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    operator: { iss: str(c.iss) ?? "unknown", sub: str(c.sub) ?? "unknown", name: str(c.name), username: str(c.preferred_username) },
    username: str(c.preferred_username) ?? str(c.name),
  };
}

function parseProviders(body: unknown): LoginProvider[] | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;
  const list = Array.isArray(rec.providers) ? rec.providers : [rec];
  const out: LoginProvider[] = [];
  for (const p of list) {
    const r = p as Record<string, unknown>;
    if (typeof r.pluginId === "string" || typeof r.loginUrl === "string") {
      out.push({
        pluginId: typeof r.pluginId === "string" ? r.pluginId : "identity",
        loginUrl: typeof r.loginUrl === "string" ? r.loginUrl : undefined,
        logoutUrl: typeof r.logoutUrl === "string" ? r.logoutUrl : undefined,
        tokenUrl: typeof r.tokenUrl === "string" ? r.tokenUrl : undefined,
        postLogoutUrl: typeof r.postLogoutUrl === "string" ? r.postLogoutUrl : undefined,
        label: typeof r.label === "string" ? r.label : undefined,
        silentSignIn: r.silentSignIn === true,
      });
    }
  }
  return out;
}

/** Decide the identity phase at page load. Never throws; fails closed to `unavailable`. */
export async function bootSeam(d: SeamDeps): Promise<SeamPhase> {
  let body: unknown;
  try {
    const res = await d.fetchFn(apiUrl("/api/identity/login-config"), { credentials: "omit" });
    if (!res.ok) return { kind: "unavailable" };
    body = await res.json();
  } catch {
    return { kind: "unavailable" };
  }
  if ((body as { active?: unknown })?.active === false) return { kind: "none" };
  if ((body as { active?: unknown })?.active !== true) return { kind: "unavailable" };
  const provider = parseProviders(body)?.[0];
  if (!provider?.loginUrl || !provider.tokenUrl) return { kind: "unavailable" };

  const ret = readLoginReturn(d.hash);
  if (ret?.kind === "handoff") {
    let token = "";
    const res = await completeHandoff({
      code: ret.code,
      tokenUrl: provider.tokenUrl,
      storage: d.storage,
      fetchFn: d.fetchFn,
      setToken: (t) => {
        token = t;
      },
    });
    d.replaceHash(stripLoginReturn(d.hash));
    if (!res.ok) return { kind: "signedOut", provider, error: res.reason };
    const { operator, username } = operatorFromToken(token);
    setCredential(token, operator);
    d.storage.removeItem(SILENT_FLAG);
    return { kind: "signedIn", provider, operator, username };
  }
  if (ret?.kind === "error") return { kind: "signedOut", provider, error: ret.reason };

  // No credential yet: try a click-free sign-in once per tab session.
  if (provider.silentSignIn && !d.storage.getItem(SILENT_FLAG)) {
    d.storage.setItem(SILENT_FLAG, "1");
    await startSignIn(provider, { origin: d.origin, returnTo: d.pathWithSearch, storage: d.storage, assign: d.assign, silent: true });
    return { kind: "redirecting", provider };
  }
  return { kind: "signedOut", provider };
}

export function SeamIdentityProvider({ children, deps }: { children: ReactNode; deps?: Partial<SeamDeps> }) {
  const [phase, setPhase] = useState<SeamPhase>({ kind: "loading" });
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const realDeps = useCallback(
    (): SeamDeps => ({
      fetchFn: (...a) => fetch(...a),
      storage: sessionStorage,
      origin: window.location.origin,
      hash: window.location.hash,
      pathWithSearch: `${window.location.pathname}${window.location.search}`,
      assign: (u) => window.location.assign(u),
      replaceHash: (h) => window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${h}`),
      ...depsRef.current,
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void bootSeam(realDeps()).then((p) => {
      if (cancelled) return;
      if (p.kind === "none") {
        setIdentityMode("none");
        setActingOperator({ iss: "local", sub: "local" });
      } else if (p.kind === "unavailable") setIdentityMode("unavailable");
      else setIdentityMode("oidc");
      setPhase(p);
    });
    return () => {
      cancelled = true;
    };
  }, [realDeps]);

  const signIn = useCallback(() => {
    if (phase.kind !== "signedOut") return;
    const d = realDeps();
    setPhase({ kind: "redirecting", provider: phase.provider });
    void startSignIn(phase.provider, { origin: d.origin, returnTo: d.pathWithSearch, storage: d.storage, assign: d.assign });
  }, [phase, realDeps]);

  const signOut = useCallback(() => {
    if (phase.kind !== "signedIn") return;
    const d = realDeps();
    setCredential(null, null);
    d.assign(signOutTarget(phase.provider, d.origin));
  }, [phase, realDeps]);

  const value = useMemo<Identity>(
    () => ({
      mode: phase.kind === "none" ? "none" : phase.kind === "unavailable" ? "unavailable" : phase.kind === "loading" ? "unknown" : "oidc",
      available: phase.kind === "signedOut" || phase.kind === "signedIn" || phase.kind === "redirecting",
      loading: phase.kind === "loading" || phase.kind === "redirecting",
      authenticated: phase.kind === "signedIn" || phase.kind === "none",
      operator: phase.kind === "signedIn" ? phase.operator : phase.kind === "none" ? { iss: "local", sub: "local" } : null,
      username: phase.kind === "signedIn" ? phase.username : undefined,
      providerLabel: "provider" in phase ? phase.provider.label : undefined,
      signInReady: phase.kind === "signedOut",
      signIn,
      signOut,
    }),
    [phase, signIn, signOut],
  );

  return <IdentityProvider value={value}>{children}</IdentityProvider>;
}
