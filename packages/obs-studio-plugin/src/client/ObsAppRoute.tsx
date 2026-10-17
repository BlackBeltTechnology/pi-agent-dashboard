/**
 * `shell-overlay-route` `/obs/*?` (depth 2, parentPath settings card, `presentation: "content"`): the
 * panel inside `<EmbeddedApp>` (dashboard top bar, Back, Open standalone →
 * `/apps/obs/`). Loaded via `React.lazy`, so the panel and app-kit stay out of
 * the dashboard's cold chunk. Data goes through `host.api.fetch` (shell
 * services add the bearer when the dashboard holds one).
 * See change: add-obs-studio-plugin (design D6).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { EmbeddedApp } from "@blackbelt-technology/dashboard-plugin-runtime/embedded-app";
import { defineDashboardApp, useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { createContext, useContext } from "react";
import { en } from "../i18n.js";
import { ObsPanel, type TFn } from "./ObsPanel.js";

const TContext = createContext<TFn>((_k, _v, fallback) => fallback ?? "");

function ObsApp() {
  const host = useAppHost();
  const t = useContext(TContext);
  return <ObsPanel fetcher={(p, i) => host.api.fetch(p, i)} t={t} />;
}

const obsApp = defineDashboardApp({ id: "obs", title: en.title, App: ObsApp });

export default function ObsAppRoute({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <TContext.Provider value={t}>
      <EmbeddedApp app={obsApp} basePath="/obs" standaloneUrl="/apps/obs/" onBack={onBack} />
    </TContext.Provider>
  );
}
