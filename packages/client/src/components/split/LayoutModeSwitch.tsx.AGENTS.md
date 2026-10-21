# LayoutModeSwitch.tsx — index

Header `Chat│Split│Editor` segmented switch. WAI-ARIA radiogroup (3 `role=radio`, roving tabindex, Arrow/Home/End + Enter/Space), `aria-checked`=`split.mode`; sets `setMode`. Renders null without provider. testid `layout-mode-switch`. See change: editor-layout-modes.

`variant="menu"` = mobile 44 px trigger (current-mode icon + caret, keeps testid `layout-mode-switch`) opening an APG menu of 3 `menuitemradio` (`layout-mode-{closed,split,full}`; Split = `mdiViewSplitHorizontal` + "Chat above, editor below"). Segmented variant: 32 px segments, 12 px labels, icon-only below a 760 px header container (`@max-[760px]:sr-only`). See change: reorganize-session-header.
