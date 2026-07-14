/**
 * Session tag primitives shared across server, client, and tests.
 *
 * User-owned, free-form tags live on `SessionMeta.tags` / `DashboardSession.tags`.
 * This module owns the two pure functions that keep tags canonical + colored
 * identically on every surface:
 *   - `normalizeTags` — the server-side write normalizer (trim/lowercase/dedupe/cap).
 *   - `tagColor` — the deterministic name → palette-color hash (zero storage).
 * See change: add-session-tags.
 */

/** Max number of tags persisted per session (normalizer caps the list). */
export const MAX_TAGS = 12;
/** Max characters per tag (normalizer truncates longer entries). */
export const MAX_TAG_LEN = 32;

/**
 * A single dark-tuned palette entry. Values mirror `mockups/_tokens.css`
 * (`.chip.user.c-*`): `text` foreground, `border` outline, `bg` fill.
 */
export interface TagPaletteColor {
  name: string;
  text: string;
  border: string;
  bg: string;
}

/**
 * 9-entry dark-tuned palette, index-stable. Order is the hash oracle — do NOT
 * reorder without breaking existing tag→color assignments (colors are not
 * persisted, but a reorder re-hues every tag). From `mockups/_tokens.css`.
 */
export const TAG_PALETTE: readonly TagPaletteColor[] = [
  { name: "indigo", text: "#a5b4fc", border: "rgba(99,102,241,.45)", bg: "rgba(99,102,241,.12)" },
  { name: "blue", text: "#7dd3fc", border: "rgba(56,189,248,.45)", bg: "rgba(56,189,248,.12)" },
  { name: "green", text: "#86efac", border: "rgba(34,197,94,.45)", bg: "rgba(34,197,94,.12)" },
  { name: "amber", text: "#fcd34d", border: "rgba(245,158,11,.45)", bg: "rgba(245,158,11,.12)" },
  { name: "rose", text: "#fda4af", border: "rgba(244,63,94,.45)", bg: "rgba(244,63,94,.12)" },
  { name: "violet", text: "#d8b4fe", border: "rgba(168,85,247,.45)", bg: "rgba(168,85,247,.12)" },
  { name: "teal", text: "#5eead4", border: "rgba(20,184,166,.45)", bg: "rgba(20,184,166,.12)" },
  { name: "orange", text: "#fdba74", border: "rgba(249,115,22,.45)", bg: "rgba(249,115,22,.12)" },
  { name: "slate", text: "#cbd5e1", border: "rgba(148,163,184,.40)", bg: "rgba(148,163,184,.10)" },
] as const;

/**
 * FNV-1a 32-bit hash over the UTF-8 bytes of `input`.
 *
 * Uses `TextEncoder` (UTF-8 bytes), NOT `charCodeAt` (UTF-16 code units) — the
 * two differ for non-ASCII (e.g. `café`), and the palette index must be stable
 * regardless of surface. Each step wraps at unsigned 32 bits via
 * `Math.imul(...) >>> 0` (a plain `h * prime` overflows past 2^53 and corrupts
 * the hash for longer strings).
 */
export function fnv1a32(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let h = 0x811c9dc5;
  for (const byte of bytes) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Deterministic display color for a tag name. Pure function of the name —
 * `TAG_PALETTE[fnv1a32(name) % TAG_PALETTE.length]`. No color is persisted.
 * Callers SHOULD pass a normalized (lowercase) name so the same logical tag
 * hues identically everywhere.
 */
export function tagColor(tag: string): TagPaletteColor {
  return TAG_PALETTE[fnv1a32(tag) % TAG_PALETTE.length];
}

/**
 * Canonicalize a raw tag list for persistence: trim, lowercase, drop empty,
 * dedupe (first-seen order), truncate each to `MAX_TAG_LEN`, cap to `MAX_TAGS`.
 * The returned array is the canonical stored form. Runs server-side on write
 * regardless of client input.
 */
export function normalizeTags(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
