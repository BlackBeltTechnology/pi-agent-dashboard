/**
 * Library entry: the app as a `DashboardAppDefinition` an embedded host mounts
 * (`<EmbeddedApp app={teamApp}>`). No React root, no global CSS — the host
 * owns the document. See change: add-team-plugin (D16).
 */
import { defineDashboardApp } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { TargetSelector } from "./shell/TargetSelector.js";
import { TeamApp } from "./TeamApp.js";

const teamApp = defineDashboardApp({
  id: "team",
  title: "AI Team",
  App: TeamApp,
  HeaderContext: TargetSelector,
});

export default teamApp;
