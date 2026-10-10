/**
 * `shell-overlay-route` component for the demo fixture app
 * (`/folder/:encodedCwd/demo-app/*?`, `presentation: "content"`). Loaded via
 * `React.lazy` from the client entry, so this module — and the app it imports —
 * land in their own chunk. See change: add-plugin-app-host (task 2.8, D8).
 */
import { EmbeddedApp } from "@blackbelt-technology/dashboard-plugin-runtime/embedded-app";
import { demoApp } from "./fixture-app.js";

export default function DemoAppRoute({ params, onBack }: { params: Record<string, string>; onBack: () => void }) {
  const encodedCwd = params.encodedCwd ?? "";
  return (
    <EmbeddedApp
      app={demoApp}
      basePath={`/folder/${encodedCwd}/demo-app`}
      folderParam={encodedCwd}
      onBack={onBack}
    />
  );
}
