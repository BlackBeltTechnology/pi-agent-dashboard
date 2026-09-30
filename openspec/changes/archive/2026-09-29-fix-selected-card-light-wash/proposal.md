# Fix the selected-card iridescent wash that hurts light-mode readability

## Why

In light mode the selected `SessionCard` interior is washed pink/violet/cyan and its
mid-tone text (OpenSpec step labels, blue links, git action buttons) becomes hard to read.

Root cause (verified in `packages/client/src/index.css` + `SessionCard.tsx`):

- The card root is `relative isolate` → its own stacking context. The root's own
  background (`--tint-blue-bg`) paints FIRST; negative-z children paint ON TOP of it.
- `.card-glow-fx` (`inset:-2px`, z -2) and `.card-glow-fx-outer` (`inset:-7px`, z -3) are
  `overflow:hidden` boxes filled edge-to-edge by a rotating blurred conic gradient. They
  were meant as a halo behind the card but actually cover the **whole interior**, between
  the card background and its content.
- Light mode deliberately boosts the glow (`--neon-glow-alpha` 0.18, `--neon-glow-opacity`
  0.52 vs dark 0.10 / 0.42) → ~16 % combined chromatic wash over near-white, dropping
  already-borderline accent text below AA.
- The crisp rim (`.card-ring-fx`) is fine — its xor mask carves the interior out.

A mockup (current vs rim 2px / 3px, light + dark) confirmed: masking the glow to the band
**outside** the card edge removes the wash entirely; a 3px rim reads as "selected" at a
glance in both themes; the outside-only halo needs a light-mode boost to remain visible.

## What Changes

- **Glow becomes outside-only.** Each glow layer is wrapped in a static wrapper carrying the
  same `content-box` xor mask as the rim, so the rotating blurred conic only shows in the
  band outside the card edge. The mask lives on the non-rotating wrapper so it does not spin.
- **Rim 1px → 3px** in both themes via a new `--neon-rim-width` token; rim alpha raised to
  `0.75` (the rim now carries the selection signal on its own).
- **Light-mode halo boost:** `--neon-glow-alpha` 0.18 → 0.30, `--neon-glow-opacity`
  0.52 → 0.65. Dark tokens unchanged.
- **Interior neutral:** desktop selected card drops the `--tint-blue-bg` fill and keeps `--bg-primary` like any card — the 3px rim + halo carry selection. Mobile (no rim) keeps the blue fill.
- Spec `session-card-selection` is brought in line with the shipped overlay-div
  implementation (it still describes `::before`/`::after` pseudo-elements and a
  `@property --neon-angle` rotation that were replaced by `.card-ring-fx`/`.card-glow-fx`
  overlays rotated via `transform`).

## Out of Scope

- `TAG_PALETTE` (`packages/shared/src/tags.ts`) only defines dark-tuned pastel text
  colors → user tags such as `#implementing` are ~1.5:1 on white in light mode on EVERY
  card. Separate follow-up change.
- A theme-wide AA audit of `--accent-green/amber/orange/red` text on `--tint-blue-bg`.
- Mobile card (no iridescent layers today; unchanged).

## Impact

- **Code:** `packages/client/src/index.css` (tokens, rim width, glow wrapper mask),
  `packages/client/src/components/session/SessionCard.tsx` (wrap the two glow divs).
- **Tests:** new CSS source-scan unit test; existing E2E selectors
  (`tests/e2e/idle-fx-pause.spec.ts` `.card-glow-fx::before`,
  `tests/e2e/ui-token-alignment.spec.ts` glow/rim exclusion) keep working — class names
  are preserved.
- **Compat / rollback:** client-only, CSS + one JSX wrapper; no data, protocol or server
  change. Rollback = revert the commit + `npm run build` + restart.
- **Perf:** no new animated layers; rotation cost unchanged (compositor-only transform).

## Discipline Skills

None of the `eng-disciplines` checkpoints apply: no auth/untrusted input, no latency
budget or large-data path, no new endpoint, no irreversible step. `review-code` runs
before commit per the standard implement flow.
