# Apple HIG rule pack

Apple publishes no machine-readable token JSON — semantic colors and Dynamic
Type styles resolve at OS runtime. This rule pack encodes the checkable subset
for an HTML approximation of an iOS screen (servable by `serve_mockup`,
auditable by `hig-doctor` if installed). SwiftUI is emitted only on PROMOTE.

## Semantic colors

Use iOS semantic system colors, never hardcoded brand hex for system chrome:

- `label` / `secondaryLabel` / `tertiaryLabel` for text.
- `systemBackground` / `secondarySystemBackground` for surfaces.
- `separator` for hairlines.
- `systemBlue` (tint), `systemGreen`, `systemRed` for actions/status.

In HTML, map these to CSS variables and reference them — no raw hex on chrome.

## Typography — Dynamic Type

- Font stack: `-apple-system, "SF Pro Text", "SF Pro Display", system-ui`.
- Body text 17px baseline; honor Dynamic Type with relative sizing (rem/em or
  `font: -apple-system-body`), not fixed unscalable px.
- Text styles: largeTitle, title1–3, headline, body, callout, subhead,
  footnote, caption1–2.

## Layout

- **Touch targets**: minimum 44×44pt for every interactive element.
- **8pt grid**: spacing aligns to multiples of 8 (4 allowed for fine tuning).
- **Safe areas**: respect `env(safe-area-inset-top/bottom/left/right)`; content
  never sits under the status bar, home indicator, or notch.

## Navigation

- **Tab bar**: bottom, 5 items maximum. More → use a "More" tab.
- Standard bars: navigation bar (top), tab bar (bottom), toolbar.

## Validation

- `hig-doctor` (if installed) audits the HTML/CSS against these rules — L3
  advisory layer.
- The L4 boolean rubric (`rubric.json`) covers the same checks for the vision
  judge; `score = passCount / N`.
