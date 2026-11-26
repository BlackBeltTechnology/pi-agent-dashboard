## Why

File links in the chat transcript can wrap in the wrong places. `FileLink.tsx` renders a link as up to three separate inline boxes: the file-type icon (`LinkIconSlot`), the clickable name, and, for `.html` links, a separate `HtmlModeMenu` chevron button. Because each box wraps on its own, a line can end with only the icon while the name starts the next line. Long paths can also break mid-path, and the chevron can end up alone on a line. The result is hard to read and the link is hard to spot as one target.

## What Changes

- In the chat transcript, a file link (one rendered inside a `LinkResolutionProvider`, i.e. `active`) renders as **one no-wrap pill**: icon, name and the optional `.html` chevron sit in a single rounded inline box that never breaks inside. When the pill does not fit on the current line, the whole pill moves to the next line.
- **Long paths shorten from the start.** When the pill is wider than the line, the name is cut at the start with an ellipsis, so the file name stays visible (`…/tool-renderers/FileLink.tsx`). The DOM text, tooltip, selection and copied text keep the full path.
- **`.html` links:** the open-mode chevron sits at the right end of the pill, after a thin divider. It keeps its own button, label and `data-testid="link-html-menu-trigger"`.
- **Link states keep their current signals inside the pill:**
  - recovered: dotted underline
  - missing: struck through, with a dashed border and muted colour
  - outside the session folders: lock glyph
  - several matching files: `?` glyph
- **Inside inline code** (`` `vite.config.ts` ``), the pill drops its border, background and padding so you don't get a chip inside a chip. It still doesn't wrap.
- **Colours** use existing theme tokens only: `--bg-secondary`, `--border-secondary`, `--link`, `--text-muted`, `--text-secondary`.
- **Not affected:** tool-output file links (not `active`, so no icon today) keep their current plain link look.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-output-linkification`: ADDED requirements "Transcript file links render as a single no-wrap pill" and "File-link pill keeps link-state signals and context styling".

## Non-goals

- Web links (provider icon + label) — same wrap risk, separate follow-up if wanted.
- Tool-output (bash / generic renderer) file links.
- Any change to link resolution, routing, open modes, the mention picker or the preview overlay.

## Relationship

- Mockup: `mockups/2026-11-23-file-link-pill/` (in this change). It renders the real `MarkdownContent` + `FileLink` as Current and a mock-local pill `fileLink` as Proposed. `static.html` beside it is a script-free snapshot (all 3 frames, dark + light) for viewing without the mock site, e.g. in the editor pane; it is derived, so the live mock stays the source.
  - The mock was first created under `mockups/`, then moved into `serve-live-previews-on-capability-origin`. That change has nothing to do with links, so the mock now lives here.
- Builds on `unify-file-link-openability` (file-type icon slot) and `fix-file-link-editor-routing` (link states).

## Discipline Skills

- `review-code` — non-trivial client change; run inline review once tests pass, before commit.
- No security, performance, observability or irreversible-step trigger: the change is presentational only, with no new input, endpoint or data path.

## Impact

- `packages/client/src/components/tool-renderers/FileLink.tsx` — pill wrapper + class helpers.
- `packages/client/src/components/tool-renderers/HtmlModeMenu.tsx` — trigger styling inside the pill (divider), no behaviour change.
- `packages/client/src/components/tool-renderers/__tests__/FileLink*.test.tsx` — new structure/class assertions.
- No server, shared-protocol or persistence change; no migration. Rollback = revert the client commit.
