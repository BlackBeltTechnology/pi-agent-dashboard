// Clean preset fixture: imports EVERY import-map specifier (so the externals can be asserted) + one lazy chunk.
import { EmbeddedApp } from "@blackbelt-technology/dashboard-plugin-runtime/embedded-app";
import { PLUGIN_HOST_API_VERSION } from "@blackbelt-technology/dashboard-plugin-runtime";
import { defineDashboardApp } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Route } from "wouter";

export const shouldRender = () => PLUGIN_HOST_API_VERSION.length > 0;
export const mount = createRoot;
export const portal = createPortal;
export const app = defineDashboardApp({ id: "clean", title: "Clean", App: () => <Route path="/">{"ok"}</Route> });

export function Panel() {
  const [n] = useState(1);
  return <div className="flex p-4 bg-[var(--bg-surface)]"><EmbeddedApp app={app} basePath="/x" onBack={() => {}} />{n}</div>;
}
