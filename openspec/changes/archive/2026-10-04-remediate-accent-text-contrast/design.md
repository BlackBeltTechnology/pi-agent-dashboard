## Context

See proposal.md (Why) for the failure census. Requirements: `specs/theme-gallery/spec.md`.

Current shape of the theme layer, as far as it constrains this change:

- `packages/client/src/lib/theme/themes.ts:83-612` declares 18 literal palette maps (`baseDark` … `gruvboxLight`). Each is wrapped by `withStatus` / `withStatusLight` (`:618-629`) and registered in `THEMES` (`:631`). `CSS_VAR_KEYS` (`:17`) lists every key a palette must define. `themes.test.ts:16-24` fails when a palette is missing a key in that list, and `useTheme.ts:52,62` applies or clears exactly those keys, so new keys reach the DOM with no extra wiring.
- `packages/client/src/index.css` mirrors only the Base palette. `:root` declares `--accent-{blue,green,yellow,red,purple,orange}` (`:118-123`). The `[data-theme="light"]` block (`:248`) does **not** re-declare them: Base light inherits the dark accent values, which today match `themes.ts` `baseLight`. The new `-text` tokens have *different* light values, so the light block **must** declare them explicitly, or Base light silently inherits the dark (lightened) values.
- `src/lib/__tests__/theme-body-text-contrast.test.ts` already has module-scope `luminance`, `contrast`, `hueSat`, `PALETTES`, and `resolveValue` / `resolveToken` (which resolve the card `color-mix`). `hueTolerance` (`:185`) and the parity helper `tokenIn` (`:132`) are **local to their `describe`** and must be hoisted to module scope for reuse. `tokenIn` reads one scope block with no fallback, so it catches a token missing from the light block.
- `scripts/theme-token-guard.mjs` is a two-arm shrink-only ratchet (fallback-form, undeclared-token) over `SCAN_ROOTS` (`packages/client/src`, `automation-plugin/src/client`, `flows-plugin/src/client`). Its baseline is `scripts/theme-token-baseline.json` (`{fallback, undeclared}` maps of `<file>::<token>` → count), and it is enforced in CI by `scripts/__tests__/theme-token-guard.test.mjs` ("passes on the repository as it stands"). Today about 139 `text-[var(--accent-<hue>)]` text paints exist across 34 files (repo-wide). Under `SCAN_ROOTS` minus the allowlisted `file-icon.ts`, about 57 remain to baseline.
- Two nearby tokens look similar but are different contracts (see D2): `--accent-text` (`index.css:145,295`, a single link-text token measured against `--bg-primary`, owned by `theme-system`) and `--tint-<hue>-fg` (`index.css:182-196`, a `color-mix` of 46% accent with `--text-primary`, held to a *relative* 3:1 gate in `message-severity-tokens`, no yellow).

Measured before drafting (script over the live `THEMES`): 80/108 accents fail on `--bg-surface`/`--bg-tertiary`. A lightness-only search finds a passing value for **all 80**: none is infeasible. Every candidate value, and every one of the 28 already-passing accents, also clears 4.5:1 on `--bg-primary` and on the card fill (worst case 4.5012, solarized:dark purple: a thin margin, see Risks). So extending the guarantee to those two backdrops costs nothing today. Lightness shifts range from one step, ≈0.003 (catppuccin:dark purple), to 0.49 (solarized:dark orange).

## Goals / Non-Goals

**Goals:**
- Six `--accent-<hue>-text` tokens in all 18 palettes, each pinned by a test to the AA floor on the four text backdrops and to the source accent's hue and saturation.
- The values are derived reproducibly: the derivation script will be committed in the change dir (task 2.1), so a reviewer can re-run it and get the same 108 hex values.
- Picking a fill accent for *new* text fails CI (D6), so the role split is enforced rather than left to review.
- Solarized's loss of hue distinction is recorded and tested, not hidden.

**Non-Goals:**
- Migrating any component to the new tokens, including the providers-page badges and the ~57 baselined sites (D6).
- Changing `--accent-<hue>`, `--accent-text`, `--tint-*` or `--severity-*`.
- A guarantee against `--bg-secondary`, `--bg-hover`, `--bg-selected`, `--bg-code` or tinted fills (`--tint-*-bg`, selected-card). Text on those backdrops stays the consumer's responsibility.
- Declaring the `-text` tokens for theme-invariant contexts (mermaid, charts). Those keep using fill accents.

