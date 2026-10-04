## ADDED Requirements

### Requirement: Fill accents SHALL NOT be added as text paint
A component SHALL NOT add a text paint that uses a fill / decoration accent `--accent-<hue>` (`<hue>` ∈ purple, blue, green, orange, red, yellow). Coloured text SHALL use the matching `--accent-<hue>-text` token defined per palette by `theme-gallery` "On-surface accent text ramp", which is the only accent family with a text-contrast guarantee on every palette.

A text paint is:
- a Tailwind arbitrary text-colour class `text-[var(--accent-<hue>)]`, including opacity-modified forms such as `text-[var(--accent-<hue>)]/80`;
- an inline style or CSS declaration of `color` whose value is `var(--accent-<hue>)`, in a component source file or a stylesheet under the guard's scanned roots.

Fills, borders, rings, dots, strokes and `background` / `border-color` / `fill` / `stroke` paints are NOT text paints and SHALL NOT be flagged.

A text-colour class can also colour a non-text graphic through `currentColor` (an icon glyph), where a fill accent is correct (WCAG 1.4.11, 3:1). Syntax cannot tell the two apart. So the guard SHALL carry an enumerated **non-text-paint file allowlist**, whose files are skipped by this arm only. Each entry SHALL carry a written justification. The allowlist SHALL initially contain exactly `packages/client/src/lib/preview/file-icon.ts`, whose icon-colour classes are mandated by `file-extension-icon-lookup`. Icon uses elsewhere SHALL stay in the baseline rather than be allowlisted.

Text paints that exist when this rule lands are grandfathered as baselined debt. That includes paints an existing requirement mandates: `tool-renderers` "DiffView component" names `var(--accent-green|red|blue)` as diff-line text. Such a site SHALL stay baselined until a change migrates it, and that change SHALL carry a MODIFIED delta to the mandating requirement in the same change, so the spec and the code move together.

**The check SHALL be a ratchet, not a sweep**, as a third arm of the same theme-token guard that carries the fallback-form and undeclared-token arms. It scans the same source roots, excludes test files in the same way, counts occurrences per `<file>::<token>` site, and carries an enumerated baseline of the text paints that exist when it lands (about 57 sites under the scanned roots, excluding the allowlisted file). It SHALL fail only on a text paint **added** after that, or on a baselined site whose occurrence count grows. Entries SHALL be removed from the baseline as surfaces adopt `--accent-<hue>-text`. Entries SHALL NOT be added, and the baseline writer SHALL refuse to grow this arm exactly as it refuses for the other two.

#### Scenario: A new fill-accent text paint fails
- **WHEN** a component adds `text-[var(--accent-red)]` at a site absent from the accent-as-text baseline
- **THEN** the guard SHALL fail, naming the token and the file

#### Scenario: A baselined site cannot grow
- **GIVEN** a file baselined with N occurrences of `--accent-blue` as text paint
- **WHEN** an (N+1)th occurrence is added to that file
- **THEN** the guard SHALL fail

#### Scenario: A spec-mandated legacy text paint stays baselined
- **GIVEN** `DiffView`'s `text-[var(--accent-green)]` / `--accent-red` / `--accent-blue` diff-line paints, mandated by `tool-renderers`
- **WHEN** the accent-as-text arm lands
- **THEN** those sites SHALL appear in the arm's baseline
- **AND** the guard SHALL pass with no change to `DiffView`

#### Scenario: The pre-existing text paints do not fail the build
- **GIVEN** the fill-accent text paints that exist when the arm lands are recorded in its baseline
- **WHEN** the guard runs with no source change
- **THEN** it SHALL pass

#### Scenario: Adopting the text ramp is not flagged
- **WHEN** a component paints text with `text-[var(--accent-purple-text)]` or `color: var(--accent-purple-text)`
- **THEN** the accent-as-text arm SHALL NOT record it

#### Scenario: Non-text accent paints are not flagged
- **WHEN** a component uses `bg-[var(--accent-green)]`, `border-[var(--accent-green)]`, `fill: var(--accent-green)` or `stroke: var(--accent-green)`
- **THEN** the accent-as-text arm SHALL NOT record it

#### Scenario: Icon descriptors mandated by file-extension-icon-lookup do not fail
- **WHEN** a new extension mapping with `text-[var(--accent-yellow)]` is added to `packages/client/src/lib/preview/file-icon.ts`
- **THEN** the accent-as-text arm SHALL NOT record it
- **AND** the fallback-form and undeclared-token arms SHALL still scan that file

#### Scenario: The allowlist is explicit
- **WHEN** the guard's non-text-paint allowlist is inspected
- **THEN** every entry SHALL be an exact repo-relative file path with a justification, never a directory or glob

#### Scenario: A repaired site is shrinkable and cannot regress
- **WHEN** a baselined site is migrated to `--accent-<hue>-text`
- **THEN** the guard SHALL report it as a shrinkable repair rather than failing
- **AND** after the baseline is shrunk, reintroducing the fill-accent text paint at that site SHALL fail
