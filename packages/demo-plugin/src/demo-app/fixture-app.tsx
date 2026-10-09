/**
 * Demo fixture app for `<EmbeddedApp>` (dev/test only). Two views (`/`,
 * `/sub`) routed relative to the host's `basePath`, an "open session" button
 * exercising `host.openSession` + the return pill, and `setTitle("Demo ctx")`.
 * Reached ONLY through `DemoAppRoute`'s dynamic import, so its code stays out
 * of the dashboard's initial bundle. See change: add-plugin-app-host (task 2.8).
 */
import { defineDashboardApp, useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useEffect, useState } from "react";
import { Link, Route, Switch } from "wouter";

function DemoApp() {
  const host = useAppHost();
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    host.setTitle("Demo ctx");
  }, [host]);
  return (
    <div data-testid="demo-app" style={{ padding: "12px" }}>
      <Switch>
        <Route path="/sub">
          <div data-testid="demo-app-view-sub">Demo sub view</div>
        </Route>
        <Route>
          <div data-testid="demo-app-view-home">
            Demo home view · <Link href="/sub" data-testid="demo-app-link-sub">sub</Link>
          </div>
        </Route>
      </Switch>
      <div style={{ marginTop: "8px" }}>
        <input
          data-testid="demo-app-session-id"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          aria-label="session id"
        />
        <button type="button" data-testid="demo-app-open-session" onClick={() => host.openSession(sessionId)}>
          open session
        </button>
      </div>
    </div>
  );
}

export const demoApp = defineDashboardApp({ id: "demo", title: "Demo", App: DemoApp });
