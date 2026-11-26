## ADDED Requirements

### Requirement: Transcript file links render as a single no-wrap pill

A file link rendered in the chat transcript (inside a `LinkResolutionProvider`) SHALL render its glyph, its name and, when shown, its HTML open-mode trigger inside one inline pill element that does not wrap internally. When the pill is wider than the line, the name SHALL be truncated visually from the start; the DOM text, tooltip and copied text SHALL keep the full path.

#### Scenario: icon, name and menu form one unbreakable unit

- **GIVEN** an assistant message containing the transcript link `mockups/link-report.html`
- **WHEN** the link renders
- **THEN** the glyph, the name and the `link-html-menu-trigger` button are descendants of one pill element
- **AND** that pill element has no-wrap styling, so no line break can occur between them

#### Scenario: long path keeps the file name visible

- **GIVEN** a transcript link `packages/client/src/components/tool-renderers/tests/FileLink.rich-chat-links.test.tsx` in a bubble narrower than the path
- **WHEN** the link renders
- **THEN** the visible text ends with `FileLink.rich-chat-links.test.tsx` and the ellipsis is at the start
- **AND** selecting and copying the link yields the full path

### Requirement: File-link pill keeps link-state signals and context styling

A transcript file-link pill SHALL keep the existing link-state signals (recovered, missing, gated, ambiguous). A pill nested inside inline code SHALL render without its own border, background and padding. File links rendered outside a `LinkResolutionProvider` SHALL keep their existing plain rendering.

#### Scenario: link states remain distinguishable

- **WHEN** transcript links render in the `recovered`, `missing`, `gated` and `ambiguous` states
- **THEN** the inner link button carries the `data-link-state` value
- **AND** the pill shows the state's visible signal (dotted underline, strike-through with dashed border, lock glyph, help glyph respectively)

#### Scenario: no chip inside an inline-code chip

- **GIVEN** a transcript link written as inline code `` `packages/client/vite.config.ts` ``
- **WHEN** the link renders
- **THEN** the pill has no own border, background or horizontal padding and still does not wrap internally

#### Scenario: tool-output links are unchanged

- **GIVEN** a file reference linkified in bash tool output (no `LinkResolutionProvider`)
- **WHEN** it renders
- **THEN** it renders as today, with no pill wrapper and no glyph
