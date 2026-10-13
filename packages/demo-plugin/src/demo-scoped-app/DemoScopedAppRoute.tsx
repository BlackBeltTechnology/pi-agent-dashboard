/**
 * `shell-overlay-route` component for the project-scoped demo app
 * (`/folder/:encodedCwd/demo-scoped/*?`, `presentation: "content"`). Passes
 * `projectScope={{ type: "demo-scoped" }}` so a deep link to a folder without
 * the marker renders *Not available for this folder* instead of the app. No
 * `standaloneUrl` (scoped apps have no standalone host).
 * See change: add-project-scoped-apps (D8).
 */
import { EmbeddedApp } from "@blackbelt-technology/dashboard-plugin-runtime/embedded-app";
import { demoScopedApp } from "./scoped-app.js";

export default function DemoScopedAppRoute({ params, onBack }: { params: Record<string, string>; onBack: () => void }) {
  const encodedCwd = params.encodedCwd ?? "";
  return (
    <EmbeddedApp
      app={demoScopedApp}
      basePath={`/folder/${encodedCwd}/demo-scoped`}
      folderParam={encodedCwd}
      projectScope={{ type: "demo-scoped" }}
      onBack={onBack}
    />
  );
}
