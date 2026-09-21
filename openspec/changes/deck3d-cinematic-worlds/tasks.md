## 1. Land the navigation fix already on the tree

- [x] 1.1 Commit `packages/deck3d/src/runtime/index.ts` `navTo` + listeners and `src/runtime/AGENTS.md` row as the first step of this change; verify `npx vitest run src/__tests__/navigation.test.ts` passes in `packages/deck3d`
- [x] 1.2 Extend `src/__tests__/navigation.test.ts` (existing exemplar) with the key matrix — input: 3-slide deck · trigger: `ArrowRight`×2, `ArrowLeft`, `Space`, `End`, `Home`, `PageDown`, `ArrowUp` · observable: `current()` reads 2,3,2,3,3,1,2,1 and `location.hash` tracks each (test-plan #E26)
- [x] 1.3 Extend `src/__tests__/navigation.test.ts` — input: slide 1 `ArrowLeft`; last slide `ArrowRight` and click; `Meta+ArrowRight` on slide 1 · trigger: keys/click · observable: current stays 1, 3, 3, 1 (test-plan #E27)
- [x] 1.4 Extend `src/__tests__/navigation.test.ts` — input: on slide 1 set `location.hash` to `#3`, `#0`, `#99` · trigger: hashchange · observable: current 3, 1, 1 (test-plan #E28)

## 2. IR schema and merge grammar

- [x] 2.1 Extend `src/ir/schema.json` + `src/ir/types.ts`: `overrides.slides[].diagram.kind` (built kinds only), `diagram.data {labels?, values? ≥ 0}`, `defaults.autoStyle`, palette enum ×9, `local:` effect refs with `sha256`, `effects[]` item union; verify `npx vitest run src/ir` passes and `openspec validate deck3d-cinematic-worlds --strict` still passes
- [x] 2.2 Make `diagram.data` an atomic-replace key in `src/ir/merge.ts`; verify existing `ir/__tests__/merge.test.ts` still passes
- [x] 2.3 Add `deck3d overrides apply <deck.json> <file>` to `src/cli.ts` (deep-merge under D1 grammar, arrays + `data` replace, re-validate, non-zero on error with JSON path); verify `deck3d overrides apply` on a fixture prints the merged `overrides` and exits 0
- [x] 2.4 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: `overrides.slides[x].diagram.kind` across the 10 built values + `flowchart`, `sequence`, `pie` · trigger: `validate` · observable: first ten exit 0, last three non-zero naming path + enum (test-plan #E16)
- [x] 2.5 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: `data.values` `[0]`, `[0.0001]`, `[-0.0001]`, `[3,-1]`, `["3"]` · trigger: `validate` · observable: first two 0, others non-zero naming `…values[i]` + `minimum 0`/type (test-plan #E17)
- [x] 2.6 Test (see `ir/__tests__/schema.test.ts`) — input: `overrides.deck.palette` ∈ 10 valid values + `sunset` · trigger: `validate` · observable: ten exit 0, `sunset` non-zero + enum (test-plan #E18)
- [x] 2.7 Test (see `ir/__tests__/merge.test.ts`) — input: derived `data {labels:[a,b], values:[1,2]}` and override `data {labels:[x,y]}` · trigger: merged view · observable: `diagram.data` deep-equals `{labels:[x,y]}` with no `values` (test-plan #E19)
- [x] 2.8 Test (see `ir/__tests__/e9-merge-grammar.test.ts`) — input: four `overrides apply` cases (scalar merge into existing slide; effects array replace; `data` replace; invalid `depthRelief:"x"`) · trigger: CLI · observable: `{mode:light,camera:{distance:11}}`; `[aurora]`; `{labels:[x]}`; non-zero + JSON path with deck.json unchanged (test-plan #E22)
- [x] 2.9 Test (see `ir/__tests__/x11-bad-json.test.ts`) — input: non-JSON file; file with unknown key `slides.geo.foo` · trigger: `overrides apply` · observable: both non-zero (parse error / path `overrides.slides.geo.foo`), deck.json byte-unchanged (test-plan #X15)

## 3. Palettes

- [x] 3.1 Add `midnight`, `ember`, `arctic`, `forest`, `mono`, `neon` to `src/runtime/palette.ts` `PALETTES` with dark + light sets; verify `fx preview aurora --palette ember` renders a non-black PNG
- [x] 3.2 Test (see `fx/__tests__/corpus.test.ts`) — input: all 9 named palettes × {dark, light} · trigger: computed WCAG contrast text/bg · observable: every pair ≥ 4.5:1 (test-plan #E45)

## 4. Built diagrams reachable

- [x] 4.1 Implement the ordered built-kind table + `data` harvest in `src/parse/derive.ts` (D2 order; years never values; `autoStyle:false` → none; title/section/credits excluded; supported mermaid wins with inert-override warning; unsupported fence treated as diagram-less); verify `deck3d parse` on a fixture with a "- 2026 / - 2027" slide yields `timeline-rail`
- [x] 4.2 Add `bars`, `funnel`, `timeline-rail`, `globe`, `orbit-cluster`, `stack` builders to `src/runtime/builders.ts` returning `{ g, tick, nodes, labels }` (zero value → plinth stub with label); verify `deck3d snapshot` of a 6-slide built-kind fixture shows all six
- [x] 4.3 Test (see `parse/__tests__/derive.test.ts`) — input: 11 content/section slides listed in the plan (years, percentages, "Deal pipeline review", "Our agents", "Feedback loop", "The LLM", "Global trade", "Partner ecosystem", "Compute layers", "Lunch menu", section "Timeline") · trigger: `parse` · observable: timeline-rail, bars, funnel, swarm, loop, brain, globe, orbit-cluster, stack, none, none (test-plan #E37)
- [x] 4.4 Test (see `parse/__tests__/derive.test.ts`) — input: bullets "- 88% adoption", "- 2026: MVP", "- 0 churn", "- plain" · trigger: `parse` · observable: labels `[adoption, 2026: MVP, churn, plain]`, `values` omitted because not all numeric (test-plan #E38)
- [x] 4.5 Test (see `ir/__tests__/e5-overrides-survive-reparse.test.ts`, chromium) — input: `diagram.kind: brain` override, markdown gains a `flowchart` · trigger: `parse` · observable: derived `flowchart`, override retained, warning names `overrides.slides["flow"].diagram.kind` + "ignored", exit 0 (test-plan #E20)
- [x] 4.6 Test (see `ir/__tests__/e5-overrides-survive-reparse.test.ts`, chromium) — input: ```pie fence + `diagram.kind: bars` override · trigger: `parse` · observable: derived `bars`, unsupported-type warning present, no "ignored" warning (test-plan #E21)
- [x] 4.7 Test (see `render/__tests__/f1-measure-stable.test.ts`, chromium) — input: `bars` with `[1,2,4]`; `[0,5]`; labels only · trigger: `measure()` · observable: 3 `node` kinds with height ratio 1:2:4 ±5 %; `[0,5]` first rect height > 0 with label; no values → equal heights ±2 % (test-plan #E24)
- [x] 4.8 Test (see `render/__tests__/f7-message-order.test.ts`, chromium) — input: 9 slides, one per built kind, 4 labels each · trigger: `measure()` per slide · observable: ≥ 4 labelled `node` entries each, none throws, `timeline-rail` labels alternate above/below rail centre (test-plan #E25)

## 5. Effects corpus: extended context, topics, topic-world backgrounds

- [x] 5.1 Extend `FxContext` in `src/fx/types.ts` with `rng` and `slide`; thread them from `src/runtime/index.ts`; verify `npx vitest run src/fx` passes unchanged
- [x] 5.2 Add optional `tags.topic[]` (closed 12-value enum) to `src/fx/meta.schema.json`; allow `source: "local"` at schema level while the corpus test rejects it for `src/fx` cards; verify `npx vitest run src/fx/__tests__/corpus.test.ts` passes
- [x] 5.3 Implement `globe-arcs`, `city-grid`, `neural-mesh`, `vault-glyphs`, `server-racks`, `market-tape`, `orbit-agents`, `paper-stack` in `src/fx/` with cards (topics, `density`/`speed` params, seeded rng, quality-scaled counts); retro-fit topics onto `hex-grid`, `grid-horizon`, `constellation`, `data-columns`, `glyph-rain`; regenerate `reference/effects.md`; verify `deck3d fx list --topic geo` prints `globe-arcs`
- [x] 5.4 Rewrite `defaultEffectsFor` in `src/fx/defaults.ts` per D3 (v1 prefix, topic step before `particles`, `autoStyle` opt-out); verify existing `fx/__tests__/e25-defaults.test.ts` + `defaults.test.ts` still pass
- [x] 5.5 Add `--topic` to `fx list` and `--palette` + `local:` support to `fx preview` in `src/cli.ts`; verify `deck3d fx list --topic finance` exits non-zero naming the vocabulary
- [x] 5.6 Test (see `fx/__tests__/corpus.test.ts`) — input: card fixtures with `tags.topic ["finance"]`, `["geo"]`, corpus card `source: "local"` · trigger: corpus test · observable: fails naming card + vocabulary; passes; fails (test-plan #E29)
- [x] 5.7 Test (see `fx/__tests__/e27-corpus-licence.test.ts`) — input: shipped cards · trigger: corpus test · observable: each of 12 topics has ≥ 1 `background` card (test-plan #E30)
- [x] 5.8 Test (see `fx/__tests__/corpus.test.ts`) — input: every corpus effect · trigger: construct with `{THREE,palette,mode,quality,rng,slide}` then dispose · observable: none throws (test-plan #E31)
- [x] 5.9 Test (see `fx/__tests__/defaults.test.ts`) — input: five slides (security+flowchart; title-ish "Data Platform 2030"; content "Regional trade shifts"; same with `autoStyle:false`; content "Weather") · trigger: `defaultEffectsFor` · observable: glyph-rain, data-columns, globe-arcs, particles, particles (test-plan #E32)
- [x] 5.10 Test (see `fx/__tests__/e25-defaults.test.ts`) — input: every slide of `fixtures/strategy-lab.md` · trigger: old vs new `defaultEffectsFor` · observable: identical for every slide not resolving to `particles` under v1 (test-plan #E33)
- [x] 5.11 Test (see `fx/__tests__/fx-cli.test.ts`) — input: `fx list --topic geo`; `--topic finance` · trigger: CLI · observable: first lists `globe-arcs` not `neural-mesh`; second non-zero naming vocabulary (test-plan #E34)
- [x] 5.12 Test (see `render/__tests__/p3-render-determinism.test.ts`, chromium) — input: `fx preview globe-arcs` ×2 · trigger: CLI · observable: PNG bytes identical (test-plan #E36)
- [x] 5.13 Test (see `render/__tests__/e20-quality-effects.test.ts`, chromium) — input: each topic background at `quality: low` vs `high` · trigger: read `object.userData.count` · observable: low ≤ 50 % of high (test-plan #P2)

## 6. Local effects

- [x] 6.1 Implement local-effect resolution in `src/fx/local.ts`: name grammar, file + card load, sha256, 64 KiB cap, kind ∈ {background, motion}, module-shape check (leading `export default function`, no other export), static lint (`import`/`require`/`eval`/`Function`, case-sensitive, string/comment-stripped); wire into `validate` (when deck dir known) and `render`; verify `deck3d validate` on a fixture with a bad hash exits non-zero naming path + file
- [x] 6.2 Embed `{ card, src }` per referenced local effect into `window.__DECK_LOCAL_FX` in `src/render/index.ts` as JSON with `<` → `\u003c`; verify rendered HTML contains the module source and no `<script src=`
- [x] 6.3 Runtime instantiation in `src/runtime/index.ts`: `new Function` wrapper with the shadowed-globals list + frozen `Math` (`random` = `ctx.rng`), try/catch around `create`/`tick`/`dispose`, `effects().errors` `{slide, effectId, phase}`, `console.error` for the message; verify a fixture module reading `typeof window` reports `"undefined"`
- [x] 6.4 Pass `localCards` into `composeEffects` in `src/fx/compose.ts` so `local:` ids take part in conflict/mode/budget gating; verify `e21-budget.test.ts` + `e22-conflict.test.ts` still pass
- [x] 6.5 Add `fx scaffold`, `fx hash`, `fx promote --source --licence` to `src/cli.ts`; verify `fx scaffold neural-mesh --for ai` then `validate` exits 0 with the printed entry pasted
- [x] 6.6 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: ids `local:a`, 64-char, 65-char, `local:9x`, `local:A1`, `local:a_b` · trigger: `validate` · observable: first two 0, last four non-zero naming id + grammar (test-plan #E1)
- [x] 6.7 Test (see `props/__tests__/e31-oversized.test.ts`) — input: `fx/big.js` 65 536 bytes then 65 537 · trigger: `validate` · observable: 0 then non-zero naming file + `64 KiB` (test-plan #E2)
- [x] 6.8 Test (see `props/__tests__/e30-hash-mismatch.test.ts`) — input: sha256 correct / one digit off / uppercase · trigger: `validate` then `render` · observable: 0; non-zero naming `…effects[0].sha256` + file with no HTML; uppercase treated as mismatch (test-plan #E3)
- [x] 6.9 Test (see `fx/__tests__/e24-card-params.test.ts`) — input: card `kind` across all 7 values · trigger: `validate` · observable: background, motion → 0; other five non-zero naming card + allowed kinds (test-plan #E4)
- [x] 6.10 Test (see `fx/__tests__/e24-card-params.test.ts`) — input: local card `density 0..1`; params `0`, `1`, `-0.01`, `1.01`, `"1"` · trigger: `validate` · observable: first two 0; others non-zero naming `…params.density` + range (test-plan #E5)
- [x] 6.11 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: 7 module variants (comment-first; statement-first; named export; `import(`; `new Function(`; inner `function`; `"require"` in string) · trigger: `validate` · observable: a, f, g pass; b "must start with export default"; c "single default export"; d names `import`; e names `Function` (test-plan #E6)
- [x] 6.12 Test (see `render/__tests__/p3-render-determinism.test.ts`, chromium) — input: deck with 2 local + 1 corpus effect · trigger: `render` ×2 · observable: byte-identical HTML, both sources embedded as JSON strings, zero `<script src=` (test-plan #E7)
- [x] 6.13 Test (see `render/__tests__/e35-json-safe.test.ts`, chromium) — input: module containing literal `"</script><script>window.pwned=1</script>"` · trigger: render + open headless · observable: `window.pwned` undefined, `__deck3d` defined, effect object present (test-plan #E8)
- [x] 6.14 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module reporting `typeof` of all 29 shadowed identifiers into `userData` · trigger: open + `gotoSlide` · observable: every entry `"undefined"`, `typeof Math.random` `"function"` (test-plan #E9)
- [x] 6.15 Test (see `render/__tests__/f1-measure-stable.test.ts`, chromium) — input: module scattering 200 points via `Math.random()` · trigger: open twice, read a labelled child's rect · observable: identical across loads (test-plan #E10)
- [x] 6.16 Test (see `fx/__tests__/e21-budget.test.ts`) — input: `quality: low`, corpus cost 5 + local cost 1, then local cost 2 · trigger: `render` · observable: 6 no warning; 7 warning `7 > 6` and `check` `warn budget` (test-plan #E11)
- [x] 6.17 Test (see `fx/__tests__/e22-conflict.test.ts`) — input: local card `conflicts ["aurora"]`; effect lists [aurora, local:x] / [local:x] / [starfield, local:x] · trigger: `render` · observable: first non-zero naming `local:x`, `aurora`, slide; other two 0 (test-plan #E12)
- [x] 6.18 Test (see `fx/__tests__/fx-cli.test.ts`) — input: empty deck dir; `fx scaffold neural-mesh --for ai` twice · trigger: CLI · observable: first creates both files with sha256 matching the file and a paste-able entry that validates; second exits non-zero "exists" with files unchanged (test-plan #E13)
- [x] 6.19 Test (see `fx/__tests__/fx-cli.test.ts`) — input: scaffolded module, then append a comment · trigger: `fx hash` before/after · observable: two different 64-hex values, second equals recomputed sha256 (test-plan #E14)
- [x] 6.20 Test (see `fx/__tests__/e47-catalogue-sync.test.ts`, temp corpus copy) — input: `fx promote` with no flags / `--source` only / `--licence` only / non-permissive licence / both valid · trigger: CLI · observable: first four non-zero naming the gap, nothing moved; last moves the pair into the corpus copy with given source+licence, removes `fx/*`, regenerates catalogue (test-plan #E15)
- [x] 6.21 Test (see `fx/__tests__/fx-cli.test.ts`, chromium) — input: deck dir with scaffolded `fx/neural-mesh.*` · trigger: `fx preview local:neural-mesh --palette ember -o p.png` · observable: PNG exists, > 1 % non-background pixels (test-plan #E35)
- [x] 6.22 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: `local:globe` referenced; `fx/globe.js` missing / present without card / present with card; plus deck.json copied to a dir without `fx/` · trigger: `validate` · observable: non-zero naming path + `fx/globe.js`; non-zero naming card; 0; copy → non-zero (test-plan #E23)
- [x] 6.23 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module throwing in factory · trigger: open + goto slide · observable: title + bullets measurable, `effects().errors` = `[{slide, effectId:"local:x", phase:"create"}]`, other effects active (test-plan #X1)
- [x] 6.24 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module throwing on 3rd tick; another throwing in dispose · trigger: `setTime` ×3, then navigate away · observable: `phase:"tick"` recorded once, object removed, `current()` responds; `phase:"dispose"` recorded, navigation completes (test-plan #X2)
- [x] 6.25 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: module calling `setTimeout` in factory · trigger: open · observable: `phase:"create"` error; a page-global counter stays 0 after 200 ms (test-plan #X3)
- [x] 6.26 Test (see `render/__tests__/x13-props-cache-miss.test.ts`) — input: valid deck.json; delete `fx/x.js` after validate · trigger: `render` · observable: non-zero naming file, no HTML (test-plan #X13)
- [x] 6.27 Test (see `fx/__tests__/e47-catalogue-sync.test.ts`, temp corpus copy) — input: local module that throws on construct · trigger: `fx promote x --source … --licence MIT` · observable: non-zero from the corpus test, files rolled back (test-plan #X14)
- [x] 6.28 Test (see `fx/__tests__/e21-budget.test.ts`) — input: business fixture, all slides · trigger: one `check` run · observable: zero `warn budget` findings (test-plan #P3)

## 7. Check: request blocking, new findings, `--style`, build summary

- [x] 7.1 In `src/check/index.ts` block every request whose scheme ∉ {file, data, blob, about} via `page.route`, record `{slide, host}` deduped + sorted as `local-fx-network` (error, excluded from byte-equality), read `effects().errors` as `local-fx-error {slide, effectId, phase}` (error, inside byte-equality, no message text), add `--style` rule `style-defaults` (warn) and clear the HUD `localStorage` key before measuring; verify `deck3d check` on a fixture with a throwing local effect exits non-zero with the finding line
- [x] 7.2 Print `style: <n>/<N> slides styled` at the end of `build` in `src/cli.ts`; verify on the strategy-lab fixture the line appears with the correct count
- [x] 7.3 Test (see `check/__tests__/e40-suggestions.test.ts`, chromium) — input: deck with a create-throwing local effect on `geo` · trigger: `check` · observable: report has `{rule:"local-fx-error", slide:"geo", effectId:"local:x", phase:"create", severity:"error", suggestion:'overrides.slides["geo"].effects'}`, no `message` key, exit non-zero (test-plan #X4)
- [x] 7.4 Test (see `render/__tests__/f8-offline-open.test.ts`, chromium) — input: one module loading `https://example.com/t.png` via `ctx.THREE.TextureLoader`, another loading a `data:` texture · trigger: `check` · observable: exactly one `local-fx-network {slide, host:"example.com"}` error, none for `data:`, exit non-zero (test-plan #X5)
- [x] 7.5 Test (see `check/__tests__/check.test.ts`, chromium) — input: deck with X4 module + a legibility warn · trigger: `check` ×2, strip `contrast` and `local-fx-network` · observable: remaining report JSON byte-identical incl. `local-fx-error` (test-plan #X6)
- [x] 7.6 Test (see `check/__tests__/check-ignore.test.ts`, chromium) — input: 4 slides (bare; effects override; prop only; built-kind override only) · trigger: `check --style` vs `check` · observable: with flag exactly one `style-defaults` warn on the bare slide, exit 0; without flag none (test-plan #X7)
- [x] 7.7 Test (see `src/__tests__/e44-one-shot-build.test.ts`, chromium) — input: 5-slide deck, 2 with effects overrides · trigger: `build` · observable: stdout ends with `style: 2/5 slides styled` (test-plan #X8)
- [x] 7.8 Test (see `check/__tests__/e42-clean-deck.test.ts`, chromium) — input: pre-seeded `localStorage["deck3d:<hash>"] = {quality:"low"}` · trigger: `check` · observable: report equals fresh-profile report, key cleared afterwards (test-plan #X9)

## 8. Configurator (HUD)

- [x] 8.1 Add the hidden `<aside id="deck3d-hud">` + gear button to `src/render/template.html` and implement `src/runtime/hud.ts` (toggle `C`/gear/`Escape`, counter, scopes, controls per spec incl. autoplay 1–600 int, `●` markers, live apply via `applyLook`/recompose, `localStorage["deck3d:"+derivedHash]`, focus suppression of nav + `C`, click-inside no-advance, Export with the two notices); verify a headless page toggles the panel with `C` and `__DECK` is unchanged after a palette switch
- [x] 8.2 Record `render/__tests__/fixtures/strategy-lab-slide1.measure.json` from the pre-change runtime before 8.1 lands (F2 baseline); verify the file is committed and `measure()` on the current build deep-equals it
- [x] 8.3 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: fresh deck · trigger: `C`, `Escape`, gear click, `C` · observable: panel hidden toggles false/true/false/true, counter `1 / 3` (test-plan #F1)
- [x] 8.4 Test (see `render/__tests__/f1-measure-stable.test.ts`, chromium) — input: strategy-lab deck, panel never opened · trigger: `measure()` slide 1 + computed style · observable: panel `display: none`, `measure()` deep-equals the committed baseline fixture (test-plan #F2)
- [x] 8.5 Test (see `render/__tests__/e20-quality-effects.test.ts`, chromium) — input: select palette `ember` in deck scope · trigger: change event · observable: within 2 frames scene bg = ember bg, `__DECK.defaults.palette` unchanged (test-plan #F3)
- [x] 8.6 Test (see `src/__tests__/navigation.test.ts`, chromium) — input: `durationSec` input focused on slide 1 · trigger: type `2`, `Space`, `C`, `ArrowRight` · observable: current still 1, panel still open (test-plan #F4)
- [x] 8.7 Test (see `src/__tests__/navigation.test.ts`, chromium) — input: panel open on slide 1 · trigger: click panel body, click gear · observable: current still 1 (test-plan #F5)
- [x] 8.8 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: set quality low, reload; then re-parsed deck (new hash) · trigger: reload/open · observable: panel shows `low` and `effects().active` excludes bloom; re-parsed deck shows default `high` (test-plan #F6)
- [x] 8.9 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: `overrides.slides.geo.camera.distance` and `overrides.deck.mode` set · trigger: open panel on `geo`, both scopes · observable: slide scope only `camera.distance` has `●`; deck scope only `mode` (test-plan #F7)
- [x] 8.10 Test (see `src/__tests__/navigation.test.ts`, chromium) — input: panel closed · trigger: click at (400,300) · observable: current 2 (test-plan #F8)
- [x] 8.11 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: autoplay field values `0`, `1`, `600`, `601`, `0.5`, `-1` · trigger: type · observable: 0 off; 1, 600 accepted; 601, 0.5, -1 rejected with state unchanged (test-plan #E40)
- [x] 8.12 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: `geo` mode light + distance 11; `ai` uncheck 1 of 3 effects; deck untouched · trigger: Export · observable: file = `{slides:{geo:{mode:"light",camera:{distance:11}}, ai:{effects:[<2 remaining in order>]}}}`, no `deck` key (test-plan #E41)

## 9. Props: ambient search, prompt generate

- [x] 9.1 Add `--role ambient` (tris ≤ 2 000 filter + template with an existing `anim` value) to `props search` and `--prompt` (T2I hop via `DECK3D_T2I_URL` with a built-in default, cached PNG, then the `--from-image` path) to `props generate` in `src/props/` + `src/cli.ts`; verify `props search satellite --role ambient` prints only ≤ 2 000-tri rows with templates
- [x] 9.2 Test (see `props/__tests__/search.test.ts`) — input: mocked catalogue tris 1999, 2000, 2001 · trigger: `props search x --role ambient` · observable: 1999 + 2000 printed with the ambient template, 2001 absent, template validates once `sha256` is filled (test-plan #E39)
- [x] 9.3 Test (see `props/__tests__/x8-generate-unavailable.test.ts` + `helpers/mock-http.ts`) — input: `DECK3D_T2I_URL` mock returning 500 · trigger: `props generate --prompt "ship" --name ship` · observable: non-zero naming endpoint, no `ship.glb`/`ship.png` (test-plan #X10)
- [x] 9.4 Test (see `props/__tests__/e33-fetch-entry.test.ts`) — input: mock T2I returns PNG, mock image-to-3D returns GLB · trigger: same command · observable: `ship.png` + `ship.glb` cached, entry has `licence: generated`, `restyle: palette`, 64-hex `sha256`, `validate` accepts (test-plan #X11)
- [x] 9.5 Test (see `props/__tests__/x8-generate-unavailable.test.ts`) — input: `PATH` without `python3` · trigger: same command · observable: non-zero with install hint, no files (test-plan #X12)

## 10. Skill, CLI help, docs

- [x] 10.1 Update `.pi/skills/deck3d/SKILL.md`: tune loop with mandatory step 4 **Style** (corpus pick / `fx scaffold` / built kind / props incl. `--role ambient`), configurator Export → `overrides apply`, "markdown inline overrides win", local-effect sandbox facts (`Math.random`, timers, network unavailable), promotion path; update `reference/ir-fields.md` for the new keys; verify `npx vitest run src/__tests__/skill.test.ts` passes
- [x] 10.2 Update `deck3d --help` text and `packages/deck3d/README.md` command table; verify `deck3d --help` names every new subcommand/flag
- [x] 10.3 Update `packages/deck3d/src/**/AGENTS.md` rows for every touched file (`runtime/index.ts`, `runtime/hud.ts`, `runtime/builders.ts`, `runtime/palette.ts`, `fx/local.ts`, `fx/defaults.ts`, `fx/compose.ts`, new fx modules, `check/index.ts`, `parse/derive.ts`, `render/index.ts`, `render/template.html`, `props/*`, `cli.ts`); verify `kb dox lint` reports no missing rows for `packages/deck3d`
- [x] 10.4 Test (see `src/__tests__/cli.test.ts`) — input: — · trigger: `deck3d --help` · observable: output contains `fx scaffold`, `fx hash`, `fx promote`, `overrides apply`, `check --style`, `--role`, `--prompt` (test-plan #E43)
- [x] 10.5 Test (see `src/__tests__/skill.test.ts`) — input: `SKILL.md` · trigger: read · observable: numbered loop has a step titled `Style`, mentions `check --style`, `fx scaffold`, `props search --role ambient`, `overrides apply`, "markdown inline overrides win", `Math.random` (test-plan #E44)

## 11. Second fixture: restyle the business deck

- [x] 11.1 Run the Style pass on `presentations/business-next-5-years/deck.md`: topic effects or local `fx/` per slide (≥ 8 local effects covering geo, trust, compute, money, agents, work, timeline, sales), built kinds on every content slide without mermaid, hero/illustration/ambient props per section, palette choice; verify `deck3d build` prints `check: clean` and `style: 23/23 slides styled`
- [x] 11.2 Copy the deck (+ `fx/`, cached props) to `packages/deck3d/fixtures/business-2031/` and wire it into the fixture tests; verify `deck3d build fixtures/business-2031/deck.md` succeeds in CI
- [x] 11.3 Test (see `render/__tests__/p1-build-budget.test.ts` + `p2-build-size.test.ts`, chromium) — input: `fixtures/business-2031/deck.md` · trigger: `build` · observable: post-launch ≤ 60 s and html ≤ 6 291 456 bytes (test-plan #E42, #P1)
- [x] 11.4 Rebuild `presentations/business-next-5-years/deck.html` and refresh `speaker-notes.md` slide list if ids changed; verify the deck opens offline and steps with arrow keys

## 12. Manual verification (post-merge)

- [ ] 12.1 View snapshots of the six new built diagrams on the business fixture and judge proportions/readability (test-plan: manual-only, #F9)
- [ ] 12.2 View `fx preview` of the eight topic-world backgrounds and judge that each reads as its topic (test-plan: manual-only, #F10)
- [ ] 12.3 View the six new palettes on the fixture in both modes and judge aesthetics (test-plan: manual-only, #F11)
- [ ] 12.4 Drive the configurator on a live deck and judge discoverability and that it stays out of the way (test-plan: manual-only, #F12)

## 13. Slide placement knobs + collapsible configurator blocks

- [x] 13.1 Add `defaults.layout` (`split` | `split-reverse`, default `split`), `defaults.rail` (`line` | `orbit` | `tunnel` | `helix` | `grid`, default `line`, deck-level only), `defaults.spacing` (number `> 0`, default `40`, deck-level only) and `cardOffset` (`{x?, y?}`) to `src/ir/schema.json` (deck defaults, slide, `overrides.deck`, `overrides.slides[<id>]`) and mirror them in `src/ir/types.ts`; verify `openspec validate --strict` and `npx vitest run src/ir` pass
- [x] 13.2 Test (see `ir/__tests__/e11-schema-validation.test.ts`) — input: `overrides.deck.spacing: 60`, `overrides.slides["x"].spacing: 60`, `overrides.slides["x"].layout: "split-reverse"`, `cardOffset: {x: -0.5}` · trigger: `validate` · observable: deck `spacing` + slide `layout`/`cardOffset` accepted, slide `spacing` rejected naming the path (test-plan #E47)
- [x] 13.3 Thread `spacing` through `anchorFor(i, distance, spacing)` in `src/runtime/camera.ts` and derive the cull radius from it (`CULL_RADIUS` is hardcoded `52` ≈ `40 × 1.3`, so a wider spacing would cull the current slide); verify `npx vitest run src/render/__tests__/f1-measure-stable.test.ts` still passes
- [x] 13.4 Implement the layout presets in `src/runtime/index.ts` (`addTitle`, `addBody`, `addDiagram` read a `LAYOUTS` table instead of literal x/y) and apply `cardOffset` after the preset; verify `deck3d check fixtures/business-2031/deck.html` is clean under each preset
- [x] 13.5 Test (see `render/__tests__/f1-measure-stable.test.ts`, chromium) — input: business fixture slide with a diagram · trigger: `measure()` under `layout: split` vs `split-reverse` vs `stacked` · observable: card and diagram screen rects swap sides, both check-clean at 1920×1080 (test-plan #E48). A third `stacked` preset was prototyped and dropped — floor `y=-2.6` to frame top `~4.0` is 6.6 world units and title+disc+card need 7.7, so it needs a lower-third card variant first
- [x] 13.6 Extend `SlidePatch` with a slide-level lane (`layout`, `cardOffset`, `scene`, `diagram.kind|scale|offset`) and have `applySlide` rebuild from a shallow-merged slide without mutating `window.__DECK`; verify `debug.look()`/`measure()` reflect the patch and the embedded IR does not
- [x] 13.7 Test (see `render/__tests__/e20-quality-effects.test.ts`, chromium) — input: rendered business fixture · trigger: stage `layout: split-reverse` + `cardOffset.x: -0.5` + `diagram.scale: 1.3` via the panel · observable: `measure()` rects move accordingly and `window.__DECK` is byte-unchanged (test-plan #F13)
- [x] 13.8 Rewrite `createHud`'s `render()` around collapsible blocks (Look, Lighting & FX, Camera & labels, Layout, Motion, Quality, Effects), omit a block with no control in the active scope, persist per-block open state in `HudState.open`; add the block CSS to `src/render/template.html`
- [x] 13.12 Implement `defaults.rail` in `src/runtime/camera.ts` (`anchorFor(i, distance, spacing, rail, count)` + per-anchor `rotY`, `cullRadius(spacing, rail)`) and re-anchor the whole deck from the configurator without mutating `window.__DECK`; verify `deck3d check` is clean on the business fixture for all five rails
- [x] 13.13 Test (see `runtime/__tests__/e49-rail-geometry.test.ts`) — input: 12-slide rail · trigger: `anchorFor` per rail · observable: no two slides closer than half a spacing, camera always `distance` in front of its slide, orbit/helix turn each slide to face its camera, tunnel culls below one spacing (test-plan #E49); plus #E50 — `projectRect` is rotation-invariant
- [x] 13.14 Fix `projectRect` to take the box in the object's OWN frame (extracted to `src/runtime/measure.ts`): the world-axis-aligned `Box3` inflated up to 1.5x on a turned slide and raised false `fit` findings on `orbit`/`helix`
- [x] 13.9 Test (see `render/__tests__/runtime.test.ts`, chromium) — input: rendered deck · trigger: open Layout, close Look, change slide, reload · observable: Layout open + Look closed, `localStorage["deck3d:<hash>"].open` holds the states; deck scope shows `spacing` and no `diagram.*`, slide scope the reverse (test-plan #F14)
- [ ] 13.10 Test (see `check/__tests__/e42-clean-deck.test.ts`) — input: deck with panel state including open blocks · trigger: `check` · observable: report equals the fresh-profile report, no finding names a panel element (existing #X9 extended to `open`)
- [ ] 13.11 Docs closeout: `SKILL.md` Style step mentions `layout`/`spacing`/`cardOffset`, regenerate `reference/ir-fields.md`, update `README.md` and the `AGENTS.md` rows for `runtime/hud.ts`, `runtime/index.ts`, `runtime/camera.ts`, `ir/schema.json`, `ir/types.ts`, `render/template.html`; verify `kb dox lint` clean and `npx vitest run src/__tests__` passes

## 14. Backdrop isolation + live clock (reported: "Force 4" slicing, "nothing is animated")

- [x] 14.1 Fix the deck clock: `boot()` primed the first frame with `applyTime(0)`, which also set `frozen`, so every deck shipped pinned at t=0 — the render loop ran and slide transitions still moved the camera, but nothing in the scene ever moved. Split `poseAt(t)` (pose + draw) from `applyTime(t)` (pose + pin); boot calls `poseAt(0)`, `setTime` still pins for `check`
- [x] 14.2 Test (see `render/__tests__/runtime.test.ts` #F15) — input: booted deck · trigger: 1.2 s of wall clock · observable: `debug.motion()` fingerprint changes; after `setTime(3)` it stops changing and re-reads identically for the same time (determinism preserved)
- [x] 14.3 Render backdrop and content as two depth-isolated passes (`BACKDROP_LAYER`, `markBackdrop`, `BackdropRenderPass`, `renderLayered` in `runtime/scene.ts`); backgrounds AND both local-effect kinds are backdrop, so no effect can cover slide text whatever its geometry. Lights join the backdrop layer or standard materials render black there; the second pass suppresses the background force-clear
- [x] 14.4 Add the `fx-content-layer` check rule + `debug.backdropLeaks()`: the two-pass render cannot catch geometry a module `add()`s AFTER creation (it lands on the content layer), so `check` samples leaks at every animation peak and reports them
- [x] 14.5 Test (see `check/__tests__/e40-suggestions.test.ts` #X16) — input: module attaching a plate at `z=6` during `tick` · observable: `error fx-content-layer slide geo local:leak`, exit non-zero; a well-behaved module stays silent
- [x] 14.6 Regenerate the affected deck snapshots and verify `check` clean on the business fixture and the 23-slide deck
- [x] 14.7 Fix the mirror ghosting the backdrop pass introduced: the content pass suppressed clearing with the `autoClearColor/Depth/Stencil` sub-flags, but `Reflector` clears its own render target only when `renderer.autoClear === false` — so the mirror target was never cleared and every past frame stayed in the reflection. Use `autoClear` + a null background instead
- [x] 14.8 Mark floor/veil/mirror backdrop: on the content layer the floor painted over every backdrop pixel below its horizon, clipping backgrounds along a hard horizontal line
- [x] 14.9 Billboard diagram labels (`billboardLabels()` + `debug.labelFacing()`): `globe`/`loop`/`swarm`/`orbit-cluster` rotate a group containing their captions, so a live clock turned them edge-on and then away. `check` is structurally blind to this — `measure()`'s projection is rotation-invariant so rails do not produce false fit findings
- [x] 14.10 Test (see `render/__tests__/runtime.test.ts` #F16) — input: `globe` topology · trigger: `setTime` at a quarter and a half turn · observable: every label's facing stays > 0.9 (0.07 = edge-on without the fix) and t=0 re-reads identically
- [x] 14.11 Diagram captions draw depth-free (`depthTest: false`, `renderOrder: 12`) so plinth and globe geometry cannot swallow them. NOT covered by a test: the occlusion could not be reproduced in any fixture deck (swept `swarm`/`orbit-cluster`/`globe` across time and camera distance; every zero-pixel label turned out to be off-screen, identical with and without the fix). Verified visually only
- [x] 14.12 Diagram plate reads as polished metal (metalness 0.95 / roughness 0.12 / envMapIntensity 1.6) so key and rim lights register as highlights
- [x] 14.13 `geo-fragments` plates stop shimmering: every instance sat at exactly z=0, so overlapping translucent hexagons z-fought. Stratified per-instance depth + `depthWrite: false`; module rehashed and repinned in both decks
- [x] 14.14 Deck-scope configurator values reach EVERY slide (`applyDeck`), not only the visible one — neighbours share the rail and stayed stale (#F18)
- [x] 14.15 Palette morphs across a transition instead of snapping at t=0 (`mixPalette`, driven from `stepAnim`) (#F19)
- [x] 14.16 `horizon-2031` markers ride their gate ring (phase per ring + steady sweep + tumble) instead of sitting pinned at x=4
- [x] 14.17 `local:` effects revive when a slide is revisited — leaving disposed them permanently, so they animated on the first visit only (#F20)
- [x] 14.18 Disposing a slide's `local:` effects detaches their nodes — `dispose()` frees GPU buffers but leaves the `Object3D` attached, so reviving stacked a second frozen copy (duplicated background) (#F20)
- [x] 14.19 Per-effect params are generated in the configurator from each effect's card, applied live and exported as `effects[].params` (#F21)
- [x] 14.20 Effect pass: `neural-mesh` nodes drift + metallic/emissive balls; `market-tape` thin bars, joined by a value trace, slower default scroll; `agent-depth` sine height field; `workforce-100` slow palette cycling; `geo-fragments` livelier drift/spin/breathe; `fab-wafer` sine die height
- [x] 14.21 A finished transition LANDS on its anchor — idle-drift smoothing no longer applies mid-fly, so the previous slide's backdrop stops lingering after the move completes (#F22)
- [x] 14.22 Built topologies draw each caption ONCE — `buildLoop` emitted an extruded `buildTitle` beside the measurable canvas label (#F23)
- [x] 14.23 Wrapping particles fade in/out (`capital-flows`, `proof-gate`, `globe-arcs` travellers) instead of blinking out at the wrap
- [x] 14.24 `agent-depth` shafts are base-anchored so the wave reads upright; `capital-flows` motes fill the cone via per-mote angle+radius
- [x] 14.25 Outgoing slide keeps its local fx for the whole fly — disposal deferred to transition landing, and the outgoing backdrop keeps ticking while still in frame (#F24)
- [x] 14.26 Configurator restores persisted state into the SCENE on reload, not only into the controls; `seedEffectParams` restores per-slide effect tuning across the rebuild (#F25)
- [x] 14.27 Export always surfaces the overrides JSON in-panel (copy button) because a blob download is silently dropped in a sandboxed iframe without `allow-downloads` (#F26)

## 15. Authoring server (`deck3d serve`)

- [x] 15.1 `serve <deck.md> [--port] [--check]` in `src/serve/index.ts` + CLI wiring; binds `127.0.0.1` ONLY (it exposes a write endpoint)
- [x] 15.2 Watch `deck.md`, `fx/`, `deck.json`; debounce a write burst into one rebuild; a failed rebuild keeps serving the last good deck and reports the error (#S1, #S2, #S3)
- [x] 15.3 Re-pin local `fx/` sha256 on rebuild so an edited module does not trip the render hash check (#S2)
- [x] 15.4 SSE `/__events` + reload client injected ONLY when served; `build` output stays byte-identical and offline (#S5)
- [x] 15.5 Reload returns to the slide on screen and keeps staged configurator values (#S4)
- [x] 15.6 `POST /__overrides` writes `overrides.json` beside the deck; path confined to the deck dir; IR-validated; target untouched on failure (#S6, #S8, #S9)
- [x] 15.7 `POST /__apply` merges into `deck.json` `overrides` under the `overrides apply` grammar (#S7)
- [x] 15.8 Configurator shows Save / Apply when served, falls back to the in-panel payload + download when not (#S6)
- [x] 15.9 `--check` runs check out of band per rebuild; findings for the current slide render in the panel; the reload never waits on it (#S10, #S11)
- [x] 15.10 Security pass on the write endpoints (loopback bind, path confinement, payload validation, no deck-dir escape) — `security-hardening`
- [x] 15.11 Docs: SKILL.md tune loop uses `serve`; README `serve` section; `src/serve/AGENTS.md`
- [x] 15.12 Fix: the spawned CLI exited 13 instead of serving — `serve/index.ts` imports `run` from `cli.ts`, so a top-level `await run(...)` in the entry deadlocked the cycle. Entry settles `run()` in a callback; guarded by a spawned-binary test (#S10)
- [x] 15.13 Fix: `deck.json` was never actually watched (only `deck.md` + `fx/`), so `overrides apply` and hand edits did not rebuild. Polled digest (150 ms) detects the foreign write and filters the rebuild's own rewrite — no self-trigger loop (#S12)


## 16. Promote the deck's local effects into the corpus

- [x] 16.1 Audit the eight local `fx/` modules for baked-in deck content: none render text; only `workforce-100` carried a claim (`0.59` cohort split)
- [x] 16.2 Lift the `0.59` into a declared `share` param (corpus default `0.5`); deck passes its own value via `effects[].params`
- [x] 16.3 Rename the two content-named modules: `horizon-2031` → `horizon-gates`, `workforce-100` → `cohort-grid`; scrub deck claims from `agent-depth` / `fab-wafer` headers
- [x] 16.4 `fx promote` all eight (`--source` repo URL, `--licence MIT`); add corpus typing (`FxFactory`/`FxContext`/`FxParams`) and register in `src/fx/index.ts`
- [x] 16.5 Rewire the deck's 11 effect refs from `{id:"local:<n>", sha256}` to corpus presets `{id:"<n>"}`; delete the now-empty `fx/`
- [x] 16.6 Accept the re-ranked topic defaults (cheapest-wins, ties by id): `geo`→`geo-fragments`, `agents`→`agent-depth`, `trust`→`trust-ledger`, `compute`→`fab-wafer`, `money`→`capital-flows`; update #E32
- [x] 16.7 Regenerate `reference/effects.md`; docs: `src/fx/AGENTS.md`, `presentations/AGENTS.md`

## 17. Post-processing pipeline (resurrects the 8 inert `post` cards; adds 6)

- [x] 17.0 Ground: only `bloom` is honoured (`index.ts:322`); `film`/`vignette`/`smaa`/`n8ao`/`depth-of-field`/`chromatic-aberration`/`selective-bloom`/`god-rays` are stubs the runtime never instantiates
- [x] 17.1 `src/runtime/post.ts`: pass registry keyed by card id; lazy pass creation; canonical order; per-slide enable/disable; `params` → uniforms; `passNames()` reflects enabled passes; `debug.post()` probe (#F27, #F28)
- [x] 17.2 Wire into `scene.ts` composer + `index.ts` slide apply (goTo landing, `applySlide`, `applyDeck`, HUD param edits via `applyEffectParams`)
- [x] 17.3 Implement passes: film, vignette, smaa, sao (rename `n8ao`→`sao`), depth-of-field (BokehPass), chromatic-aberration (RGBShift), god-rays (GodRays shaders, sun = rim light), pixelate (UV-quantise ShaderPass, NOT `RenderPixelatedPass` — that replaces the render pass), outline (OutlinePass on diagram parts), sobel (Luminosity+Sobel), dot-screen, selective-bloom (layer-mask two-render; `parts` param) (#F29, #F30)
- [x] 17.4 `ascii` as a post-composer DOM mode (`AsciiEffect` reads the final framebuffer); canvas hidden, `.deck3d-ascii` shown; `measure()` unaffected (#F31)
- [x] 17.5 Quality gating: baseline bloom stays quality-driven (unchanged look for existing decks); every other pass is opt-in per slide and honoured at any quality (replaces the `wantsBloom` boot hack)
- [x] 17.6 New cards; corpus gate; catalogue regen; determinism test per post card (#E51 — GPU tolerance 4 levels / 0.01 % of pixels: bloom's half-float blur is not bit-exact across runs, pre-existing)
- [x] 17.7 Configurator: post cards' params surface through the existing generated-params block (no new UI)
- [x] 17.8 Docs: `src/runtime/AGENTS.md`, `src/fx/AGENTS.md`, README post section, SKILL.md; note that `material`/`light`/`motion`/`edge`/`transition` corpus kinds remain config-driven, not `effects[]`-driven (out of scope here)

## 18. Stylistic backgrounds — three.js example ports (13 cards)

- [x] 18.1 `renderer.localClippingEnabled = true` in `scene.ts` (clip planes are per-material; harmless elsewhere)
- [x] 18.2 `clipped-solids` (clipping_advanced / _intersection / _stencil → one card, `mode` param; caps via stencil groups; composer target given `stencilBuffer: true`) (#E52)
- [x] 18.3 `extruded-shapes` (geometry_shapes + extrude_shapes; built-in parametric paths star/gear/rose/heart/superformula; `svgPath` = SVG `d` string via `SVGLoader`) (#E52, #E53)
- [x] 18.4 `scatter` (instancing_scatter; `MeshSurfaceSampler` on knot/sphere/plane) (#E52)
- [x] 18.5 `tessellate` (modifier_tessellation; `TessellateModifier` + displacement shader) (#E52)
- [x] 18.6 `curve-flow` (modifier_curve_instanced; `InstancedFlow` on seeded splines) (#E52)
- [x] 18.7 `sprites` (points_sprites; procedural sprite textures, layered fall) (#E52)
- [x] 18.8 `volume-cloud` + `volume-perlin` (Data3DTexture raymarch; steps scale with quality) (#E52)
- [x] 18.9 `billboards`, `points-on-geometry`, `shader-particles`, `dynamic-instances` (#E52)
- [x] 18.10 `constellation.nodeShape` (buffergeometry_drawrange — the existing card IS that example; nodes as point/sphere/cube) (#E52)
- [x] 18.11 No `tags.topic` on any new card; routing table unchanged (#E54)
- [x] 18.12 Catalogue regen; `src/fx/AGENTS.md`; README + SKILL list the stylistic set

## 19. Water floor (three `webgl_shaders_ocean`)

- [x] 19.1 IR: `defaults.floor` enum `mirror` | `water` (deck-scope, like `mirrorFloor`); schema, types, `ir-fields.md` regen (#E55)
- [x] 19.2 `scene.ts`: `Water` beside the `Reflector` in the floor group, created lazily on first use; procedural `DataTexture` normals (offline); `time` from the deck clock via `render(t)`; palette-tinted `waterColor`/`sunColor`; `applySurface` toggles by `cfg.floor` + `mirrorFloor` (#F32)
- [x] 19.3 `debug.look().floor` probe; configurator `floor` select in Lighting & FX (deck scope)
- [x] 19.4 Docs: README, SKILL, `src/runtime/AGENTS.md`, `src/ir/AGENTS.md`

## 20. The fixture presents the whole corpus

- [x] 20.1 Drop the six local `fx/` modules that duplicate cards promoted in Section 16; reference the corpus ids instead (`horizon-2031` → `horizon-gates`); keep ONE scaffolded module (`closing-mark`) so the local pipeline stays exercised
- [x] 20.2 Empty `overrides.effects` — deck scope prepends to every slide, so a card parked there is duplicated, not presented
- [x] 20.3 Grow `deck.md` 10 → 40 slides: 23 narrative slides lifted verbatim from `presentations/business-next-5-years`, 17 authored (qualitative copy, no invented statistics), generated by `build-deck.mjs`
- [x] 20.4 `build-overrides.mjs` generates `overrides.json` from a slide → cards `PLAN` and throws on a duplicate, an unplaced corpus card or an unknown id; curated short diagram labels (auto-derived labels carry raw bullet text and overlap past the IoU gate)
- [x] 20.5 Coverage test reading the BUILT IR, not the source overrides (#E56) — fails when a new card is added and not placed
- [x] 20.6 Raise the build budgets: per-slide (`MS_PER_SLIDE`) rather than flat, since `build` is dominated by its in-build `check` (~3.4 s/slide at two viewports) (#E42, #P1)
- [x] 20.7 Docs: `fixtures/business-2031/AGENTS.md`, `fixtures/AGENTS.md`

## 21. Extruded-title contour switch

- [x] 21.1 IR: `defaults.titleEdge` (`none` | `contrast`) + per-slide override; schema, types, `ir-fields.md` regen (#E57)
- [x] 21.2 `materials.ts`: `titleEdgeColour`/`titleEdgeMaterial` — unlit (side walls face sideways, where a lit material goes black), palette `text`, lightness pushed away from the face when it misses `EDGE_CONTRAST_FLOOR` (#E58)
- [x] 21.3 `text.ts`: `buildTitle` accepts `[face, edge]`; pins that `ExtrudeGeometry` emits a faces/sides group pair per glyph (#E58)
- [x] 21.4 `debug.look().titleEdge` probe; configurator select in Camera & labels at both scopes (#F33)
- [x] 21.5 Fixture `business-2031` turns it on — the switch exists because its titles read as a solid block
- [x] 21.6 Docs: README, SKILL, `src/runtime/AGENTS.md`, `src/ir/AGENTS.md`
- [x] 21.7 Contour held under `BLOOM_CEILING` (0.8 linear) and tone-mapped — post renders to a target, where three skips in-shader tone mapping, so a white contour halos (#E58)

## 22. Effects are added and removed, not only unticked

- [x] 22.1 Runtime: `fxSetEdits` (per-slide effect-id list) + `effectsOf(slide)` behind every read of `slide.effects`, so a configurator edit reaches the background, the `local:` modules, the post stack and the budget without touching `window.__DECK` (#F34)
- [x] 22.2 `applyEffects` rebuilds the current slide instead of flipping `background.visible` — a removed `post` card kept running until reload (#F34)
- [x] 22.3 Configurator: an **add** select over the whole corpus + the deck's `local:` cards, grouped by `kind`, minus what the slide already lists; rows render from the EFFECTIVE list (composed ∪ staged) (#F34)
- [x] 22.4 Docs: `src/runtime/AGENTS.md`, README, SKILL
