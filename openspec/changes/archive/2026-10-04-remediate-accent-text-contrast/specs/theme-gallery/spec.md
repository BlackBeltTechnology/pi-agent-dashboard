## ADDED Requirements

### Requirement: On-surface accent text ramp
Every palette (9 themes × dark/light = 18) SHALL define an on-surface text accent ramp of six tokens: `--accent-purple-text`, `--accent-blue-text`, `--accent-green-text`, `--accent-orange-text`, `--accent-red-text` and `--accent-yellow-text`. The ramp SHALL be part of the set of CSS custom properties every theme defines, and the Base palette's values SHALL be mirrored per mode: Base dark's in `index.css` `:root` and Base light's in `[data-theme="light"]`, each identical to its `themes.ts` counterpart for that mode.

The token name SHALL encode the role contract:
- `--accent-<hue>` is a fill / decoration token (status dots, borders, chart series, diagram strokes). It carries **no** contrast guarantee as text.
- `--accent-<hue>-text` is the token for coloured text. Each SHALL reach **WCAG 2.1 AA 4.5:1** against every one of its palette's four text backdrops: `--bg-surface`, `--bg-tertiary`, `--bg-primary`, and the card fill `color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))`.

This ramp is separate from the theme-invariant link token `--accent-text`, which `theme-system` owns and guarantees only against `--bg-primary`. The two SHALL NOT be treated as interchangeable.

An absolute AA floor is achievable here, unlike for the derived `--tint-*` / `--severity-*` tokens in `message-severity-tokens`, because each value is a literal chosen per palette rather than a fixed `color-mix` recipe.

Each `--accent-<hue>-text` value SHALL derive from the same palette's `--accent-<hue>` by adjusting **lightness only**, preserving hue and saturation, as for the body-text remediation in "Theme definitions". Where the source accent already meets the floor on all four backdrops, the text token SHALL equal the source accent unchanged.

Adding the ramp SHALL NOT change any existing `--accent-<hue>` value, so no shipped surface repaints.

#### Scenario: Every palette defines the full ramp
- **GIVEN** any of the 18 palettes
- **WHEN** its token map is inspected
- **THEN** all six `--accent-<hue>-text` tokens SHALL be present as opaque `#rrggbb` values

#### Scenario: Every accent-text token meets AA on every text backdrop
- **GIVEN** all 18 palettes and all six hues (108 tokens)
- **WHEN** each `--accent-<hue>-text` is measured against that palette's `--bg-surface`, `--bg-tertiary`, `--bg-primary` and card fill
- **THEN** every ratio SHALL be ≥ 4.5:1
- **AND** a test SHALL fail if any palette regresses below the floor

#### Scenario: Default palette purple is legible as text
- **GIVEN** the Base dark palette, whose `--accent-purple` `#a855f7` measures 3.63:1 on `--bg-surface`
- **WHEN** `--accent-purple-text` is measured on `--bg-surface`
- **THEN** it SHALL measure ≥ 4.5:1

#### Scenario: Remediation preserves hue and saturation
- **GIVEN** a palette's `--accent-<hue>` and its `--accent-<hue>-text`
- **WHEN** both are compared
- **THEN** the text token SHALL keep the source's hue and saturation within the tolerance used for the body-text tokens
- **AND** SHALL NOT be replaced by a neutral grey or by `--text-primary`

#### Scenario: Already-passing accents are adopted unchanged
- **GIVEN** a source `--accent-<hue>` that already meets 4.5:1 on all four backdrops of its palette
- **WHEN** the ramp is defined
- **THEN** `--accent-<hue>-text` SHALL equal `--accent-<hue>` exactly

#### Scenario: Base palette sources cannot drift
- **WHEN** the Base dark and light palettes are compared between `themes.ts` and `index.css`
- **THEN** each of the six `--accent-<hue>-text` tokens SHALL be declared explicitly in both `:root` and `[data-theme="light"]`, with no reliance on inheritance from `:root`
- **AND** each `:root` value SHALL equal `themes.ts` Base dark, and each `[data-theme="light"]` value SHALL equal `themes.ts` Base light
- **AND** each source `--accent-<hue>` value that Base light inherits from `:root` SHALL equal the `themes.ts` Base light value

#### Scenario: Source accents are untouched
- **WHEN** the change that adds the ramp is diffed
- **THEN** no `--accent-<hue>` value in any palette SHALL differ from its value before the change

### Requirement: Accent-text hue is a secondary cue
Hue in the `--accent-<hue>-text` ramp SHALL be treated as a secondary cue only. A surface that adopts an accent-text token SHALL carry its meaning in a word, icon or shape as well, so the meaning survives if two hues look alike. Each adopting change is responsible for showing this for its own surface.

The ramp SHALL NOT guarantee that its six hues can be told apart from each other in every palette. Lightness-only remediation against a mid-luminance surface pushes several hues toward the same near-white or near-black. Solarized dark is the recorded case: its `--bg-surface` (`#586e75`) forces orange, red, blue and purple to near-white pastels that are legible but hard to tell apart. This SHALL be recorded as an accepted, known identity loss, consistent with the Solarized body-text precedent. It SHALL NOT be fixed by exempting Solarized from the AA floor or by breaking the lightness-only rule.

"Hard to tell apart" is defined as: the minimum pairwise CIE76 ΔE between a palette's six `--accent-<hue>-text` values is below 8.

#### Scenario: Known-indistinguishable palettes are recorded, not hidden
- **GIVEN** the accent-text contrast test
- **WHEN** it runs
- **THEN** it SHALL hold an explicit list of palettes whose accent-text hues are hard to tell apart, containing `solarized:dark`
- **AND** each listed palette SHALL still pass the AA floor and the hue/saturation-preservation checks

#### Scenario: The recorded list cannot go stale silently
- **GIVEN** a palette on the known-indistinguishable list
- **WHEN** its minimum pairwise ΔE rises to 8 or above
- **THEN** the test SHALL fail, prompting removal of the palette from the list

#### Scenario: A new collision is caught
- **GIVEN** a palette not on the known-indistinguishable list
- **WHEN** its minimum pairwise ΔE falls below 8
- **THEN** the test SHALL fail, naming the palette and the closest hue pair
