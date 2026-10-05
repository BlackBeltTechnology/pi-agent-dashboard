/**
 * Where "open the team" goes. With the dashboard's app host
 * (`add-plugin-app-host`: `EmbeddedApp`) the team opens in the content area;
 * without it the standalone app opens in a new tab (D17 fallback).
 * See change: add-team-plugin.
 */
import * as runtime from "@blackbelt-technology/dashboard-plugin-runtime";

export function hasEmbeddedHost(mod: object = runtime): boolean {
  return "EmbeddedApp" in mod;
}

export function standaloneUrl(projectId: string): string {
  return `/apps/team/?project=${encodeURIComponent(projectId)}`;
}

export function openTeam(projectId: string, navigate: (path: string) => void, cwd: string, embedded = hasEmbeddedHost()): void {
  if (embedded) {
    const bytes = new TextEncoder().encode(cwd);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const enc = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    navigate(`/folder/${enc}/team`);
    return;
  }
  window.open(standaloneUrl(projectId), "_blank", "noopener");
}
