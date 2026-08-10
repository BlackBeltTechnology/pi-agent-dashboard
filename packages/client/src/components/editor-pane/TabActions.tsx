/**
 * System-open actions for the active editor-pane tab (D9/D10).
 *
 * - file tab → *Open in system app* (`POST /api/open-in-system`) and *Reveal in
 *   file manager* (`POST /api/reveal-in-file-manager`), shown ONLY when the
 *   server advertises `capabilities.systemOpen` (desktop-capable host).
 * - url tab → *Open in system browser* → `window.open(url, "_blank")`
 *   (unconditional; Electron rewrites to `openExternal`, browsers honor it).
 *
 * The file endpoints spawn the opener on the server host under the shared
 * cwd-containment + loopback-origin gates; this component only POSTs.
 *
 * See change: open-view-command-in-editor-pane (D9/D10).
 */
import { mdiApplicationOutline, mdiFolderOpenOutline, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@mdi/react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";

export type TabActionTarget =
  | { kind: "file"; cwd: string; path: string }
  | { kind: "url"; url: string };

interface Props {
  target: TabActionTarget;
  systemOpen: boolean;
}

function postSystemOpen(endpoint: string, cwd: string, path: string): void {
  void fetch(`${getApiBase()}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, path }),
  }).catch(() => {
    /* best-effort; server refuses when incapable */
  });
}

export function TabActions({ target, systemOpen }: Props) {
  const { t } = useI18n();

  if (target.kind === "url") {
    return (
      <button
        type="button"
        data-testid="tab-open-in-browser"
        onClick={() => window.open(target.url, "_blank")}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        title={t("editor.openInSystemBrowser", undefined, "Open in system browser")}
      >
        <Icon path={mdiOpenInNew} size={0.7} />
      </button>
    );
  }

  // file tab — actions gated on the server capability.
  if (!systemOpen) return null;
  return (
    <>
      <button
        type="button"
        data-testid="tab-open-in-app"
        onClick={() => postSystemOpen("/api/open-in-system", target.cwd, target.path)}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        title={t("editor.openInSystemApp", undefined, "Open in system app")}
      >
        <Icon path={mdiApplicationOutline} size={0.7} />
      </button>
      <button
        type="button"
        data-testid="tab-reveal-in-file-manager"
        onClick={() => postSystemOpen("/api/reveal-in-file-manager", target.cwd, target.path)}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        title={t("editor.revealInFileManager", undefined, "Reveal in file manager")}
      >
        <Icon path={mdiFolderOpenOutline} size={0.7} />
      </button>
    </>
  );
}
