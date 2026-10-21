/**
 * Runtime canary — client ENTRY module (small, eagerly imported): static claim functions, eager components,
 * the i18n catalog. Heavy claims live in lazy chunks (`s6-route`, `lazy-panel`), named by manifest `module`.
 * Built by the SDK preset; every import below is an import-map specifier (external).
 */
import { useFolderMenuItem, usePluginConfig, useShellConnectionStatus, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useState } from "react";
import { useLocation } from "wouter";

export { catalog } from "./i18n.js";

/** `shouldRender` predicate of the settings claim (static function export). */
export const canaryShouldRender = () => true;

export function CanarySettings() {
  const t = useT();
  const config = usePluginConfig<{ greeting?: string }>();
  // One React instance: a hook (`useState`) AND a host-context hook (`useShellConnectionStatus`) both work.
  const [clicks, setClicks] = useState(0);
  const status = useShellConnectionStatus();
  return (
    <div data-testid="canary-settings" className="rounded border border-dashed p-2 bg-[var(--bg-surface)] text-[var(--text-primary)]">
      {t("canaryTitle", undefined, "Runtime canary")} · {config.greeting ?? "hello"}
      <span data-testid="canary-conn-status"> · {status}</span>
      <button type="button" data-testid="canary-clicks" onClick={() => setClicks((n) => n + 1)}>
        {clicks}
      </button>
    </div>
  );
}

/** Folder-scoped entry (`sidebar-folder-section`): state-only, contributes a folder-menu item that opens the S6 app. */
export function CanaryFolderEntry({ folder }: { folder: { cwd: string } }) {
  const [, navigate] = useLocation();
  useFolderMenuItem(folder.cwd, {
    id: "runtime-canary-open",
    group: "open",
    label: "Open runtime canary app",
    icon: "M12 2 2 7l10 5 10-5-10-5Z",
    onSelect: () => navigate("/s6"),
  });
  return null;
}
