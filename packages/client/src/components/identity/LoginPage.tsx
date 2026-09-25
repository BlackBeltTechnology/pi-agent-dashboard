/**
 * The core LOGIN PAGE at `/login` (mockup:
 * openspec/changes/add-multi-user-identity-plane/mockups/login-logout.html v3).
 *
 * A FULL page: nothing of the dashboard renders behind it. Brand tile, one
 * heading, and one button per login provider (D25) → the provider's `loginUrl`
 * → IdP, carrying the page's `?returnTo`. Variants:
 *   - not signed in          → "Sign in to pi-dashboard"
 *   - this page had a token  → "Your session has expired"
 *   - `?pi_signed_out=1`     → "You're signed out"
 *   - `#pi_login_error`      → "Couldn't reach the sign-in service" (+ D23 hint)
 *
 * Silent sign-in: a returning user whose IdP session is alive is signed in with
 * NO click (OIDC prompt=none via `silentProviderFor`). Never after an explicit
 * sign-out, an error, or a silent attempt that already came back
 * `login_required` — so it cannot loop.
 *
 * Core still ships no provider UI (D18): buttons only redirect; a COMPONENT
 * provider (optional D16 adapter) is mounted via `LoginGate`.
 */
import { mdiAlert, mdiCheckCircle, mdiClockOutline, mdiLock, mdiLogin } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { LAST_PROVIDER_KEY, silentProviderFor, startSignIn } from "../../lib/identity/dashboard-login.js";
import { providerRedirect, safeReturnTo } from "../../lib/identity/gate.js";
import { fetchLoginConfig, type LoginConfig, type LoginProvider } from "../../lib/identity/login-config.js";
import { type LoginSessionState, useLoginSession } from "../../lib/identity/login-session.js";
import { PiLogo } from "../primitives/PiLogo.js";
import { LoginGate } from "./LoginGate.js";

type Variant = "signin" | "expired" | "signed-out" | "error";
type T = ReturnType<typeof useI18n>["t"];