## Decisions

### D1. Derive each value by a minimal HSL-lightness search, not by hand-picking
Let the backdrops `B` be {`--bg-surface`, `--bg-tertiary`, `--bg-primary`, card fill}, and `floor(c) = min over B of contrast(c, b)`. For each `(palette, hue)`:

1. If `floor(accent) ≥ 4.5`, then `-text = accent` (copied unchanged).
2. Otherwise convert the accent to HSL (standard CSS `hsl()` model). Pick the direction: toward white if `contrast(#ffffff, --bg-surface) > contrast(#000000, --bg-surface)`, else toward black. (Verified: for all 18 palettes `--bg-tertiary`, `--bg-primary` and the card fill sit on the same side of `--bg-surface`.) Step L in increments of 1/300 (H and S fixed). Convert back with the CSS `hsl()` → sRGB formula and round each channel with `Math.round`. Stop at the **first** step whose *rounded* hex has `floor ≥ 4.5`.

- **Why minimal:** each palette keeps as much of its own accent as possible. This is the same "lightness only" rule `stop-discarding-known-session-state` used for the text ramp, and it is deterministic.
- **Why the direction comes from the surface's best pole, not a luminance cutoff:** it picks the side with the most headroom directly. All 18 palettes have `--bg-tertiary` and `--bg-primary` on the same side of `--bg-surface`, so one direction serves every backdrop. If a future palette breaks that, the test catches it (the floor fails) and the script reports it as infeasible.
- **Why HSL L, not OKLCH L:** the existing `hueSat` fidelity check is defined in HSL. Remediating in another space would drift HSL hue and fail our own guard.
- **Alternative rejected: hand-tuned values per palette.** 80 hex values chosen by eye are impossible to review. The likely defect is a typo, not a design error.
- The script will be committed as `openspec/changes/remediate-accent-text-contrast/derive-accent-text.ts`. It travels with the change into the archive. It is **not** a runtime or build dependency. The test re-checks every literal, so the script needs no trust; it exists for reproducibility and review.

### D2. A new ramp, not reuse of `--tint-<hue>-fg` or `--accent-text`
- `--tint-<hue>-fg` is gated *relative* to the theme's own text, with a 3:1 floor and documented sub-AA exceptions (tokyo-night light ~2.7:1). It is designed to sit on `--tint-<hue>-bg` and has no yellow. Raising it to absolute AA would repaint every toast and banner and contradict `message-severity-tokens`. **Rejected.**
- `--accent-text` is one theme-invariant hue (blue) for links on `--bg-primary`, owned by `theme-system`'s "Accent tokens are declared for every theme". **Rejected** as the base for six per-palette hues. The spec states the two families are not interchangeable. No `theme-system` delta is needed because that requirement is unchanged.
- **Chosen:** a parallel per-palette ramp under `theme-gallery` (which owns per-palette token maps) whose name states its contract. Using `--accent-<hue>` for text then becomes a defect a reviewer can see.

### D3. Literal values per palette, not `color-mix` / `var()` derivation
CSS cannot express "lighten until 4.5:1". A fixed `color-mix(… white N%)` would change hue and saturation and could not hit the floor exactly in all 18 palettes. That is the same reason `message-severity-tokens` calls an absolute gate "unsatisfiable" for its *derived* tints. Literal per-palette values remove that limit, which is why this ramp can promise absolute AA. Literals also let the test compare values directly.

### D4. Hue distinction: CIE76 ΔE threshold of 8, explicit list
"Hard to tell apart" is the **minimum pairwise CIE76 ΔE between a palette's six `--accent-<hue>-text` values < 8** (sRGB → linear → XYZ D65 → CIELAB). Measured on the D1 candidates:

| palette | min ΔE | closest pair |
|---|---|---|
| solarized:dark | **4.1** | orange/red |
| nord:dark | 10.1 | orange/red |
| solarized:light | 11.8 | orange/red |
| all others | ≥ 13.7 | — |

