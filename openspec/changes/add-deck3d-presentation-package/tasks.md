## 1. Package scaffold

- [ ] 1.1 Create `packages/deck3d/` (package.json `@blackbelt-technology/pi-dashboard-deck3d`, `bin: deck3d`, `pi.skills`, tsconfig, vitest.config) modelled on `packages/video-production`; verify `pnpm install` links it and `pnpm -F @blackbelt-technology/pi-dashboard-deck3d test` runs an empty suite green.
- [ ] 1.2 Vendor `assets/Poppins-Bold.ttf` (OFL) + LICENSE note; add `three`, `opentype.js`, `mermaid@11` (exact), `ajv`, `esbuild` deps; verify `pnpm install` is clean and `pnpm-lock.yaml` has the exact mermaid pin.
- [ ] 1.3 Scaffold `packages/deck3d/AGENTS.md` (per-file rows) and add the package row to `packages/AGENTS.md`; verify `kb dox lint` reports no missing rows for the new directory.

## 2. IR schema + merge (spec: deck3d-ir)

- [ ] 2.1 Write `src/ir/schema.json` with `description` on every field (defaults, slides, diagram graph IR, overrides keyed by slide/node/edge id incl. `diagram.scale|offset`, `camera.distance`, `labels.size`, `check.ignore`) and `src/ir/validate.ts` (ajv, unknown-field rejection, dangling-id check); tests: valid fixture passes, `depthRelief:"high"` fails with JSON path, unknown key fails.
- [ ] 2.2 Write `src/ir/ids.ts` (slide slug+ordinal, node ids from mermaid, `m<i>` messages) and `src/ir/merge.ts` (derive → deep-merge overrides → warn on orphan override ids); tests: orphan override warns + exit 0, override on existing id applies.
- [ ] 2.3 Write `scripts/gen-ir-fields.ts` producing `.pi/skills/deck3d/reference/ir-fields.md` from schema descriptions; test: generated file lists every schema property; add to package `build`.
- [ ] 2.4 Implement derived-field-edit detection in `validate` (diff merged IR vs fresh derive from `meta.source` when the source is present); test: edited node `x` outside `overrides` → warning with path.

## 3. Markdown grammar (spec: deck3d-skill)

- [ ] 3.1 Write `src/parse/markdown.ts`: front-matter defaults, `# Title` slide split, subtitle paragraph, `-` bullets, ```mermaid block capture, `<!-- deck3d: {...} -->` inline overrides; tests: fixture deck parses to expected slides; invalid inline JSON exits non-zero naming the slide.

## 4. Mermaid harvest (spec: deck3d-mermaid-harvest)

- [ ] 4.1 Build `src/parse/harvest/harness.html` + esbuild bundle of mermaid@11; `src/parse/harvest/index.ts` launches Playwright chromium, runs `getDiagramFromText().db` + `render()`, matches node ids `<renderId>-flowchart-<id>-<n>` and edge paths `L_<from>_<to>`, samples paths, normalises coords; prints install hint and exits non-zero when chromium is missing (test).
- [ ] 4.2 Flowchart mapping: shapes `rect|stadium|round|hexagon|circle|doublecircle|diamond`, edge kinds `normal|dotted|thick` + labels, subgraph groups, direction; fixture test (`skipIf(!chromium)`) asserts node/edge/group counts, shapes, kinds, Hungarian labels byte-equal.
- [ ] 4.3 Sequence mapping: actors in order, messages with from/to/text/kind in source order; fixture test as above.
- [ ] 4.4 Unsupported diagram type → warning + `diagram: none` + exit 0 (test with `gantt`).
- [ ] 4.5 Determinism: parse the fixture deck twice in one test, assert byte-identical `deck.json`; assert no timestamp/path fields via schema `additionalProperties:false`.

## 5. Runtime port (spec: deck3d-render)

- [ ] 5.1 Port `src/runtime/text/` from the lab: opentype → ShapePath → ExtrudeGeometry for titles; canvas label with `P.bg` outline, `toneMapped:false`, `depthWrite:false`, front-of-surface offset (`h/2` for round shapes); unit test (jsdom/canvas mock) that label canvas width scales with text and outline colour = palette bg.
- [ ] 5.2 Port `materials/`, `scene/` (shared floor, fog, bloom thresholds per mode, shadow bias, lights), `camera/` (rail/dolly, hash deep-link, neighbour culling), `loop.ts` (rAF + `setTimeout` fallback on `document.hidden`); verify by building fixture deck and taking a headless screenshot after transition — camera arrived (distance < 0.5).
- [ ] 5.3 Port `builders/flowchart.ts` + `builders/sequence.ts` (grouped message = tube+head+label, travelling pulse, fixed 1.1 s period) + `builders/{brain,loop,swarm}.ts` + `backgrounds/` scene library; verify snapshot of slides 5 and 6 of the fixture visually matches the lab screenshots (`/tmp/s1.png`, `/tmp/s2.png` archived into `fixtures/reference/`).
- [ ] 5.4 Quality tiers: `low|medium|high` toggling bloom, reflector, shadow map size, particle count; test: `low` renders with no bloom pass and reflector absent (runtime unit test on scene graph).

## 6. Renderer (spec: deck3d-render)

- [ ] 6.1 `src/render/index.ts`: template + `dist/runtime.js` (esbuild, fixed options, no hashes) + sorted-key IR JSON + subset Poppins (glyph set from merged IR) as base64; test: render twice → byte-identical; output contains no `mermaid` reference and no `http(s)://` resource URLs.
- [ ] 6.2 Font subset: compute glyph set from all merged IR strings (titles, bullets, labels incl. overrides); test: override adding `ű` yields a subset containing that glyph.
- [ ] 6.3 Offline check test: serve `deck.html` with Playwright `route` blocking all network, assert no failed requests and slide 1 title mesh count > 0.

