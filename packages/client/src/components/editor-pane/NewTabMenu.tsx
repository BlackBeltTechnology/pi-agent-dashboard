/**
 * Pane-bar `+` menu: Terminal, Live preview and (session panes with file
 * search) Open file…. Each item calls the handler the old header icon used.
 *
 * See change: scope-anchor-editor-pane-controls (D9, D12).
 */
import { mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { MenuItem, MenuPopover } from "./MenuPopover.js";

export interface NewTabMenuProps {
  onNewTerminal: () => void;
  onLivePreview: () => void;
  /** Present only when file search is available (session panes). */
  onOpenFile?: () => void;
  onOpenChange?: (open: boolean) => void;
}

export function NewTabMenu({ onNewTerminal, onLivePreview, onOpenFile, onOpenChange }: NewTabMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);
  const choose = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const label = t("editor.newTab", undefined, "New tab");
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid="new-tab-menu-toggle"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <Icon path={mdiPlus} size={0.7} />
      </button>
      {open && btnRef.current && (
        <MenuPopover anchorEl={btnRef.current} label={label} testId="new-tab-menu" onClose={() => setOpen(false)}>
          <MenuItem testId="new-terminal-launch" label={t("terminal.newTerminal", undefined, "New Terminal")} onSelect={choose(onNewTerminal)} />
          <MenuItem testId="live-preview-launch" label={t("editor.livePreview", undefined, "Live preview")} onSelect={choose(onLivePreview)} />
          {onOpenFile && (
            <MenuItem testId="open-file-launch" label={t("editor.openFileEllipsis", undefined, "Open file…")} onSelect={choose(onOpenFile)} />
          )}
        </MenuPopover>
      )}
    </>
  );
}
