# Test Plan — remediate-accent-text-contrast

Stage: design   Generated: 2026-10-02

No clarifications are outstanding. Every Triple slot is filled from the delta specs (`theme-gallery`, `theme-system`) and the design (D1–D6). The thresholds (AA 4.5:1, ΔE 8, the hue/saturation tolerance of the existing body-text block) and the fixtures are all concrete.

Harness exemplars:
- contrast rows → `packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts` (`PALETTES`, `contrast`, `hueSat`, `resolveValue`)
- key-coverage rows → `packages/client/src/lib/__tests__/themes.test.ts`
- runtime-apply rows → `packages/client/src/hooks/__tests__/useTheme.test.ts`
- guard rows → `scripts/__tests__/theme-token-guard.test.mjs` (`fixture()` temp-tree helper, `scan`/`ratchet`/`loadBaseline`)

---

## Scenarios

### Edge-case — accent-text ramp (theme-gallery)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | On-surface ramp: full ramp in every palette | EP (18 palettes × 6 keys) | L1 | automated | live `THEMES` | test enumerates `PALETTES` × `ACCENT_HUES` | all 108 `--accent-<hue>-text` values are present and match `/^#[0-9a-f]{6}$/i` |
| E2 | On-surface ramp: missing key is caught | EP (invalid) | L1 | automated | `CSS_VAR_KEYS` gains the 6 keys; one palette map lacks `--accent-red-text` | `themes.test.ts` key-coverage loop | that test fails naming the palette and key (verified red at task 3.1 before the literals are pasted) |
| E3 | AA on every text backdrop | BVA over 4 backdrops | L1 | automated | 108 tokens × `--bg-surface`, `--bg-tertiary`, `--bg-primary`, card fill `color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))` | contrast computed per cell (432 cells) | every ratio ≥ 4.5. The tightest cell (solarized:dark purple on card fill, ≈ 4.5012) passes |
| E4 | AA floor: just below the boundary fails | BVA (just-below) | L1 | automated | synthetic pair measuring 4.49:1 fed to the same assertion helper the AA block uses | helper invoked | the assertion fails with a message containing the palette/token label and `4.49:1` (proves the floor is `≥ 4.5`, not a rounded `≥ 4.4`) |
| E5 | Default palette purple legible | named boundary | L1 | automated | `base:dark` `--accent-purple-text` | measured on `--bg-surface` `#2a2a2a` | ≥ 4.5:1, while the source `#a855f7` measures 3.63:1 |
| E6 | Hue + saturation preserved | EP (chromatic vs collapsed) | L1 | automated | each `-text` paired with its live `--accent-<hue>` | `hueSat` compare with hoisted `hueTolerance` | hue Δ ≤ tolerance and `s_after ≥ 0.85 × s_before` for all 108 |
| E7 | Hue preservation catches neutral collapse | EP (invalid) | L1 | automated | a fixture palette whose `-text` is `#9a9a9a` for source `#a855f7` | preservation helper run on the fixture | fails: "collapsed toward neutral grey" |
| E8 | Passing source adopted unchanged | decision table (src passes all 4 / passes 2 but fails card or primary / fails surface) | L1 | automated | every (palette, hue) whose source `floor ≥ 4.5` on all 4 backdrops | equality check | `-text === source` byte-for-byte for exactly those 28 cells. Cells failing any backdrop are excluded from the equality rule |
| E9 | Base parity: explicit light declaration | state (declared / inherited / mismatched) | L1 | automated | `index.css` `:root` and `[data-theme="light"]` blocks read with the no-fallback `tokenIn` | parity block | each of the 6 `-text` tokens is found in BOTH blocks. `:root` value equals `baseDark` and light value equals `baseLight`. A token present only in `:root` fails the light case (no inheritance accepted) |
| E10 | Base parity: inherited source accents | invariant | L1 | automated | the 6 `--accent-<hue>` in `:root` | compared to `themes.ts` `baseDark` and `baseLight` | equal in both, which pins the inheritance Base light relies on |
| E11 | Known-indistinguishable recorded | decision table (listed × below-8) | L1 | automated | `KNOWN_INDISTINGUISHABLE = ["solarized:dark"]`, live values | min pairwise CIE76 ΔE per palette | solarized:dark < 8 (≈ 4.1, orange/red) and passes. Every unlisted palette ≥ 8 (nord:dark ≈ 10.1 is the closest) |
| E12 | Stale list entry fails | decision table (listed, ≥ 8) | L1 | automated | ΔE check run with a fixture palette that is listed but has six well-separated hues | check invoked | fails with a "remove from KNOWN_INDISTINGUISHABLE" message |
| E13 | New collision fails, naming the pair | decision table (unlisted, < 8) | L1 | automated | fixture palette, not listed, whose orange/red `-text` differ by ΔE < 8 | check invoked | fails, and the message names the palette and `orange/red` |
| E14 | Source accents untouched (one-time) | invariant (diff) | ci | automated | the change's diff vs `develop` for `themes.ts` and `index.css` | `git diff develop -- … \| grep -E '^-\s*"?--accent-(purple\|blue\|green\|orange\|red\|yellow)"?:'` (task 3.4) | prints nothing (no removed or changed source-accent line) |
| E15 | Reproducible derivation | determinism | ci | automated | committed `derive-accent-text.ts` run twice against live `THEMES` | `npx tsx` from `packages/client` | identical stdout both runs. Summary `80 remediated / 28 unchanged / 0 infeasible`, and every emitted hex equals the literal in `themes.ts` |

