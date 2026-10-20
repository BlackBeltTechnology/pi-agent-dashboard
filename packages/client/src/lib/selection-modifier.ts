/**
 * Pure file-manager selection rules for the Add Folders picker.
 *
 * - `isAddToSelectionModifier`: Command on macOS/iPadOS, Control elsewhere.
 *   macOS Control-click is the secondary click and never toggles.
 * - `applyRowClick`: plain click replaces, modifier toggles, Shift ranges from
 *   the anchor (plain click when no anchor is in the listing).
 *
 * No DOM, no React. See change: simplify-add-folder-picker (design D1a, D4).
 */

/** Browser keyboard family. `mac` = macOS + iPadOS + iOS. */
export type SelectionPlatform = "mac" | "other";

export function isAddToSelectionModifier(
  e: { metaKey: boolean; ctrlKey: boolean },
  platform: SelectionPlatform,
): boolean {
  return platform === "mac" ? e.metaKey : e.ctrlKey;
}

export interface RowSelection {
  selected: string[];
  anchor: string | null;
}

export function applyRowClick(
  prev: RowSelection,
  click: { path: string; ordered: string[]; mod: boolean; shift: boolean },
): RowSelection {
  const { path, ordered, mod, shift } = click;
  const anchorIdx = prev.anchor === null ? -1 : ordered.indexOf(prev.anchor);
  if (shift && anchorIdx >= 0) {
    const idx = ordered.indexOf(path);
    const [lo, hi] = idx < anchorIdx ? [idx, anchorIdx] : [anchorIdx, idx];
    return { selected: ordered.slice(lo, hi + 1), anchor: prev.anchor };
  }
  if (mod) {
    const selected = prev.selected.includes(path)
      ? prev.selected.filter((p) => p !== path)
      : [...prev.selected, path];
    return { selected, anchor: path };
  }
  return { selected: [path], anchor: path };
}
