## Context

`FileLink` currently returns a fragment of sibling inline elements: a `<button>` (icon + children), an optional `<HtmlModeMenu>` trigger, plus portal-style `MentionPicker` / `FilePreviewOverlay`. Each sibling is a separate wrap opportunity. The mockup `mockups/2026-11-23-file-link-pill/mock.tsx` shows the target styling, built with a mock-local `fileLink` renderer.

## D1 — Pill wrapper only when `active`

Wrap the link button and the `HtmlModeMenu` in one `<span>` pill only when `active` is true, i.e. when the link is in the transcript inside a `LinkResolutionProvider`. Tool-output links render unchanged, without the icon, so a tool's output keeps its terminal look. `MentionPicker` and `FilePreviewOverlay` stay outside the pill (siblings), so the pill never clips them.

## D2 — No-wrap + start-truncation technique

- Pill: `inline-flex items-center max-w-full min-w-0 whitespace-nowrap rounded-full border …`. `inline-flex` makes the pill one atomic inline box, so it can move to the next line but not break inside.
- Name: `<span class="truncate min-w-0" style="direction:rtl;text-align:left"><bdi dir="ltr">{children}</bdi></span>`. The `rtl` direction moves the ellipsis to the start, and `<bdi>` keeps the path's own LTR order and punctuation. Only the name span gets `overflow:hidden`; the pill itself does not, so the `HtmlModeMenu` popover is not clipped.
- Copy/selection: the DOM text is unchanged, so the existing "Selection and copy preservation" requirement still holds (verify by test).
- Checked against the alternative of middle-truncation in JS: it needs measurement and a resize observer per link, which is over budget for a transcript with hundreds of links. CSS-only truncation was chosen instead.

## D3 — State styling moves to the pill

Inactive links keep `linkClass` unchanged. Active links use `pillClass(state, dead)` on the pill for border, background and colour, and `pillButtonClass` on the inner button, which keeps the underline and strike-through. Mapping, taken from the mock's `toneFor`:
- found/recovered: `--bg-secondary` bg, `--border-secondary` border, `--link` text, hover border `--link`
- gated/ambiguous: same bg/border, `--text-secondary` text
- missing: dashed border, transparent bg, `--text-secondary`, `line-through`, `cursor-not-allowed`. Not `--text-muted`: in the light theme it is `#aaaaaa`, about 2.3:1 on white, and a missing link is still an active control, so WCAG 1.4.3 (4.5:1) applies. The strike-through and the dashed border carry the state.

The `data-link-state`, `data-not-found`, `aria-disabled`, `title` and click handler stay on the inner `<button>`, so existing tests and behaviour are unchanged.

## D4 — Inline-code variant via descendant variant

The pill applies `[code_&]:border-0 [code_&]:bg-transparent [code_&]:px-0 [code_&]:mx-0`, so it drops its chrome when it is a descendant of `<code>`. There is no new prop and no context. Requires the Tailwind arbitrary-variant support already used in the client. Verify it compiles during the build.

## D5 — HtmlModeMenu inside the pill

The trigger gains a left divider (`border-l border-[var(--border-secondary)] ml-[0.35em] pl-[0.2em]`) and `shrink-0`. Its label, testid, keyboard behaviour and menu are unchanged. Only the className changes. No prop is needed: `showsHtmlMenu` requires `active`, so the trigger only ever renders inside the pill.

## Accessibility

- Focus ring stays on each inner button; the pill itself is not focusable.
- Colours use theme tokens only. Contrast of `--link` on `--bg-secondary` is checked in dark and light themes during verification, as is the missing state's `--text-secondary` on the bubble surface.
- The truncated name keeps its full path in `title`; the accessible name is the full DOM text, not truncated.

## Risks

- `direction: rtl` with leading punctuation (`~/`, `./`) — mitigated by `<bdi dir="ltr">`; covered by a test with `~/other-repo/secrets.ts`.
- `align-[-0.2em]` baseline nudge may shift line height in dense lists; check visually in the mock and the real transcript.
