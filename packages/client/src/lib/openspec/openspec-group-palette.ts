/**
 * Curated color palette for OpenSpec groups.
 * Maps to existing --accent-* CSS vars.
 *
 * See change: add-openspec-change-grouping (task 6.4a).
 */

export interface PaletteEntry {
  id: string;
  label: string;
  /** CSS var reference, e.g. "var(--accent-blue)" */
  cssVar: string;
  /** Hex fallback for non-CSS contexts (e.g. stored in groups.json) */
  hex: string;
}

export const GROUP_PALETTE: readonly PaletteEntry[] = [
  { id: "blue",   label: "Blue",   cssVar: "var(--accent-blue)",   hex: "#3b82f6" },
  { id: "green",  label: "Green",  cssVar: "var(--accent-green)",  hex: "#22c55e" },
  { id: "yellow", label: "Yellow", cssVar: "var(--accent-yellow)", hex: "#eab308" },
  { id: "red",    label: "Red",    cssVar: "var(--accent-red)",    hex: "#ef4444" },
  { id: "purple", label: "Purple", cssVar: "var(--accent-purple)", hex: "#a855f7" },
  { id: "orange", label: "Orange", cssVar: "var(--accent-orange)", hex: "#f97316" },
] as const;

export type GroupColor = (typeof GROUP_PALETTE)[number]["id"];

/** Resolve a stored color string to a palette entry. Falls back to blue. */
export function resolvePaletteEntry(color?: string | null): PaletteEntry {
  if (!color) return GROUP_PALETTE[0];
  const entry = GROUP_PALETTE.find((p) => p.hex === color || p.id === color);
  return entry ?? GROUP_PALETTE[0];
}

/** Get the display color (hex) for a stored color value. */
export function resolveGroupColor(color?: string | null): string {
  return resolvePaletteEntry(color).hex;
}
