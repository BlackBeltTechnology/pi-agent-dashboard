/**
 * Fixed 1em icon slot shared by transcript links (file links, web links). `aria-hidden` + `user-select:none` + no
 * text node, so it never reaches assistive tech or a copied selection (rich-chat-links D1/D9). Only the glyph
 * inside changes with the link, never the box. `tone` is a theme-token colour class.
 *
 * See change: rich-chat-links.
 */
export function LinkIconSlot({ glyph, tone = "" }: { glyph: string; tone?: string }) {
  return (
    <svg
      data-link-icon=""
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={`fill-current shrink-0 mr-[0.25em] align-[-0.125em] select-none ${tone}`}
    >
      <path d={glyph} />
    </svg>
  );
}
