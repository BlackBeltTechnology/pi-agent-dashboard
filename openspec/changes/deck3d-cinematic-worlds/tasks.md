## 1. Land the navigation fix already on the tree

- [ ] 1.1 Commit `packages/deck3d/src/runtime/index.ts` `navTo` + listeners and `src/runtime/AGENTS.md` row as the first step of this change; verify `npx vitest run src/__tests__/navigation.test.ts` passes in `packages/deck3d`
- [ ] 1.2 Extend `src/__tests__/navigation.test.ts` (existing exemplar) with the key matrix — input: 3-slide deck · trigger: `ArrowRight`×2, `ArrowLeft`, `Space`, `End`, `Home`, `PageDown`, `ArrowUp` · observable: `current()` reads 2,3,2,3,3,1,2,1 and `location.hash` tracks each (test-plan #E26)
- [ ] 1.3 Extend `src/__tests__/navigation.test.ts` — input: slide 1 `ArrowLeft`; last slide `ArrowRight` and click; `Meta+ArrowRight` on slide 1 · trigger: keys/click · observable: current stays 1, 3, 3, 1 (test-plan #E27)
- [ ] 1.4 Extend `src/__tests__/navigation.test.ts` — input: on slide 1 set `location.hash` to `#3`, `#0`, `#99` · trigger: hashchange · observable: current 3, 1, 1 (test-plan #E28)

## 2. IR schema and merge grammar

- [ ] 2.1 Extend `src/ir/schema.json` + `src/ir/types.ts`: `overrides.slides[].diagram.kind` (built kinds only), `diagram.data {labels?, values? ≥ 0}`, `defaults.autoStyle`, palette enum ×9, `local:` effect refs with `sha256`, `effects[]` item union; verify `npx vitest run src/ir` passes and `openspec validate deck3d-cinematic-worlds --strict` still passes
- [ ] 2.2 Make `diagram.data` an atomic-replace key in `src/ir/merge.ts`; verify existing `ir/__tests__/merge.test.ts` still passes
- [ ] 2.3 Add `deck3d overrides apply <deck.json> <file>` to `src/cli.ts` (deep-merge under D1 grammar, arrays + `data` replace, re-validate, non-zero on error with JSON path); verify `deck3d overrides apply` on a fixture prints the merged `overrides` and exits 0
- [ ] 2.4 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: `overrides.slides[x].diagram.kind` across the 10 built values + `flowchart`, `sequence`, `pie` · trigger: `validate` · observable: first ten exit 0, last three non-zero naming path + enum (test-plan #E16)
- [ ] 2.5 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: `data.values` `[0]`, `[0.0001]`, `[-0.0001]`, `[3,-1]`, `["3"]` · trigger: `validate` · observable: first two 0, others non-zero naming `…values[i]` + `minimum 0`/type (test-plan #E17)
- [ ] 2.6 Test (see `ir/__tests__/schema.test.ts`) — input: `overrides.deck.palette` ∈ 10 valid values + `sunset` · trigger: `validate` · observable: ten exit 0, `sunset` non-zero + enum (test-plan #E18)
- [ ] 2.7 Test (see `ir/__tests__/merge.test.ts`) — input: derived `data {labels:[a,b], values:[1,2]}` and override `data {labels:[x,y]}` · trigger: merged view · observable: `diagram.data` deep-equals `{labels:[x,y]}` with no `values` (test-plan #E19)
- [ ] 2.8 Test (see `ir/__tests__/e9-merge-grammar.test.ts`) — input: four `overrides apply` cases (scalar merge into existing slide; effects array replace; `data` replace; invalid `depthRelief:"x"`) · trigger: CLI · observable: `{mode:light,camera:{distance:11}}`; `[aurora]`; `{labels:[x]}`; non-zero + JSON path with deck.json unchanged (test-plan #E22)
- [ ] 2.9 Test (see `ir/__tests__/x11-bad-json.test.ts`) — input: non-JSON file; file with unknown key `slides.geo.foo` · trigger: `overrides apply` · observable: both non-zero (parse error / path `overrides.slides.geo.foo`), deck.json byte-unchanged (test-plan #X15)

## 3. Palettes

- [ ] 3.1 Add `midnight`, `ember`, `arctic`, `forest`, `mono`, `neon` to `src/runtime/palette.ts` `PALETTES` with dark + light sets; verify `fx preview aurora --palette ember` renders a non-black PNG
- [ ] 3.2 Test (see `fx/__tests__/corpus.test.ts`) — input: all 9 named palettes × {dark, light} · trigger: computed WCAG contrast text/bg · observable: every pair ≥ 4.5:1 (test-plan #E45)

## 4. Built diagrams reachable

- [ ] 4.1 Implement the ordered built-kind table + `data` harvest in `src/parse/derive.ts` (D2 order; years never values; `autoStyle:false` → none; title/section/credits excluded; supported mermaid wins with inert-override warning; unsupported fence treated as diagram-less); verify `deck3d parse` on a fixture with a "- 2026 / - 2027" slide yields `timeline-rail`
- [ ] 4.2 Add `bars`, `funnel`, `timeline-rail`, `globe`, `orbit-cluster`, `stack` builders to `src/runtime/builders.ts` returning `{ g, tick, nodes, labels }` (zero value → plinth stub with label); verify `deck3d snapshot` of a 6-slide built-kind fixture shows all six
- [ ] 4.3 Test (see `parse/__tests__/derive.test.ts`) — input: 11 content/section slides listed in the plan (years, percentages, "Deal pipeline review", "Our agents", "Feedback loop", "The LLM", "Global trade", "Partner ecosystem", "Compute layers", "Lunch menu", section "Timeline") · trigger: `parse` · observable: timeline-rail, bars, funnel, swarm, loop, brain, globe, orbit-cluster, stack, none, none (test-plan #E37)
- [ ] 4.4 Test (see `parse/__tests__/derive.test.ts`) — input: bullets "- 88% adoption", "- 2026: MVP", "- 0 churn", "- plain" · trigger: `parse` · observable: labels `[adoption, 2026: MVP, churn, plain]`, `values` omitted because not all numeric (test-plan #E38)
- [ ] 4.5 Test (see `ir/__tests__/e5-overrides-survive-reparse.test.ts`, chromium) — input: `diagram.kind: brain` override, markdown gains a `flowchart` · trigger: `parse` · observable: derived `flowchart`, override retained, warning names `overrides.slides["flow"].diagram.kind` + "ignored", exit 0 (test-plan #E20)
- [ ] 4.6 Test (see `ir/__tests__/e5-overrides-survive-reparse.test.ts`, chromium) — input: ```pie fence + `diagram.kind: bars` override · trigger: `parse` · observable: derived `bars`, unsupported-type warning present, no "ignored" warning (test-plan #E21)
- [ ] 4.7 Test (see `render/__tests__/f1-measure-stable.test.ts`, chromium) — input: `bars` with `[1,2,4]`; `[0,5]`; labels only · trigger: `measure()` · observable: 3 `node` kinds with height ratio 1:2:4 ±5 %; `[0,5]` first rect height > 0 with label; no values → equal heights ±2 % (test-plan #E24)
- [ ] 4.8 Test (see `render/__tests__/f7-message-order.test.ts`, chromium) — input: 9 slides, one per built kind, 4 labels each · trigger: `measure()` per slide · observable: ≥ 4 labelled `node` entries each, none throws, `timeline-rail` labels alternate above/below rail centre (test-plan #E25)

## 5. Effects corpus: extended context, topics, topic-world backgrounds

- [ ] 5.1 Extend `FxContext` in `src/fx/types.ts` with `rng` and `slide`; thread them from `src/runtime/index.ts`; verify `npx vitest run src/fx` passes unchanged
- [ ] 5.2 Add optional `tags.topic[]` (closed 12-value enum) to `src/fx/meta.schema.json`; allow `source: "local"` at schema level while the corpus test rejects it for `src/fx` cards; verify `npx vitest run src/fx/__tests__/corpus.test.ts` passes
- [ ] 5.3 Implement `globe-arcs`, `city-grid`, `neural-mesh`, `vault-glyphs`, `server-racks`, `market-tape`, `orbit-agents`, `paper-stack` in `src/fx/` with cards (topics, `density`/`speed` params, seeded rng, quality-scaled counts); retro-fit topics onto `hex-grid`, `grid-horizon`, `constellation`, `data-columns`, `glyph-rain`; regenerate `reference/effects.md`; verify `deck3d fx list --topic geo` prints `globe-arcs`
- [ ] 5.4 Rewrite `defaultEffectsFor` in `src/fx/defaults.ts` per D3 (v1 prefix, topic step before `particles`, `autoStyle` opt-out); verify existing `fx/__tests__/e25-defaults.test.ts` + `defaults.test.ts` still pass
- [ ] 5.5 Add `--topic` to `fx list` and `--palette` + `local:` support to `fx preview` in `src/cli.ts`; verify `deck3d fx list --topic finance` exits non-zero naming the vocabulary
- [ ] 5.6 Test (see `fx/__tests__/corpus.test.ts`) — input: card fixtures with `tags.topic ["finance"]`, `["geo"]`, corpus card `source: "local"` · trigger: corpus test · observable: fails naming card + vocabulary; passes; fails (test-plan #E29)
- [ ] 5.7 Test (see `fx/__tests__/e27-corpus-licence.test.ts`) — input: shipped cards · trigger: corpus test · observable: each of 12 topics has ≥ 1 `background` card (test-plan #E30)
- [ ] 5.8 Test (see `fx/__tests__/corpus.test.ts`) — input: every corpus effect · trigger: construct with `{THREE,palette,mode,quality,rng,slide}` then dispose · observable: none throws (test-plan #E31)
- [ ] 5.9 Test (see `fx/__tests__/defaults.test.ts`) — input: five slides (security+flowchart; title-ish "Data Platform 2030"; content "Regional trade shifts"; same with `autoStyle:false`; content "Weather") · trigger: `defaultEffectsFor` · observable: glyph-rain, data-columns, globe-arcs, particles, particles (test-plan #E32)
- [ ] 5.10 Test (see `fx/__tests__/e25-defaults.test.ts`) — input: every slide of `fixtures/strategy-lab.md` · trigger: old vs new `defaultEffectsFor` · observable: identical for every slide not resolving to `particles` under v1 (test-plan #E33)
- [ ] 5.11 Test (see `fx/__tests__/fx-cli.test.ts`) — input: `fx list --topic geo`; `--topic finance` · trigger: CLI · observable: first lists `globe-arcs` not `neural-mesh`; second non-zero naming vocabulary (test-plan #E34)
- [ ] 5.12 Test (see `render/__tests__/p3-render-determinism.test.ts`, chromium) — input: `fx preview globe-arcs` ×2 · trigger: CLI · observable: PNG bytes identical (test-plan #E36)
- [ ] 5.13 Test (see `render/__tests__/e20-quality-effects.test.ts`, chromium) — input: each topic background at `quality: low` vs `high` · trigger: read `object.userData.count` · observable: low ≤ 50 % of high (test-plan #P2)

## 6. Local effects

- [ ] 6.1 Implement local-effect resolution in `src/fx/local.ts`: name grammar, file + card load, sha256, 64 KiB cap, kind ∈ {background, motion}, module-shape check (leading `export default function`, no other export), static lint (`import`/`require`/`eval`/`Function`, case-sensitive, string/comment-stripped); wire into `validate` (when deck dir known) and `render`; verify `deck3d validate` on a fixture with a bad hash exits non-zero naming path + file
- [ ] 6.2 Embed `{ card, src }` per referenced local effect into `window.__DECK_LOCAL_FX` in `src/render/index.ts` as JSON with `<` → `\u003c`; verify rendered HTML contains the module source and no `<script src=`
- [ ] 6.3 Runtime instantiation in `src/runtime/index.ts`: `new Function` wrapper with the shadowed-globals list + frozen `Math` (`random` = `ctx.rng`), try/catch around `create`/`tick`/`dispose`, `effects().errors` `{slide, effectId, phase}`, `console.error` for the message; verify a fixture module reading `typeof window` reports `"undefined"`
- [ ] 6.4 Pass `localCards` into `composeEffects` in `src/fx/compose.ts` so `local:` ids take part in conflict/mode/budget gating; verify `e21-budget.test.ts` + `e22-conflict.test.ts` still pass
- [ ] 6.5 Add `fx scaffold`, `fx hash`, `fx promote --source --licence` to `src/cli.ts`; verify `fx scaffold neural-mesh --for ai` then `validate` exits 0 with the printed entry pasted
- [ ] 6.6 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: ids `local:a`, 64-char, 65-char, `local:9x`, `local:A1`, `local:a_b` · trigger: `validate` · observable: first two 0, last four non-zero naming id + grammar (test-plan #E1)
- [ ] 6.7 Test (see `props/__tests__/e31-oversized.test.ts`) — input: `fx/big.js` 65 536 bytes then 65 537 · trigger: `validate` · observable: 0 then non-zero naming file + `64 KiB` (test-plan #E2)
- [ ] 6.8 Test (see `props/__tests__/e30-hash-mismatch.test.ts`) — input: sha256 correct / one digit off / uppercase · trigger: `validate` then `render` · observable: 0; non-zero naming `…effects[0].sha256` + file with no HTML; uppercase treated as mismatch (test-plan #E3)
- [ ] 6.9 Test (see `fx/__tests__/e24-card-params.test.ts`) — input: card `kind` across all 7 values · trigger: `validate` · observable: background, motion → 0; other five non-zero naming card + allowed kinds (test-plan #E4)
- [ ] 6.10 Test (see `fx/__tests__/e24-card-params.test.ts`) — input: local card `density 0..1`; params `0`, `1`, `-0.01`, `1.01`, `"1"` · trigger: `validate` · observable: first two 0; others non-zero naming `…params.density` + range (test-plan #E5)
- [ ] 6.11 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: 7 module variants (comment-first; statement-first; named export; `import(`; `new Function(`; inner `function`; `"require"` in string) · trigger: `validate` · observable: a, f, g pass; b "must start with export default"; c "single default export"; d names `import`; e names `Function` (test-plan #E6)
- [ ] 6.12 Test (see `render/__tests__/p3-render-determinism.test.ts`, chromium) — input: deck with 2 local + 1 corpus effect · trigger: `render` ×2 · observable: byte-identical HTML, both sources embedded as JSON strings, zero `<script src=` (test-plan #E7)
- [ ] 6.13 Test (see `render/__tests__/e35-json-safe.test.ts`, chromium) — input: module containing literal `"</script><script>window.pwned=1</script>"` · trigger: render + open headless · observable: `window.pwned` undefined, `__deck3d` defined, effect object present (test-plan #E8)
- [ ] 6.14 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module reporting `typeof` of all 29 shadowed identifiers into `userData` · trigger: open + `gotoSlide` · observable: every entry `"undefined"`, `typeof Math.random` `"function"` (test-plan #E9)
- [ ] 6.15 Test (see `render/__tests__/f1-measure-stable.test.ts`, chromium) — input: module scattering 200 points via `Math.random()` · trigger: open twice, read a labelled child's rect · observable: identical across loads (test-plan #E10)
- [ ] 6.16 Test (see `fx/__tests__/e21-budget.test.ts`) — input: `quality: low`, corpus cost 5 + local cost 1, then local cost 2 · trigger: `render` · observable: 6 no warning; 7 warning `7 > 6` and `check` `warn budget` (test-plan #E11)
- [ ] 6.17 Test (see `fx/__tests__/e22-conflict.test.ts`) — input: local card `conflicts ["aurora"]`; effect lists [aurora, local:x] / [local:x] / [starfield, local:x] · trigger: `render` · observable: first non-zero naming `local:x`, `aurora`, slide; other two 0 (test-plan #E12)
- [ ] 6.18 Test (see `fx/__tests__/fx-cli.test.ts`) — input: empty deck dir; `fx scaffold neural-mesh --for ai` twice · trigger: CLI · observable: first creates both files with sha256 matching the file and a paste-able entry that validates; second exits non-zero "exists" with files unchanged (test-plan #E13)
- [ ] 6.19 Test (see `fx/__tests__/fx-cli.test.ts`) — input: scaffolded module, then append a comment · trigger: `fx hash` before/after · observable: two different 64-hex values, second equals recomputed sha256 (test-plan #E14)
- [ ] 6.20 Test (see `fx/__tests__/e47-catalogue-sync.test.ts`, temp corpus copy) — input: `fx promote` with no flags / `--source` only / `--licence` only / non-permissive licence / both valid · trigger: CLI · observable: first four non-zero naming the gap, nothing moved; last moves the pair into the corpus copy with given source+licence, removes `fx/*`, regenerates catalogue (test-plan #E15)
- [ ] 6.21 Test (see `fx/__tests__/fx-cli.test.ts`, chromium) — input: deck dir with scaffolded `fx/neural-mesh.*` · trigger: `fx preview local:neural-mesh --palette ember -o p.png` · observable: PNG exists, > 1 % non-background pixels (test-plan #E35)
- [ ] 6.22 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: `local:globe` referenced; `fx/globe.js` missing / present without card / present with card; plus deck.json copied to a dir without `fx/` · trigger: `validate` · observable: non-zero naming path + `fx/globe.js`; non-zero naming card; 0; copy → non-zero (test-plan #E23)
- [ ] 6.23 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module throwing in factory · trigger: open + goto slide · observable: title + bullets measurable, `effects().errors` = `[{slide, effectId:"local:x", phase:"create"}]`, other effects active (test-plan #X1)
- [ ] 6.24 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module throwing on 3rd tick; another throwing in dispose · trigger: `setTime` ×3, then navigate away · observable: `phase:"tick"` recorded once, object removed, `current()` responds; `phase:"dispose"` recorded, navigation completes (test-plan #X2)
- [ ] 6.25 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module calling `setTimeout` in factory · trigger: open · observable: `phase:"create"` error; a page-global counter stays 0 after 200 ms (test-plan #X3)
- [ ] 6.26 Test (see `render/__tests__/x13-props-cache-miss.test.ts`) — input: valid deck.json; delete `fx/x.js` after validate · trigger: `render` · observable: non-zero naming file, no HTML (test-plan #X13)
- [ ] 6.27 Test (see `fx/__tests__/e47-catalogue-sync.test.ts`, temp corpus copy) — input: local module that throws on construct · trigger: `fx promote x --source … --licence MIT` · observable: non-zero from the corpus test, files rolled back (test-plan #X14)
- [ ] 6.28 Test (see `fx/__tests__/e21-budget.test.ts`) — input: business fixture, all slides · trigger: one `check` run · observable: zero `warn budget` findings (test-plan #P3)

## 7. Check: request blocking, new findings, `--style`, build summary

- [ ] 7.1 In `src/check/index.ts` block every request whose scheme ∉ {file, data, blob, about} via `page.route`, record `{slide, host}` deduped + sorted as `local-fx-network` (error, excluded from byte-equality), read `effects().errors` as `local-fx-error {slide, effectId, phase}` (error, inside byte-equality, no message text), add `--style` rule `style-defaults` (warn) and clear the HUD `localStorage` key before measuring; verify `deck3d check` on a fixture with a throwing local effect exits non-zero with the finding line
- [ ] 7.2 Print `style: <n>/<N> slides styled` at the end of `build` in `src/cli.ts`; verify on the strategy-lab fixture the line appears with the correct count
- [ ] 7.3 Test (see `check/__tests__/e40-suggestions.test.ts`, chromium) — input: deck with a create-throwing local effect on `geo` · trigger: `check` · observable: report has `{rule:"local-fx-error", slide:"geo", effectId:"local:x", phase:"create", severity:"error", suggestion:'overrides.slides["geo"].effects'}`, no `message` key, exit non-zero (test-plan #X4)
- [ ] 7.4 Test (see `render/__tests__/f8-offline-open.test.ts`, chromium) — input: one module loading `https://example.com/t.png` via `ctx.THREE.TextureLoader`, another loading a `data:` texture · trigger: `check` · observable: exactly one `local-fx-network {slide, host:"example.com"}` error, none for `data:`, exit non-zero (test-plan #X5)
- [ ] 7.5 Test (see `check/__tests__/check.test.ts`, chromium) — input: deck with X4 module + a legibility warn · trigger: `check` ×2, strip `contrast` and `local-fx-network` · observable: remaining report JSON byte-identical incl. `local-fx-error` (test-plan #X6)
- [ ] 7.6 Test (see `check/__tests__/check-ignore.test.ts`, chromium) — input: 4 slides (bare; effects override; prop only; built-kind override only) · trigger: `check --style` vs `check` · observable: with flag exactly one `style-defaults` warn on the bare slide, exit 0; without flag none (test-plan #X7)
- [ ] 7.7 Test (see `src/__tests__/e44-one-shot-build.test.ts`, chromium) — input: 5-slide deck, 2 with effects overrides · trigger: `build` · observable: stdout ends with `style: 2/5 slides styled` (test-plan #X8)
- [ ] 7.8 Test (see `check/__tests__/e42-clean-deck.test.ts`, chromium) — input: pre-seeded `localStorage["deck3d:<hash>"] = {quality:"low"}` · trigger: `check` · observable: report equals fresh-profile report, key cleared afterwards (test-plan #X9)

## 8. Configurator (HUD)

- [ ] 8.1 Add the hidden `<aside id="deck3d-hud">` + gear button to `src/render/template.html` and implement `src/runtime/hud.ts` (toggle `C`/gear/`Escape`, counter, scopes, controls per spec incl. autoplay 1–600 int, `●` markers, live apply via `applyLook`/recompose, `localStorage["deck3d:"+derivedHash]`, focus suppression of nav + `C`, click-inside no-advance, Export with the two notices); verify a headless page toggles the panel with `C` and `__DECK` is unchanged after a palette switch
- [ ] 8.2 Record `render/__tests__/fixtures/strategy-lab-slide1.measure.json` from the pre-change runtime before 8.1 lands (F2 baseline); verify the file is committed and `measure()` on the current build deep-equals it
- [ ] 8.3 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: fresh deck · trigger: `C`, `Escape`, gear click, `C` · observable: panel hidden toggles false/true/false/true, counter `1 / 3` (test-plan #F1)
- [ ] 8.4 Test (see `render/__tests__/f1-measure-stable.test.ts`, chromium) — input: strategy-lab deck, panel never opened · trigger: `measure()` slide 1 + computed style · observable: panel `display: none`, `measure()` deep-equals the committed baseline fixture (test-plan #F2)
- [ ] 8.5 Test (see `render/__tests__/e20-quality-effects.test.ts`, chromium) — input: select palette `ember` in deck scope · trigger: change event · observable: within 2 frames scene bg = ember bg, `__DECK.defaults.palette` unchanged (test-plan #F3)
- [ ] 8.6 Test (see `src/__tests__/navigation.test.ts`, chromium) — input: `durationSec` input focused on slide 1 · trigger: type `2`, `Space`, `C`, `ArrowRight` · observable: current still 1, panel still open (test-plan #F4)
- [ ] 8.7 Test (see `src/__tests__/navigation.test.ts`, chromium) — input: panel open on slide 1 · trigger: click panel body, click gear · observable: current still 1 (test-plan #F5)
- [ ] 8.8 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: set quality low, reload; then re-parsed deck (new hash) · trigger: reload/open · observable: panel shows `low` and `effects().active` excludes bloom; re-parsed deck shows default `high` (test-plan #F6)
- [ ] 8.9 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: `overrides.slides.geo.camera.distance` and `overrides.deck.mode` set · trigger: open panel on `geo`, both scopes · observable: slide scope only `camera.distance` has `●`; deck scope only `mode` (test-plan #F7)
- [ ] 8.10 Test (see `src/__tests__/navigation.test.ts`, chromium) — input: panel closed · trigger: click at (400,300) · observable: current 2 (test-plan #F8)
- [ ] 8.11 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: autoplay field values `0`, `1`, `600`, `601`, `0.5`, `-1` · trigger: type · observable: 0 off; 1, 600 accepted; 601, 0.5, -1 rejected with state unchanged (test-plan #E40)
- [ ] 8.12 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: `geo` mode light + distance 11; `ai` uncheck 1 of 3 effects; deck untouched · trigger: Export · observable: file = `{slides:{geo:{mode:"light",camera:{distance:11}}, ai:{effects:[<2 remaining in order>]}}}`, no `deck` key (test-plan #E41)

## 9. Props: ambient search, prompt generate

- [ ] 9.1 Add `--role ambient` (tris ≤ 2 000 filter + template with an existing `anim` value) to `props search` and `--prompt` (T2I hop via `DECK3D_T2I_URL` with a built-in default, cached PNG, then the `--from-image` path) to `props generate` in `src/props/` + `src/cli.ts`; verify `props search satellite --role ambient` prints only ≤ 2 000-tri rows with templates
- [ ] 9.2 Test (see `props/__tests__/search.test.ts`) — input: mocked catalogue tris 1999, 2000, 2001 · trigger: `props search x --role ambient` · observable: 1999 + 2000 printed with the ambient template, 2001 absent, template validates once `sha256` is filled (test-plan #E39)
- [ ] 9.3 Test (see `props/__tests__/x8-generate-unavailable.test.ts` + `helpers/mock-http.ts`) — input: `DECK3D_T2I_URL` mock returning 500 · trigger: `props generate --prompt "ship" --name ship` · observable: non-zero naming endpoint, no `ship.glb`/`ship.png` (test-plan #X10)
- [ ] 9.4 Test (see `props/__tests__/e33-fetch-entry.test.ts`) — input: mock T2I returns PNG, mock image-to-3D returns GLB · trigger: same command · observable: `ship.png` + `ship.glb` cached, entry has `licence: generated`, `restyle: palette`, 64-hex `sha256`, `validate` accepts (test-plan #X11)
- [ ] 9.5 Test (see `props/__tests__/x8-generate-unavailable.test.ts`) — input: `PATH` without `python3` · trigger: same command · observable: non-zero with install hint, no files (test-plan #X12)

## 10. Skill, CLI help, docs

- [ ] 10.1 Update `.pi/skills/deck3d/SKILL.md`: tune loop with mandatory step 4 **Style** (corpus pick / `fx scaffold` / built kind / props incl. `--role ambient`), configurator Export → `overrides apply`, "markdown inline overrides win", local-effect sandbox facts (`Math.random`, timers, network unavailable), promotion path; update `reference/ir-fields.md` for the new keys; verify `npx vitest run src/__tests__/skill.test.ts` passes
- [ ] 10.2 Update `deck3d --help` text and `packages/deck3d/README.md` command table; verify `deck3d --help` names every new subcommand/flag
- [ ] 10.3 Update `packages/deck3d/src/**/AGENTS.md` rows for every touched file (`runtime/index.ts`, `runtime/hud.ts`, `runtime/builders.ts`, `runtime/palette.ts`, `fx/local.ts`, `fx/defaults.ts`, `fx/compose.ts`, new fx modules, `check/index.ts`, `parse/derive.ts`, `render/index.ts`, `render/template.html`, `props/*`, `cli.ts`); verify `kb dox lint` reports no missing rows for `packages/deck3d`
- [ ] 10.4 Test (see `src/__tests__/cli.test.ts`) — input: — · trigger: `deck3d --help` · observable: output contains `fx scaffold`, `fx hash`, `fx promote`, `overrides apply`, `check --style`, `--role`, `--prompt` (test-plan #E43)
- [ ] 10.5 Test (see `src/__tests__/skill.test.ts`) — input: `SKILL.md` · trigger: read · observable: numbered loop has a step titled `Style`, mentions `check --style`, `fx scaffold`, `props search --role ambient`, `overrides apply`, "markdown inline overrides win", `Math.random` (test-plan #E44)

## 11. Second fixture: restyle the business deck

- [ ] 11.1 Run the Style pass on `presentations/business-next-5-years/deck.md`: topic effects or local `fx/` per slide (≥ 8 local effects covering geo, trust, compute, money, agents, work, timeline, sales), built kinds on every content slide without mermaid, hero/illustration/ambient props per section, palette choice; verify `deck3d build` prints `check: clean` and `style: 23/23 slides styled`
- [ ] 11.2 Copy the deck (+ `fx/`, cached props) to `packages/deck3d/fixtures/business-2031/` and wire it into the fixture tests; verify `deck3d build fixtures/business-2031/deck.md` succeeds in CI
- [ ] 11.3 Test (see `render/__tests__/p1-build-budget.test.ts` + `p2-build-size.test.ts`, chromium) — input: `fixtures/business-2031/deck.md` · trigger: `build` · observable: post-launch ≤ 60 s and html ≤ 6 291 456 bytes (test-plan #E42, #P1)
- [ ] 11.4 Rebuild `presentations/business-next-5-years/deck.html` and refresh `speaker-notes.md` slide list if ids changed; verify the deck opens offline and steps with arrow keys

## 12. Manual verification (post-merge)

- [ ] 12.1 View snapshots of the six new built diagrams on the business fixture and judge proportions/readability (test-plan: manual-only, #F9)
- [ ] 12.2 View `fx preview` of the eight topic-world backgrounds and judge that each reads as its topic (test-plan: manual-only, #F10)
- [ ] 12.3 View the six new palettes on the fixture in both modes and judge aesthetics (test-plan: manual-only, #F11)
- [ ] 12.4 Drive the configurator on a live deck and judge discoverability and that it stays out of the way (test-plan: manual-only, #F12)