## 7. CLI + snapshot (spec: deck3d-skill)

- [ ] 7.1 `src/cli.ts`: `parse | validate | render | build | check | snapshot`, exit codes, one-line stderr reasons; tests: `build` emits `.json` beside `.html` equal to `parse` output; `--help` exits 0.
- [ ] 7.2 `snapshot <html> [--slide n] [-o png]`: Playwright headless, hash deep-link, wait for camera arrival; test (`skipIf(!chromium)`): PNG written, non-black centre pixel.

## 7c. Check (spec: deck3d-render — measurement hook + fit/legibility check)

- [ ] 7c.1 Runtime `window.__deck3d = { gotoSlide, setTime, ready, measure, peaks }`: deterministic clock replaces `performance.now` when set; `measure()` projects each labelled object's `Box3` corners to CSS px, reports label cap height (canvas plane height × projection), kind/id/text, raycast first hit; `peaks()` returns animation peak times per slide (pulse/lift). Test (jsdom-free, headless `skipIf(!chromium)`): two `measure()` calls at same slide/time deep-equal.
- [ ] 7c.2 `src/check/rules.ts` pure functions over measurements: fit (safe margin 4 %), legibility (14 px @1080 scaled), overlap (IoU > 0.1), occlusion (hit ≠ self/own node), contrast (≥ 3:1 from sampled pixels); each returns `{severity, slide, id, text, measured, threshold, suggest}`; unit tests per rule with hand-built measurement fixtures, incl. suggestion keys.
- [ ] 7c.3 `check <html> [--viewport ...] [--slide n] [--strict] [-o report.json]`: Playwright at dpr 1 per viewport, per slide at `t=0` + each peak, `readPixels`-style sampling via `canvas.toDataURL` crop for contrast; JSON report grouped by viewport; one stderr line per finding; exit codes per spec. Tests (`skipIf(!chromium)`): fixture deck with a deliberately oversized flowchart → fit error + `slides[n].diagram.scale` suggestion, non-zero exit; clean fixture → zero findings, exit 0; `--strict` promotes a legibility warn to failure.
- [ ] 7c.4 `build` runs `check` after render, prints findings, exits 0 unless `--strict`; tests: build with findings exits 0 and writes html; `--strict` exits non-zero.
- [ ] 7c.5 `snapshot` reuses `__deck3d.ready()` instead of a fixed wait (from 7.2); test unchanged.