### Edge-case — guard arm `accentText` (theme-system)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| G1 | Text paint forms recorded | EP (positive classes) | L1 | automated | `fixture()` tree with `text-[var(--accent-red)]`, `text-[var(--accent-red)]/80`, `hover:text-[var(--accent-red)]`, `placeholder:text-[var(--accent-red)]`, a template-literal class, `style={{ color: "var(--accent-blue)" }}` | `scan()` | `accentText` has `Widget.tsx::--accent-red` = 5 and `Widget.tsx::--accent-blue` = 1 |
| G2 | CSS stylesheet text paint recorded | EP (file type) | L1 | automated | fixture `.css` file under the scanned root containing `a { color: var(--accent-green); }` | `scan()` | `accentText` has `<file>.css::--accent-green` = 1. The fallback/undeclared arms' maps are unchanged versus the same tree without that file |
| G3 | Non-text paints ignored | EP (negative classes) | L1 | automated | fixture with `--accent-red-text` (as class and `color:`), `bg-[var(--accent-green)]`, `border-[var(--accent-green)]`, `background-color:`, `border-color:`, `outline-color:`, `caret-color:`, `accent-color:`, `fill:`, `stroke:`, `decoration-[var(--accent-red)]` | `scan()` | `accentText` is `{}` |
| G4 | Test files skipped | EP | L1 | automated | `Widget.test.tsx` with `text-[var(--accent-red)]` | `scan()` | `accentText` is `{}` |
| G5 | Allowlist skips this arm only | decision table (arm × allowlisted) | L1 | automated | file at an allowlisted path containing `text-[var(--accent-yellow)]` plus a `var(--x, #fff)` fallback | `scan()` with `NON_TEXT_PAINT_FILES` covering that path | `accentText` has no entry for the file, while `fallback` still records `::--x` = 1 |
| G6 | New site fails | state (absent → present) | L1 | automated | baseline `accentText: {}`; tree with one `text-[var(--accent-red)]` | `ratchet()` | one violation naming `--accent-red` and the file |
| G7 | Baselined site cannot grow | BVA (N → N+1) | L1 | automated | baseline `Widget.tsx::--accent-blue: 2`; tree with 3 occurrences | `ratchet()` | violation reported with "3 occurrence(s), baseline allows 2" |
| G8 | Repair is shrinkable; reintroduction fails | state (2 → 0 → shrink → 1) | L1 | automated | baselined site migrated to `--accent-blue-text` | `ratchet()`, then the baseline is shrunk, then the old paint is re-added | step 1: `repaired` lists the key, no violation. Step 3: a violation |
| G9 | Pre-existing tree passes | invariant (real tree) | L1 | automated | real repo + committed baseline with `accentText` | real-tree `describe` | zero violations on all three arms |
| G10 | Real-tree baseline integrity | invariant | L1 | automated | committed `theme-token-baseline.json` | real-tree assertions | `accentText` is non-empty, no key token ends in `-text`, no key for `packages/client/src/lib/preview/file-icon.ts`, and `NON_TEXT_PAINT_FILES.length === 1` with an existing path and a non-empty `why` |
| G11 | Mandated icon mapping does not fail | scenario (spec) | L1 | automated | real tree with an added `file-icon.ts` descriptor line using `text-[var(--accent-yellow)]` (in-memory copy via `fixture()` at the allowlisted relative path) | `scan()` + `ratchet()` | no `accentText` violation |
| G12 | Spec-mandated legacy paint stays baselined | invariant (real tree) | L1 | automated | committed baseline; `packages/client/src/components/diff/DiffView.tsx` unchanged | real-tree assertions | `accentText` contains `DiffView.tsx::--accent-green`, `::--accent-red`, `::--accent-blue`, and the guard passes |