export function LoginPage(): React.JSX.Element | null {
  const { t } = useI18n();
  const session = useLoginSession();
  const [config, setConfig] = React.useState<LoginConfig | undefined>(undefined);
  const [silentStarted, setSilentStarted] = React.useState(false);
  const [componentStart, setComponentStart] = React.useState(false);
  const origin = window.location.origin;
  const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"), origin);
  const variant = pageVariant(session);

  React.useEffect(() => {
    let alive = true;
    void fetchLoginConfig().then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = React.useCallback(
    (provider: LoginProvider, silent = false) => {
      if (provider.loginUrl === undefined) {
        setComponentStart(true);
        return;
      }
      void startSignIn(provider, { origin, returnTo, silent, storage: window.sessionStorage, assign: (url) => window.location.assign(url) });
    },
    [origin, returnTo],
  );

  // No-click sign-in for a returning user (at most once per page load).
  const silentProvider = config && mayTrySilently(session) ? silentProviderFor(config, readLastProvider()) : undefined;
  React.useEffect(() => {
    if (!silentProvider || silentStarted) return;
    setSilentStarted(true);
    signIn(silentProvider, true);
  }, [silentProvider, silentStarted, signIn]);

  if (config === undefined) return null;
  if (silentProvider) return <SigningInPage />;
  if (componentStart) {
    return <LoginGate phase="start" fallback={<LoginShell>{t("connection.noSignInMethod", undefined, "No sign-in method installed")}</LoginShell>} />;
  }

  const providers = usableProviders(config, origin);
  const copy = pageCopy(variant, providers[0]?.label, t);
  return (
    <LoginShell variant={variant}>
      {copy.icon && <Icon path={copy.icon.path} size={1.15} className={`mx-auto mb-3 ${copy.icon.className}`} />}
      <h1 className={`text-center text-[21px] font-semibold tracking-tight text-[var(--text-primary)] ${copy.body ? "mb-1.5" : "mb-5"}`}>
        {copy.title}
      </h1>
      {copy.body && <p className="mb-5 text-center text-sm text-[var(--text-secondary)]">{copy.body}</p>}
      {providers.length === 0 ? (
        <p className="text-center text-sm text-[var(--text-secondary)]">{t("connection.noSignInMethod", undefined, "No sign-in method installed")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((p, i) => (
            <ProviderButton
              key={p.pluginId}
              provider={p}
              primary={providers.length === 1}
              autoFocus={i === 0}
              text={variant === "error" && providers.length === 1 ? t("identity.tryAgain", undefined, "Try again") : signInWith(p, t)}
              onClick={() => signIn(p)}
            />
          ))}
        </div>
      )}
      {variant === "error" && (
        <p className="mt-3 text-center text-xs text-[var(--text-tertiary)]">
          {t("identity.hostOwner", undefined, "Host owner:")}{" "}
          <code className="whitespace-nowrap rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-1.5 text-[11px]">
            pi-dashboard login --local
          </code>
        </p>
      )}
      {providers.length === 1 && variant !== "error" && providers[0].label && (
        <p className="mt-5 flex items-center justify-center gap-1.5 border-t border-[var(--border-primary)] pt-4 text-xs text-[var(--text-tertiary)]">
          <Icon path={mdiLock} size={0.55} />
          {t("identity.securedBy", { label: providers[0].label }, `Secured by ${providers[0].label}`)}
        </p>
      )}
    </LoginShell>
  );
}

/** Spinner page while the handoff code is exchanged or a silent attempt runs. */
export function SigningInPage(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <LoginShell status>
      <div className="mx-auto h-7 w-7 rounded-full border-[3px] border-[var(--border-secondary)] border-t-[var(--accent-text)] motion-safe:animate-spin" />
      <h1 className="mt-4 text-center text-lg font-semibold text-[var(--text-primary)]">{t("identity.signingInTitle", undefined, "Signing you in")}</h1>
    </LoginShell>
  );
}

/** Full-page frame: fading dot grid, brand tile, card, host footer. */
function LoginShell({ children, variant, status }: { children: React.ReactNode; variant?: Variant; status?: boolean }): React.JSX.Element {
  return (
    <div
      data-testid={status ? "signing-in" : "login-page"}
      data-variant={variant}
      className="relative flex min-h-screen flex-col items-center justify-center overflow-auto bg-[var(--bg-primary)] px-4 pt-6 pb-16"
      style={{ backgroundImage: "radial-gradient(var(--border-secondary) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 55% at 50% 45%, transparent 0%, var(--bg-primary) 78%)" }}
      />
      <div className="relative mb-6 flex flex-col items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border-secondary)] bg-[var(--accent-soft)] text-blue-500 shadow-lg">
          <PiLogo size={30} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">pi-dashboard</span>
      </div>
      <main
        role={status ? "status" : variant === "error" || variant === "expired" ? "alert" : "main"}
        aria-live={status ? "polite" : undefined}
        className="relative w-full max-w-[400px] rounded-2xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-7 pt-8 pb-6 shadow-2xl"
      >
        {children}
      </main>
      <span className="absolute bottom-4 text-[11px] text-[var(--text-muted)]">{window.location.host} · pi-dashboard</span>
    </div>
  );
}

function ProviderButton(props: { provider: LoginProvider; primary: boolean; autoFocus: boolean; text: string; onClick: () => void }): React.JSX.Element {
  const look = props.primary
    ? "bg-[var(--accent-solid)] text-white shadow-md hover:brightness-110"
    : "border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:brightness-110";
  return (
    <button
      type="button"
      autoFocus={props.autoFocus}
      onClick={props.onClick}
      data-testid="signin-btn"
      data-provider={props.provider.pluginId}
      className={`focus-ring flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition active:translate-y-px ${look}`}
    >
      <Icon path={mdiLogin} size={0.65} />
      {props.text}
    </button>
  );
}

/** Providers with a same-origin `loginUrl`, or a component provider (no loginUrl). */
function usableProviders(config: LoginConfig, origin: string): LoginProvider[] {
  if (!config.active) return [];
  return config.providers.filter((p) => p.loginUrl === undefined || providerRedirect(p.loginUrl, origin) !== null);
}

/** Error beats signed-out beats expired beats first sign-in. */
function pageVariant(session: Pick<LoginSessionState, "error" | "signedOut" | "hadToken">): Variant {
  if (session.error) return "error";
  if (session.signedOut) return "signed-out";
  if (session.hadToken) return "expired";
  return "signin";
}

/** Silent sign-in only when nothing says "don't": no error, no sign-out, no prior miss. */
function mayTrySilently(session: LoginSessionState): boolean {
  return !session.error && !session.signedOut && !session.silentMissed;
}

function readLastProvider(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROVIDER_KEY);
  } catch {
    return null;
  }
}

function signInWith(p: LoginProvider, t: T): string {
  return p.label ? t("identity.signInWith", { label: p.label }, `Sign in with ${p.label}`) : t("identity.signIn", undefined, "Sign in");
}

function pageCopy(variant: Variant, label: string | undefined, t: T): { title: string; body?: string; icon?: { path: string; className: string } } {
  switch (variant) {
    case "expired":
      return {
        title: t("identity.expiredTitle", undefined, "Your session has expired"),
        icon: { path: mdiClockOutline, className: "text-[var(--accent-yellow)]" },
      };
    case "signed-out":
      return {
        title: t("identity.signedOutTitle", undefined, "You're signed out"),
        icon: { path: mdiCheckCircle, className: "text-[var(--accent-green)]" },
      };
    case "error": {
      const provider = label ?? t("identity.theSignInService", undefined, "The sign-in service");
      return {
        title: t("identity.errorTitle", undefined, "Couldn't reach the sign-in service"),
        body: t("identity.errorBodyShort", { provider }, `${provider} didn't respond.`),
        icon: { path: mdiAlert, className: "text-[var(--accent-red)]" },
      };
    }
    default:
      return { title: t("identity.signInTitle", undefined, "Sign in to pi-dashboard") };
  }
}
