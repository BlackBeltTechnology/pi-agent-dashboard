import { defineDashboardApp, useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { Route, Switch } from "wouter";

function CanaryApp() {
  const host = useAppHost();
  return (
    <div data-testid="canary-app" className="p-3 text-[var(--text-primary)]">
      <span data-testid="canary-app-mode">{host.mode}</span>
      <Switch>
        <Route path="/sub"><div data-testid="canary-view-sub">sub</div></Route>
        <Route><div data-testid="canary-view-home">home</div></Route>
      </Switch>
    </div>
  );
}

export const canaryApp = defineDashboardApp({ id: "runtime-canary", title: "Runtime canary", App: CanaryApp });