## 7b. Props (spec: deck3d-props)

- [ ] 7b.1 Extend `schema.json` with `overrides.props[]` (source, id, licence, author, sha256, slide, role, size, restyle, anim); tests: unknown role fails, `node:Foo` without node fails naming prop + id, missing sha256 fails, >5 props warns with totals but exits 0.
- [ ] 7b.2 Vendor `assets/props/` CC0 subset (~30 Kenney/Quaternius GLBs ≤300 KB each, tagged `manifest.json`, LICENSES); `src/props/search.ts` vendored source; test: `props search robot` returns manifest hits sorted vendored-first, writes no file.
- [ ] 7b.3 Poly Pizza source (`POLY_PIZZA_KEY`, `api.poly.pizza/v1.1/search`): parse to candidate rows; recorded-response fixture test; unreachable/unset key → vendored-only with one-line notice (test).
- [ ] 7b.4 `src/props/fetch.ts`: download to `.deck3d/props/<source>-<id>.glb`, glTF magic/MIME check, size cap (default 8 MB), sha256 write-if-absent / fail-if-differs, slug-only cache names; tests with a local HTTP fixture server: mismatch exits non-zero, oversized refused, non-glTF refused.
- [ ] 7b.5 Runtime `props/`: GLTFLoader + meshopt, Box3 normalise to `size`, ground, face camera, anim presets; `restyle: palette` material swap vs `original`; roles `hero|illustration|ambient|node:<id>` (node role keeps label + edge endpoints); test: node role renders model and edges still terminate at node bbox; two `palette` props share material class.
- [ ] 7b.6 Render embeds props base64 and refuses hash mismatch; credits slide generated for non-CC0/non-generated licences; tests: CC-BY prop → final slide titled Credits with author; CC0-only → no credits slide; offline-open test from 6.3 extended with a prop.
- [ ] 7b.7 `src/props/generate.ts`: `props generate --from-image <img> --name <n>` shelling to `python3 -c` `gradio_client` `tencent/Hunyuan3D-2` `/shape_generation` (extract `r[0]['value']`), store as `generated` licence with `restyle: palette`, print override entry; test: missing `gradio_client` → non-zero with install hint (mock the spawn).

## 8. Skill

- [ ] 8.1 Write `.pi/skills/deck3d/SKILL.md`: when to use, markdown grammar, the tune loop (parse → validate → render → check → fix suggested keys → snapshot → edit `overrides` only → repeat), forbidden edits (HTML, derived fields), pitfalls (chromium prerequisite, typeface.json corruption, bloom vs labels, mermaid pin); the prop loop (keywords from slide content → `props search` → pick by relevance then style, prefer one pack + `palette` → write `overrides.props[]` → `props fetch` → render/snapshot), licence rules; link `reference/ir-fields.md`; verify skill loads in a pi session (`/skills` lists `deck3d`).
- [ ] 8.2 Add a worked example under `.pi/skills/deck3d/examples/` — fixture deck, its `deck.json` with three overrides (one slide `mode:light`, one node shape change, one vendored prop with `role: node:LLM`), before/after snapshots; verify `deck3d build` on the example reproduces the committed `deck.json`.

## 9. Parity, retire lab, docs

- [ ] 9.1 Create `fixtures/strategy-lab.md` reproducing the lab's seven slides (incl. Hungarian titles and both mermaid blocks); build it; compare snapshots to the lab side by side and record deviations in `design.md` Open Questions or fix; verify all slides snapshot without console errors.
- [ ] 9.2 Move the lab's learnings (font corruption, mermaid id scheme, hidden-tab loop, label outline) from `mockup/README.md` into `packages/deck3d/AGENTS.md`; the `mockup/` dir archives with the change; verify `kb dox lint` clean.
- [ ] 9.3 DocScribe: `packages/deck3d/README.md` (install, grammar, CLI, tune loop) + `docs/architecture.md` pointer row; verify links resolve (`scripts/check-conventions.mjs`).
- [ ] 9.4 Full test run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; `npm run quality:changed` clean; `review-code` pass on the diff.
