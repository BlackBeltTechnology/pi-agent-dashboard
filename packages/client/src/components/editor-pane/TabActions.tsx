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
 * `variant="menu"` renders the file actions as `role="menuitem"` rows (the
 * document bar folds them into `⋯` below 640 px); test ids are unchanged, and
 * the Reveal label follows the server platform (design D10).
 *
 * See change: open-view-command-in-editor-pane (D9/D10).
 * See change: scope-anchor-editor-pane-controls (D3, D10).
 */
import { mdiFolderOpenOutline, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@mdi/react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { openExternalUrl } from "../../lib/nav/safe-navigation.js";
import { MenuItem } from "./MenuPopover.js";

export type TabActionTarget =
  | { kind: "file"; cwd: string; path: string }
  | { kind: "url"; url: string };

interface Props {
  target: TabActionTarget;
  systemOpen: boolean;
  /** Server `process.platform`; labels the Reveal action. */
  platform?: string;
  /** `bar` (default): 24 px icon buttons. `menu`: menu rows for the `⋯` menu. */
  variant?: "bar" | "menu";
  /** Menu variant: called after an item ran, so the host menu can close. */
  onActivate?: () => void;
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

const ICON_BTN =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";

export function TabActions({ target, systemOpen, platform, variant = "bar", onActivate }: Props) {
  const { t } = useI18n();

  if (target.kind === "url") {
    const label = t("editor.openInSystemBrowser", undefined, "Open in system browser");
    return (
      <button
        type="button"
        data-testid="tab-open-in-browser"
        onClick={() => openExternalUrl(target.url)}
        className={ICON_BTN}
        aria-label={label}
        title={label}
      >
        <Icon path={mdiOpenInNew} size={0.7} />
      </button>
    );
  }

  // file tab — actions gated on the server capability.
  if (!systemOpen) return null;
  const openLabel = t("editor.openInDefaultApp", undefined, "Open in default app");
  const revealLabel =
    platform === "darwin"
      ? t("editor.revealInFinder", undefined, "Reveal in Finder")
      : platform === "win32"
        ? t("editor.showInExplorer", undefined, "Show in Explorer")
        : t("editor.revealInFileManager", undefined, "Reveal in file manager");
  const openApp = () => postSystemOpen("/api/open-in-system", target.cwd, target.path);
  const reveal = () => postSystemOpen("/api/reveal-in-file-manager", target.cwd, target.path);
  if (variant === "menu") {
    const run = (fn: () => void) => () => {
      fn();
      onActivate?.();
    };
    return (
      <>
        <MenuItem testId="tab-open-in-app" label={openLabel} onSelect={run(openApp)} />
        <MenuItem testId="tab-reveal-in-file-manager" label={revealLabel} onSelect={run(reveal)} />
      </>
    );
  }
  return (
    <>
      <button type="button" data-testid="tab-open-in-app" onClick={openApp} className={ICON_BTN} aria-label={openLabel} title={openLabel}>
        <Icon path={mdiOpenInNew} size={0.7} />
      </button>
      <button type="button" data-testid="tab-reveal-in-file-manager" onClick={reveal} className={ICON_BTN} aria-label={revealLabel} title={revealLabel}>
        <Icon path={mdiFolderOpenOutline} size={0.7} />
      </button>
    </>
  );
}