- The test holds `KNOWN_INDISTINGUISHABLE = ["solarized:dark"]`. It asserts listed palettes are **below** 8 (the list can't go stale) and unlisted palettes are **at or above** 8 (a new collision is caught, with the closest pair named).
- **Why 8:** it sits between solarized:dark (4.1) and the next palette (10.1) with margin on both sides. **Why CIE76:** it is a few lines with no dependency. CIEDE2000 is more accurate, but the threshold only has to separate one clear outlier.
- **Alternative rejected (user decision during drafting):** exempting solarized:dark from the `--bg-surface` leg. The spec's "Accent-text hue is a secondary cue" requirement covers this case instead.

### D5. Tests extend the existing file
First hoist `hueTolerance` and `tokenIn` to module scope (no behaviour change for existing blocks). Then add new `describe` blocks in `theme-body-text-contrast.test.ts`:
1. AA floor: 6 hues × 4 backdrops × 18 palettes (432 assertions). The card fill resolves through the existing `resolveValue`.
2. Hue and saturation preservation of `-text` against the **live** `--accent-<hue>`, with the same tolerance rules as the body-text block. This couples permanently and on purpose: if a future change retunes a source accent, its `-text` must be re-derived or the test fails.
3. A passing source is adopted unchanged (`-text === source` whenever `floor(source) ≥ 4.5`).
4. Base parity: the six `-text` tokens in both `:root` and `[data-theme="light"]` via the no-fallback `tokenIn`. Also, the six source accents in `:root` equal both `baseDark` and `baseLight` in `themes.ts`, which pins the inheritance that Base light relies on.
5. The D4 distinction check.

"Source accents untouched" is a **one-time** property of this change. It is verified by a diff check in tasks, not by a permanent literal snapshot, which would freeze 108 values against all future retunes.

### D6. Third guard arm: `accentText`
Add an `accentText` arm to `scripts/theme-token-guard.mjs`, reusing its `scan` walk, test-file exclusion, `<file>::<token>` occurrence counting and `ratchet()`:

- **Patterns:** `text-\[var\(\s*(--accent-(?:purple|blue|green|orange|red|yellow))\s*\)\]` (an opacity suffix `/NN` after `]` is still a match, because the regex doesn't anchor past `]`), plus `color\s*:\s*["'`]?var\(\s*(--accent-<hue>)\s*\)`. The negative case is structural: the hue alternation is followed by `\s*\)`, so `--accent-red-text` never matches. `background-color` / `border-color` are excluded by a lookbehind that rejects `-` immediately before `color`.
- **Baseline:** `theme-token-baseline.json` gains an `accentText` map. The existing `--write` refuses to grow any arm and hard-errors on a missing baseline, and a brand-new arm is by definition "growth from nothing". So the arm is bootstrapped once by a `--write --bootstrap-arm accentText` path that is permitted **only** while the `accentText` key is absent. Afterwards the normal shrink-only rule applies. `loadBaseline` treats a missing `accentText` key as an error after bootstrap, never as `{}`.
- **File types:** the existing walk reads only non-test `.ts`/`.tsx` (`scripts/theme-token-guard.mjs:102`). This arm also reads `.css` under `SCAN_ROOTS`, because the spec counts a CSS `color:` declaration as a text paint. The other two arms keep their current file set, so their baselines don't change. Zero CSS sites match today, so the bootstrap baseline doesn't grow from this.
- **Bootstrap safety:** the existing `--bootstrap` path treats any baseline load error as permission to write a fresh baseline (`scripts/theme-token-guard.mjs:161-209`). `--bootstrap-arm accentText` must NOT reuse that path. It reads the raw JSON itself, requires `fallback` and `undeclared` to parse and to be byte-preserved in the output, refuses if `accentText` already exists, and refuses on a malformed or missing file. Once `accentText` exists, a normal `loadBaseline` treats its absence as an error.
- **Non-text paints:** an icon glyph coloured via `currentColor` uses the same `text-[var(--accent-<hue>)]` class as text, and that use is correct (3:1 non-text). `file-extension-icon-lookup` *mandates* those classes in `packages/client/src/lib/preview/file-icon.ts` (52 sites), so baselining them would make every new extension mapping a CI failure against its own spec. The guard therefore carries `NON_TEXT_PAINT_FILES = [{ path, why }]`, an exact-path list skipped by this arm only, with `file-icon.ts` as its one entry. **Rejected (user decision):** a same-line suppression marker (noisy across a 52-line table, and an easy escape hatch elsewhere). Scattered icon uses in components stay baselined.
- **Why a ratchet and not a sweep:** migrating about 57 sites is per-surface design work (the proposal's non-goal). A sweep would either fail on landing or force a blind token swap that changes rendered colour on 34 files.
- **Why inside `theme-token-guard` and not a new script:** same baseline semantics and the same CI test, with one place to read. The real-tree test gains "carries a non-empty `accentText` baseline" and "baselines no `--accent-<hue>-text` token" assertions, mirroring the existing per-arm checks.
- **Alternative rejected (user decision during review):** softening the proposal's "reviewable error" claim and deferring enforcement. Without the arm, the naming contract is only a convention.

If `theme-body-text-contrast.test.ts` grows past readability, split into a sibling `theme-accent-text-contrast.test.ts` that imports hoisted helpers from a shared module. That is left to the implementer.

## Risks / Trade-offs

- [Transcription error across 108 literals] → The test re-measures every literal (D5.1–3). Values are pasted from script output, not typed (D1).
- [Base light inherits the dark `-text` values because the light block wasn't updated] → The parity test reads the light block with no fallback (D5.4).
- [Solarized dark accents read as near-white pastels: legible but similar] → Accepted and recorded (D4, spec). The spec makes hue a secondary cue that each adopting surface must back with a word, icon or shape.
- [nord:dark sits at ΔE 10.1, close to the threshold] → The D4 check fails if a future palette edit pushes it under 8. The owner then lists it or retunes the surface.
- [Large lightness shifts on light palettes (up to −0.27, rose-pine:light yellow) make some accents read as "brown" rather than "yellow"] → That is what lightness-only remediation does. Hue is secondary per spec, and adopting surfaces can pick a different hue.
- [The card-fill backdrop is defined by a `color-mix` recipe in `packages/client-utils/src/AgentCardShell.tsx:33` (the client path re-exports it). If that recipe changes, the guarantee tests the old recipe] → Same exposure as the existing card-fill body-text block. Both use the same literal recipe string, and a recipe change must update both.
- [The worst cell (solarized:dark purple on card fill) clears by about 0.001. A one-step `--bg-*` nudge could flip it] → The AA test fails loudly, and the fix is re-running the D1 script for that palette.
- [A regex arm misses a text paint form (e.g. `className={cn("text-[var(--accent-red)]")}` is caught, but a computed `` `text-[var(${tok})]` `` is not)] → Same limitation as the existing arms (static scan). Dynamic token construction is rare and stays a review concern.
- [`tool-renderers` "DiffView component" *mandates* `var(--accent-<hue>)` diff-line text, so one spec requires what the new rule forbids for new code] → The rule forbids *adding* paints and grandfathers baselined ones. DiffView's paints are baselined, not allowlisted: diff text is real text, and staying in the baseline keeps it visible as debt. Migrating DiffView must modify that requirement in the same change (theme-system delta).
- [The allowlist becomes a dumping ground] → exact paths only, each with a `why`; a real-tree test pins its length to 1, so adding an entry is a reviewed test change.
- [The arm's baseline scope is `SCAN_ROOTS`, so text paints in other plugin packages are not ratcheted] → Consistent with the existing arms. Widening `SCAN_ROOTS` is a separate change for all three arms at once.
- [A future `--bg-*` retune silently breaks the floor] → The AA test runs over the live tokens, so any regression fails CI.

## Migration Plan

Purely additive: new keys in `CSS_VAR_KEYS`, new literals, new CSS declarations, a new guard arm with a baseline matching the tree. No consumer exists yet, so nothing repaints, and the guard is green on landing. `useTheme` applies the tokens automatically through `CSS_VAR_KEYS`. Deploy: client build + restart. Rollback: revert the commit. No persisted state is involved.
