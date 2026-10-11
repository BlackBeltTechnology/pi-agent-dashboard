# deck3d-variant-loop Specification

## Purpose
Makes every creative styling decision on a deck an explicit, reviewable choice. Candidate override fragments are rendered side by side against the original, live-switchable in the authoring server, recorded when picked, and replayable after a re-import.

## Requirements

### Requirement: style.json grammar and validation
A deck MAY carry `style.json` beside `deck.json` with `version: 1`, optional `source`, and an ordered `steps[]`. Each step has:
- `id` matching `^[a-z][a-z0-9-]{0,63}$`;
- `title`, `question`, and `slides[]` (sample slide ids);
- `round` (integer ≥ 1);
- `variants`: an ordered array of 2–4 entries `{ name, label, overrides }`, where `overrides` uses the deck overrides grammar;
- optional `picked` (a variant name, or `null` when the answer was free text), `note`, `pickedAt` (ISO 8601) and `pending` (boolean);
- optional `drop` (ids the pick was allowed to remove) and `replaceStep`, written by `variants pick` so `variants replay` repeats the same decision.

`deck3d validate deck.json` SHALL validate a `style.json` found beside it (absence is fine). It SHALL fail on:
- a step with fewer than 2 or more than 4 variants;
- duplicate variant names;
- a `picked` naming no variant;
- a fragment that fails the overrides schema.

A sample slide id absent from the deck SHALL be a warning, not an error. Every finding SHALL name the JSON path.

#### Scenario: Unknown pick
- **WHEN** a step has variants `A` and `B` and `picked: "C"`
- **THEN** `validate` exits non-zero naming `style.json` `steps[i].picked`

#### Scenario: Dangling sample slide after re-import
- **WHEN** a re-import removed slide `s09` that a step samples
- **THEN** `validate` warns naming `steps[i].slides` and exits 0

### Requirement: Variant contact sheet
`deck3d variants render --step <id> [--viewport WxH] [-o dir]` SHALL render the deck once per variant, each with that variant's fragment deep-merged into the current overrides in memory. `deck.json` SHALL be left byte-unchanged. It SHALL snapshot every sample slide that exists at rest at the viewport (default 1920×1080). A sample slide missing from the deck SHALL be skipped with a warning, and its row omitted. It SHALL write `variants/<step>/r<round>/<name>-<slide>.png` plus `contact.png`: a grid with one row per sample slide, a first column holding the reference render (when one exists), and one labelled column per variant, in array order. Temporary HTML SHALL be removed before the command exits.

#### Scenario: Contact sheet without touching deck.json
- **WHEN** `variants render --step placement` runs on a step with variants A, B and C and two sample slides
- **THEN** `contact.png` shows 2 rows × 4 columns (reference + A, B, C), `deck.json` is byte-identical to before, and no temporary HTML remains

### Requirement: Live variant switching in serve
`deck3d serve` SHALL accept `?variant=<step>:<name>` and render that variant in memory. While a variant is shown:
- `V` cycles that step's variants;
- `V` does nothing when the URL has no `variant` param or when a text input has focus;
- the configurator's Save and Apply actions are disabled with a visible notice, so a variant can never be written to disk through them;
- an unknown step or variant shows a visible notice and falls back to the deck without variants.

Serve SHALL rebuild when `style.json` or any file listed in `overrides.assets` changes. It SHALL defer any rebuild while `style.json` has `pending: true`, and rebuild once it is cleared.

#### Scenario: Switch is non-persistent
- **WHEN** a user opens `?variant=fidelity:B`, presses `V` twice and closes the tab
- **THEN** `deck.json` and `style.json` are unchanged

#### Scenario: Apply blocked during preview
- **WHEN** a variant is shown and the user opens the configurator
- **THEN** Save and Apply are disabled, and a notice says variants must be chosen with `variants pick`

### Requirement: Pick, ownership and replay
`deck3d variants pick <step> <name> [--note text] [--replace-step <id>] [--drop <id>]…` SHALL deep-merge the variant fragment into `deck.json` overrides, using the merge and validation rules of `overrides apply`.

Before writing, it SHALL refuse with a named conflict when the merge would remove any effect id or prop id currently present on a scope the fragment replaces. Removal is allowed only when `--drop <id>` names that id, or when `--replace-step <step>` names the earlier picked step that introduced it. This covers effects added by earlier steps, by the configurator or by hand. Because arrays replace, a fragment must carry forward everything it does not mean to remove.

It SHALL write both files via temporary files and renames:
1. `style.json` with `pending: true`;
2. `deck.json`;
3. `style.json` with `picked`, `note`, `pickedAt` and `pending: false`.

On a validation error or conflict, neither file SHALL change. Any variants command that finds `pending: true` SHALL report the interrupted pick and ask for it to be re-run.

`deck3d variants note <step> --note text` SHALL record a free-text answer (`picked: null`), and increment `round` for a new variant round. `deck3d variants replay` SHALL re-apply every picked fragment in step order to the current `deck.json`, with the same merge and guard as `pick`. Replay SHALL be idempotent: replaying onto a deck that already holds every pick changes nothing. It SHALL report each fragment key that references a slide or item id missing from the current layout.

#### Scenario: Atomic pick
- **WHEN** the picked fragment sets a param outside its card's range
- **THEN** `pick` exits non-zero naming the param, and both `deck.json` and `style.json` are byte-unchanged

#### Scenario: Later step cannot silently drop earlier effects
- **WHEN** step `placement` added `slide-layer` to `overrides.slides["s02"].effects` and a `worlds` fragment sets that array without it
- **THEN** `pick worlds A` exits non-zero naming `overrides.slides["s02"].effects`, `slide-layer` and step `placement`

#### Scenario: Configurator tuning is not silently dropped
- **WHEN** the configurator added `god-rays` to slide `s04` and a later `worlds` fragment replaces `s04`'s effects without it
- **THEN** `pick` exits non-zero naming `god-rays`, and succeeds only with `--drop god-rays`

#### Scenario: Replay is idempotent
- **WHEN** the pptx is re-imported with `--force` (overrides kept) and `variants replay` runs
- **THEN** `deck.json` overrides are unchanged, and keys referencing ids missing from the new layout are reported

### Requirement: Compare against the original
`deck3d compare <deck.html> [--ref dir] [--viewport WxH] [--threshold n] [--json] [--strict] [--transition] [-o dir]` (defaults: `--ref pptx/ref`, viewport 1920×1080, threshold 0.85) SHALL, for every slide that has a reference render:
1. snapshot it at rest;
2. crop the snapshot to the slide frame: the slide aspect from `pptx/layout.json` (or the reference image's aspect when there is no layout) contain-fitted into the viewport, so bars outside the frame never count, for layer and native decks alike;
3. resize the crop and the reference to 480 px wide;
4. compute the score as the mean SSIM over 8×8 windows of luminance, rounded to 0.001;
5. also report the mean absolute RGB difference (0–255) as information.

It SHALL print a per-slide table, warn for scores below the threshold, and list `font-fallback <name>` for every font the deck fell back from. It SHALL exit non-zero only with `--strict` and a slide below threshold. `--transition` SHALL additionally write frames at 25 %, 50 % and 75 % of each transition under `<dir>/transitions/`, for review, without scoring them.

#### Scenario: Identical render scores high
- **WHEN** a slide's reference image is a snapshot of that same slide at rest at the compare viewport
- **THEN** that slide's score is ≥ 0.99

#### Scenario: Strict gate
- **WHEN** one slide scores 0.6 and `--strict` is set
- **THEN** compare exits non-zero naming that slide and its score
