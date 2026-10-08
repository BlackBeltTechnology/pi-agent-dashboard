/**
 * Host for a plugin-owned editor-pane tab (`viewer: "plugin"`, path
 * `<pathPrefix>:<rest>`). Resolves the enabled `editor-pane-tab` claim by
 * prefix and renders its body; with no enabled claim (plugin disabled,
 * uninstalled, failed to load) it renders the "Tab unavailable" placeholder
 * with Close. Never falls through to `CappedViewer`, so no `/api/file` request
 * is ever made for a virtual path. See change: add-browser-editor-pane-tab (D1/D2).
 */
import { EditorPaneTabSlot, useShellSessionOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useI18n } from "../../lib/i18n/i18n.js";

export interface PluginTabHostProps {
  path: string;
  sessionId: string;
  isActive: boolean;
  onClose: () => void;
}

/** The prefix shown in the placeholder — everything before the first `:`. */
export const pluginTabPrefix = (path: string): string => {
  const i = path.indexOf(":");
  return i > 0 ? path.slice(0, i) : path;
};

export function PluginTabUnavailable({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useI18n();
  const prefix = pluginTabPrefix(path);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-tertiary)]" data-testid="plugin-tab-unavailable">
      <span>{t("editor.pluginTabUnavailable", { prefix }, "Tab unavailable ({prefix})")}</span>
      <button
        type="button"
        onClick={onClose}
        className="rounded border border-[var(--border-primary)] px-3 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        {t("common.close", undefined, "Close")}
      </button>
    </div>
  );
}

export function PluginTabHost({ path, sessionId, isActive, onClose }: PluginTabHostProps) {
  const session = useShellSessionOrNull(sessionId);
  const fallback = <PluginTabUnavailable path={path} onClose={onClose} />;
  if (!session) return null;
  return <EditorPaneTabSlot path={path} session={session} isActive={isActive} onClose={onClose} fallback={fallback} />;
}
