import { EmbeddedApp } from "@blackbelt-technology/dashboard-plugin-runtime/embedded-app";
import { canaryApp } from "./canary-app.js";

export function S6Route({ onBack }: { onBack: () => void }) {
  return <EmbeddedApp app={canaryApp} basePath="/s6" onBack={onBack} />;
}
