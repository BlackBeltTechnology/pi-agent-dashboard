/**
 * Project-scoped demo fixture app for `<EmbeddedApp projectScope>` (dev/test
 * only). Mirrors `demo-app/fixture-app.tsx` with distinct ids/testids; reached
 * ONLY through `DemoScopedAppRoute`'s dynamic import.
 * See change: add-project-scoped-apps (D8).
 */
import { defineDashboardApp, useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useEffect } from "react";
import { Link, Route, Switch } from "wouter";

function DemoScopedApp() {
  const host = useAppHost();
  useEffect(() => {
    host.setTitle("Demo scoped ctx");
  }, [host]);
  return (
    <div data-testid="demo-scoped-app" style={{ padding: "12px" }}>
      <Switch>
        <Route path="/sub">
          <div data-testid="demo-scoped-view-sub">Demo scoped sub view</div>
        </Route>
        <Route>
          <div data-testid="demo-scoped-view-home">
            Demo scoped home view · <Link href="/sub" data-testid="demo-scoped-link-sub">sub</Link>
          </div>
        </Route>
      </Switch>
    </div>
  );
}

export const demoScopedApp = defineDashboardApp({ id: "demo-scoped", title: "Demo scoped", App: DemoScopedApp });
