## MODIFIED Requirements

### Requirement: Mermaid diagram rendering
The MermaidBlock component SHALL accept a `code` string prop containing Mermaid diagram syntax, lazy-load the mermaid library via dynamic import, render the diagram to SVG using `mermaid.render()`, sanitize the SVG output using DOMPurify to remove script tags, event handlers, and other XSS vectors, and display the sanitized SVG inside a zoomable viewport container that spans the full content area width. When rendering the original source fails, the component SHALL attempt rule-based repair (see `mermaid-rule-repair`) before falling back to the error display. While rendering, the loading placeholder SHALL be a `role="status"` element with a spinner and the translated text "Rendering diagram…" in `--text-secondary`. The error display SHALL be an error-severity callout (`ui-contract.md` callout recipe, `--severity-error-*` family) containing the translated headline "This diagram could not be rendered.", the original render error message in monospace, and a "Copy source" button that copies the original source, followed by the raw original source. No Tailwind palette class, hex or `rgba(` literal SHALL paint the loading or error display, and both SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}`.

#### Scenario: Valid Mermaid diagram
- **WHEN** a mermaid code block contains valid Mermaid syntax (e.g., `graph TD; A-->B`)
- **THEN** the component SHALL render a sanitized SVG diagram inside a zoomable viewport container

#### Scenario: Loading state
- **WHEN** the mermaid library is being loaded via dynamic import
- **THEN** the component SHALL display a `role="status"` placeholder with a spinner and "Rendering diagram…" in `--text-secondary`

#### Scenario: Invalid Mermaid syntax
- **WHEN** a mermaid code block contains invalid syntax
- **AND** rule-based repair applies no rule, or the repaired source also fails to render
- **THEN** the component SHALL display the error-severity callout with "This diagram could not be rendered." and the error message from the original render attempt, followed by the raw code text
- **AND** the callout's computed colours SHALL equal the active theme's `--severity-error-fg` and `--severity-error-bg`

#### Scenario: Repairable Mermaid syntax
- **WHEN** a mermaid code block contains invalid syntax that rule-based repair fixes
- **THEN** the component SHALL render the repaired diagram with an auto-fixed indication

#### Scenario: Multiple diagrams on same page
- **WHEN** multiple mermaid code blocks appear in the same markdown content
- **THEN** each diagram SHALL render independently with unique IDs, independent zoom state, and no conflicts

#### Scenario: Component unmounts during render
- **WHEN** the component unmounts while mermaid.render() is in progress
- **THEN** the stale render result SHALL be discarded without errors

#### Scenario: SVG contains malicious content
- **WHEN** mermaid.render() produces SVG containing `<script>` tags, `onload` attributes, or other XSS vectors
- **THEN** DOMPurify SHALL strip all executable content before DOM injection
- **AND** valid SVG elements (paths, text, groups) SHALL be preserved

#### Scenario: Copy source
- **WHEN** the user activates "Copy source" on an unrenderable diagram
- **THEN** the original source SHALL be placed on the clipboard

## ADDED Requirements

### Requirement: Accent fallback literals are test-only
`MermaidBlock`'s `FALLBACK_ACCENTS` hex list and its `--text-primary` hex fallback SHALL remain only as a fallback for environments where `getComputedStyle` returns empty custom properties (jsdom), documented as such in a code comment and as an exception in `ui-contract.md`. The default `:root` block of `packages/client/src/index.css` and every palette and mode in `THEMES` SHALL define `--accent-blue`, `--accent-green`, `--accent-yellow`, `--accent-red`, `--accent-purple`, `--accent-orange` and `--text-primary` as `#rgb` or `#rrggbb` values; the `[data-theme="light"]` block SHALL define `--text-primary` as hex and inherits the accents from `:root` (it deliberately does not override them, per `ui-contract.md`); any of the seven variables defined anywhere else SHALL also be hex. The browser therefore never paints a fallback, and `rgba()` always receives a parsable hex.

#### Scenario: Every palette defines hex accents
- **WHEN** the guard test iterates `:root` in `index.css` and every palette and mode in `THEMES`
- **THEN** each of the seven variables is defined and matches `#rgb` or `#rrggbb`
- **AND** the `[data-theme="light"]` block's `--text-primary`, and any accent it defines, match `#rgb` or `#rrggbb`

#### Scenario: Non-hex accent is caught
- **WHEN** a palette defines an accent as a non-hex value (for example `oklch(...)`)
- **THEN** the guard test fails naming the palette, mode and variable
