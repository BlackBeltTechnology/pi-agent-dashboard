/**
 * Tab context menu (`tab-context-menu`): Close, Close other tabs, Close tabs
 * to the right, Close all tabs, and for file tabs inside the pane cwd Show in file tree /
 * Copy relative path.
 * Opened by secondary click, the ContextMenu key or Shift+F10 on a tab.
 *
 * See change: scope-anchor-editor-pane-controls (D9, D12).
 */
import { useI18n } from "../../lib/i18n/i18n.js";
import { MenuItem, MenuPopover } from "./MenuPopover.js";

export interface TabContextMenuProps {
  anchorEl: HTMLElement;
  isLast: boolean;
  /** A file tab under the session folder: tree reveal + path copy apply. */
  fileTab: boolean;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onCloseAll: () => void;
  onShowInTree: () => void;
  onCopyPath: () => void;
}

export function TabContextMenu(p: TabContextMenuProps) {
  const { t } = useI18n();
  // Every action closes the menu first (popovers close before any dialog opens).
  const run = (fn: () => void) => () => {
    p.onClose();
    fn();
  };
  return (
    <MenuPopover anchorEl={p.anchorEl} label={t("editor.tabMenu", undefined, "Tab actions")} testId="tab-context-menu" onClose={p.onClose}>
      <MenuItem testId="tab-menu-close" label={t("editor.closeTab", undefined, "Close")} onSelect={run(p.onCloseTab)} />
      <MenuItem testId="tab-menu-close-others" label={t("editor.closeOtherTabs", undefined, "Close other tabs")} onSelect={run(p.onCloseOthers)} />
      <MenuItem
        testId="tab-menu-close-right"
        label={t("editor.closeTabsToRight", undefined, "Close tabs to the right")}
        disabled={p.isLast}
        onSelect={run(p.onCloseRight)}
      />
      <MenuItem testId="tab-menu-close-all" label={t("editor.closeAllTabs", undefined, "Close all tabs")} onSelect={run(p.onCloseAll)} />
      {p.fileTab && (
        <>
          <MenuItem testId="tab-menu-show-in-tree" label={t("editor.showInFileTree", undefined, "Show in file tree")} onSelect={run(p.onShowInTree)} />
          <MenuItem testId="tab-menu-copy-path" label={t("editor.copyRelativePath", undefined, "Copy relative path")} onSelect={run(p.onCopyPath)} />
        </>
      )}
    </MenuPopover>
  );
}
