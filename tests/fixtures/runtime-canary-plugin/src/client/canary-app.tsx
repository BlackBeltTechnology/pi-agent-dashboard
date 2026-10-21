import { defineDashboardApp, useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useEffect, useState } from "react";
import { Route, Switch } from "wouter";

function CanaryApp() {
  const host = useAppHost();
  const [health, setHealth] = useState<number | null>(null);
  useEffect(() => {
    // `host.api.fetch` works in both builds: the embedded host's shell transport and the standalone authed transport.
    void host.api.fetch("/api/health").then((r) => setHealth(r.status));
  }, [host]);
  return (
    <div data-testid="canary-app" className="p-3 text-[var(--text-primary)]">
      <span data-testid="canary-app-mode">{host.mode}</span>
      <span data-testid="canary-app-dashboard-cap">{String(host.capabilities.dashboard)}</span>
      <span data-testid="canary-app-health">{health ?? "pending"}</span>
      <Switch>
        <Route path="/sub"><div data-testid="canary-view-sub">sub</div></Route>
        <Route><div data-testid="canary-view-home">home</div></Route>
      </Switch>
    </div>
  );
}

export const canaryApp = defineDashboardApp({ id: "runtime-canary", title: "Runtime canary", App: CanaryApp });
