/**
 * Core browser-login gate (D16). Core owns exactly three things: reading the
 * login descriptor, selecting the trusted resolver's `login-provider` by the
 * host-vouched `pluginId` (never manifest priority, B3/F6), and — on callback —
 * validating the recovered return-to and performing the client-side navigation
 * (a full-page nav would discard the in-memory token). The plugin owns all OIDC.
 *
 * Rendered pre-shell: on `/callback` (callback phase, core-owned route) and from
 * the `auth_required` reconciliation (start phase, H5). When no trusted provider
 * is available — inactive plane, disabled resolver, or a stray `/callback` hit —
 * it renders a provider-agnostic fallback (F5/LG-15) instead of crashing.
 */

import type { SlotPropsMap } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import React from "react";
import { useLocation } from "wouter";
import { PLUGIN_REGISTRY } from "../../generated/plugin-registry.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { resolveGateRedirect, safeReturnTo, selectLoginProvider } from "../../lib/identity/gate.js";
import { fetchLoginConfig, type LoginConfig } from "../../lib/identity/login-config.js";

type Phase = "start" | "callback" | "logout";
type LoginProviderComponent = React.ComponentType<SlotPropsMap["login-provider"]>;

function GateShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center text-neutral-100">
      {children}
    </div>
  );
}

export function LoginGate({ phase, fallback }: { phase: Phase; fallback?: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = React.useState<LoginConfig | undefined>(undefined);
  const [, navigate] = useLocation();

  React.useEffect(() => {
    let alive = true;
    void fetchLoginConfig().then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const origin = window.location.origin;

  // SEPARATE-VIEW provider (D19): the plugin serves its own page, so core's job
  // is a redirect, not a mount. Validated same-origin (open-redirect defence);
  // an absent or unsafe URL falls through to the component path below. `null`
  // until the descriptor resolves — and the hook below must stay unconditional
  // (a hook after an early return breaks the render-order contract).
  const redirectTo =
    config?.active === true
      ? resolveGateRedirect(phase, { loginUrl: config.loginUrl, logoutUrl: config.logoutUrl }, origin)
      : null;

  // Redirect once, after the descriptor resolves. `assign` is a full-page nav —
  // the plugin's view is a separate site on the same origin, so there is nothing
  // in this document to preserve.
  React.useEffect(() => {
    if (redirectTo) window.location.assign(redirectTo);
  }, [redirectTo]);

  if (config === undefined) {
    return (
      <GateShell>
        <p className="text-sm text-neutral-400">{t("login.loading", undefined, "Loading…")}</p>
      </GateShell>
    );
  }

  if (redirectTo) {
    return (
      <GateShell>
        <p className="text-sm text-neutral-400">{t("login.loading", undefined, "Loading…")}</p>
      </GateShell>
    );
  }

  // Enable-filter is enforced server-side: the descriptor is published ONLY for
  // an enabled + trusted resolver (B3/B5), so `active` already implies the
  // owning plugin is live. The unit-tested `isEnabled` path guards the selector
  // against a disabled owner; here it is therefore always satisfied.
  const Provider = (
    config.active
      ? selectLoginProvider({ registry: PLUGIN_REGISTRY, configPluginId: config.pluginId, isEnabled: () => true })
      : null
  ) as LoginProviderComponent | null;

  if (!Provider) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <GateShell>
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
          {t("login.unavailable", undefined, "Sign-in is not available.")}
        </p>
        <a href="/" className="text-sm text-blue-300 underline">
          {t("login.returnHome", undefined, "Return home")}
        </a>
      </GateShell>
    );
  }

  const returnTo =
    phase === "start" ? safeReturnTo(`${window.location.pathname}${window.location.search}`, origin) : "/";

  return (
    <Provider
      phase={phase}
      returnTo={returnTo}
      onComplete={(recovered) => navigate(safeReturnTo(recovered, origin), { replace: true })}
    />
  );
}
