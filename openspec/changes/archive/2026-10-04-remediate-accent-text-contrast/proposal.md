## Why

The `--accent-*` ramp cannot be relied on to carry text on the dashboard's own surfaces: it passes in some palettes and fails in most, with no per-palette guarantee. Measured across every palette in `packages/client/src/lib/theme/themes.ts` — 18 palettes × 6 hues, each accent checked as text against that palette's own `--bg-surface` and `--bg-tertiary` at the WCAG 2.1 AA 4.5:1 floor:

```
checked 108   FAIL 80   PASS 28   (74% failing)
clean palettes: 1 of 18   (tokyoNightDark)
```

| Palette | failing hues |
|---|---|
| every `*Light` palette except `gruvboxLight`, plus `solarizedDark` | 6/6 |
| `nordDark`, `gruvboxDark`, `gruvboxLight` | 5/6 |
| `baseDark`, `catppuccinDark` | 3/6 |
| `draculaDark`, `githubDark` | 2/6 |
| `rosePineDark` | 1/6 |

This is not a light-theme edge case. `baseDark` — the default palette, the one most users see — fails on purple (3.63), blue (3.90) and red (3.81) against `--bg-surface`. `baseLight` fails on green at **1.73:1**, which is very close to invisible.

The gap is structural, not accidental: `--accent-*` was designed as a **fill and decoration** ramp (status dots, borders, chart series, mermaid strokes), and there is no corresponding **on-surface text** ramp. Any component that wants a coloured label therefore has three options today — use an illegal value, drop colour entirely, or hand-pick a one-off hex. All three are in the tree.

Discovered while designing `redesign-providers-settings-page`, whose badges wanted to carry provider kind as word + colour. That change reverted to neutral badges rather than ship colour that is correct on 1 palette and wrong on 17.

## What Changes

- Add an **on-surface text accent ramp**: `--accent-{purple,blue,green,orange,red,yellow}-text`, defined per palette in `themes.ts` for all 18 palettes and mirrored into `packages/client/src/index.css` for the base palette.
- Each value is remediated **by lightness only, preserving hue and saturation** — the rule established by `stop-discarding-known-session-state` when it remediated `--text-secondary` / `--text-tertiary` across the same 18 palettes. A palette's identity must survive its accents becoming legible.
- **Naming encodes the contract**: `--accent-*` remains fill/decoration (no contrast guarantee as text); `--accent-*-text` guarantees ≥4.5:1 against `--bg-surface`, `--bg-tertiary`, `--bg-primary` and the card fill in its own palette. It is distinct from the existing single link token `--accent-text`. A component picking the wrong one is then a reviewable error rather than an invisible one.
- Extend `src/lib/__tests__/theme-body-text-contrast.test.ts` (or add a sibling) to pin the new ramp: the AA floor on all four text backdrops (`--bg-surface`, `--bg-tertiary`, `--bg-primary`, card fill), a hue-distinction record, hue/saturation preservation against the source accent, and the existing `themes.ts` ↔ `index.css` parity assertion.
- Add a third, shrink-only arm to `scripts/theme-token-guard.mjs`: **accent-as-text**. A *new* `text-[var(--accent-<hue>)]` / `color: var(--accent-<hue>)` paint fails CI. The ~57 existing sites under the guard's scan roots are baselined (icon descriptors in `file-icon.ts` are allowlisted as non-text), and the baseline shrinks as surfaces adopt the `-text` ramp.
- **No component is migrated in this change.** It adds the ramp and its guarantee; adopting it is per-surface work, starting with `redesign-providers-settings-page`'s badges.

## Capabilities

### Modified Capabilities
- `theme-gallery` (owns the body-text contrast floor from `stop-discarding-known-session-state`, under "Theme definitions"): ADDS a sibling requirement that applies the same AA floor, hue/saturation-preservation and parity constraints to the six accent-text tokens. "Theme definitions" itself is unchanged. `theme-system`'s role ramp (`--accent`/`-soft`/`-solid`/`-text`) is a separate token family and is not modified.
- `theme-system`: ADDS "Fill accents SHALL NOT be added as text paint", the third ratchet arm of the theme-token guard, alongside the existing fallback-form and undeclared-token arms.

## Impact

- `packages/client/src/lib/theme/themes.ts` — 6 new `CSS_VAR_KEYS` entries; 6 new tokens × 18 palettes = **108 declarations** (80 of which require an actual remediated value; 28 already-passing accents can adopt their source value unchanged).
- `packages/client/src/index.css` — base dark + light mirror.
- `packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts` — extended.
- `scripts/theme-token-guard.mjs`, `scripts/theme-token-baseline.json`, `scripts/__tests__/theme-token-guard.test.mjs` — third arm + its baseline + tests.
- `ui-contract.md` — the light-override count and the "raw accents" guidance become stale; updated to name the `-text` ramp.
- **Solarized is the known hard case, again.** Both its palettes fail 6/6, and `stop-discarding-known-session-state` already recorded an accepted identity loss for it because its `--bg-surface` sits inside its own text ramp. Decided in design D4: no exemption. The AA floor holds, solarized:dark's accent hues are recorded as hard to tell apart, and the spec makes hue a secondary cue.
- Purely additive: no existing `--accent-*` value changes, so no shipped surface shifts. The new guard arm is green on landing, since its baseline matches the tree. Rollback is a revert of the commit.

## Discipline Skills

- `doubt-driven-review` — before the remediated values stand; a wrong value here is invisible until a user with that theme hits it.
- `review-code` — 108 declarations is a review surface where a transcription error is the likely defect, not a design error.
- `security-hardening`, `performance-optimization`, `observability-instrumentation` — not triggered; this is a static token change with no runtime, credential, or latency surface.