### Error-handling — guard bootstrap / baseline

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Bootstrap on absent key | state (absent) | L1 | automated | baseline JSON with `fallback`/`undeclared` only | `--write --bootstrap-arm accentText` against a fixture tree | exit 0. `accentText` is written. `fallback` and `undeclared` are byte-identical to the input |
| X2 | Bootstrap refuses when key present | illegal transition | L1 | automated | baseline already containing `accentText` | `--write --bootstrap-arm accentText` | non-zero exit, a stderr message naming the existing arm, and the file is unchanged (mtime + bytes) |
| X3 | Bootstrap refuses on missing baseline | fault (abort: file absent) | L1 | automated | baseline path does not exist | `--write --bootstrap-arm accentText` | non-zero exit, and no file is created |
| X4 | Bootstrap refuses on malformed baseline | fault (abort: invalid JSON) | L1 | automated | baseline file containing `{ "fallback": ` | `--write --bootstrap-arm accentText` | non-zero exit, and the file bytes are unchanged |
| X5 | Bootstrap cannot grow the old arms | illegal transition | L1 | automated | fixture tree with one NEW fallback binding not in the baseline | `--write --bootstrap-arm accentText` | non-zero exit naming the `fallback-form` growth, and the file is unchanged |
| X6 | Plain write cannot grow accentText | illegal transition | L1 | automated | bootstrapped baseline; tree adds a new `text-[var(--accent-red)]` | `--write` | non-zero exit ("refuses to GROW"), and the file is unchanged |
| X7 | Missing accentText after bootstrap is an error | fault (key deleted) | L1 | automated | baseline with `accentText` removed by hand | `loadBaseline()` | throws or returns an error, and the guard exits non-zero rather than treating the key as `{}` |

### Frontend-quirk — runtime application

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Ramp reaches the DOM for named themes | state-transition (base → named → base) | L1 | automated | jsdom `document.documentElement`; `useTheme` | select `solarized` dark, then back to `base` | after the named theme: inline `--accent-purple-text` equals the `solarizedDark` literal. After base: the inline property is removed (stylesheet value applies) |
| F2 | Solarized dark pastels acceptable in practice | visual/subjective | — | manual-only | a label rendered with each of the 6 `-text` tokens on solarized:dark `--bg-surface` | human inspects | [judgment: legible and acceptable as a recorded identity loss — no automatable observable beyond E3/E11] |
| F3 | Light-palette remediated hues still read as their hue | visual/subjective | — | manual-only | rose-pine:light yellow, catppuccin:light orange `-text` swatches | human inspects | [judgment: "reads as yellow/orange, not brown" — no automatable observable] |

### Performance

No scenarios. Neither delta states a latency, throughput or size budget. The change adds static tokens and one regex pass in a CI script. (A performance row would need a threshold the spec doesn't give, and none is warranted.)

---

## Coverage summary

- Requirements covered: 4/4 (theme-gallery: On-surface accent text ramp, Accent-text hue is a secondary cue; theme-system: Fill accents SHALL NOT be added as text paint, including allowlist + bootstrap mechanics from D6)
- Scenarios by class: edge 27 · perf 0 · frontend 3 · error 7
- Scenarios by level: L1 33 · ci 2 · — 2
- Scenarios by disposition: automated 35 · manual-only 2

## New infra needed

- none. E4/E7/E12/E13 need the AA, preservation and ΔE assertions factored into module-scope helpers that accept a fixture palette (same file, task 1.1 hoist). No new harness.
