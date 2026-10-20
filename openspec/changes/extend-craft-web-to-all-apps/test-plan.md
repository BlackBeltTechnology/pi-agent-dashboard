# Test Plan — extend-craft-web-to-all-apps

Stage: design   Generated: 2026-10-20

Hard gate passed (decided 2026-10-20):
- **Performance thresholds:** first open with a cached build ≤ 10 s p95 per app; validation of a 16 MiB SVG ≤ 2 s.
- **e2e builds:** real pinned releases are downloaded from GitHub every run (checksum-verified, same path as the product). CI needs network.
- **RAW fixture:** one small CC0 DNG committed under `docker/fixtures/sample-git/craft/`, licence recorded in that folder's `AGENTS.md`.

Exemplars by level:

| Level | Exemplar |
|---|---|
| L1 plugin server | `packages/craft-web-plugin/src/server/__tests__/post-install.test.ts`, `service.test.ts`, `routes.test.ts`, `ooxml-validator.test.ts`, `validator-worker.test.ts`, `shim-version.test.ts` |
| L1 plugin client | `packages/craft-web-plugin/src/client/__tests__/protocol.test.tsx`, `save.test.tsx`, `gate.test.tsx`, `CraftWebSettings.test.tsx` |
| L1 shim | `packages/craft-web-plugin/src/shim/__tests__/craft-shim.test.ts` |
| L1 drift | `packages/craft-web-plugin/src/__tests__/manifest.test.ts` |
| L1 core server | `packages/server/src/__tests__/file-write-binary.test.ts` |
| L1 core runtime | `packages/dashboard-plugin-runtime/src/__tests__/manifest-validator.test.ts`, `file-handler-claims.test.ts` |
| L1 core client | `packages/client/src/components/editor-pane/file-handler/__tests__/file-handler-host.test.ts` |
| L3 | `tests/e2e/craft-web-editor.spec.ts` (made table-driven), `tests/e2e/csp.spec.ts`, `tests/e2e/editor-pane-file-handler.spec.ts` |

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | claims per verified app (D2 drift) | consistency | L1 | automated | profiles, plugin `package.json` claims, `craft-apps` registry, validator dispatcher routes, `OFFICE_SIZE_CAPS`, `HANDLER_MAX_BYTES` | drift test | every claim has a profile and vice versa; every profiled app has `webVersion`; every edit and sibling ext has a dispatcher route; `maxBytes` per ext = docx cap for `.docx .odt .rtf`, sheet for `.xlsx`, pptx for `.pptx`, 16 MiB for `.svg`, else `HANDLER_MAX_BYTES`; `copySuffix` = app id; notice ≤ 300 chars; every title pattern starts `^` and ends `$` |
| E2 | profile fallback bounds | BVA | L1 | automated | no-title profiles with `openedFallbackMs` 999 / 1000 / 15000 / 15001; a title profile with `openedFallbackMs` set; a no-title profile without it | drift test | 1000 and 15000 pass; 999, 15001, title+fallback, and missing fallback each fail naming the app |
| E3 | one craft mode per extension | consistency | L1 | automated | all manifest claims | drift test | no extension appears in two craft claims or in one claim's `extensions` and another's `siblingExtensions`; `.jpg` belongs only to `photocraft-raster` |
| E4 | extension gated by verification | EP | L1 | automated | profile where CADCraft lists `.dxf` only (`.dwg` verification failed) | `listFileHandlerClaims` for `plan.dwg` and `plan.dxf` | `plan.dwg` → no CADCraft claim; `plan.dxf` → "Edit in CADCraft" |
| E5 | post-install executable-script externalization | EP | L1 | automated | committed fixture `index.html`s: WordCraft (1 Trunk inline), SoundCraft (Trunk + 2nd inline), FilmCraft (`filmcraftLoad.readyMs` + plain inline), LightCraft (`start(font)`), JSON data block, inline `importmap`, loader with zero matches, loader with two matches | `postInstall` | first four: no executable inline script left, order preserved, `TrunkApplicationStarted` dispatched exactly once after the hook point, profile script before shim; JSON block left inline; importmap, zero-match and two-match → throw (prepare `extract-failed`); rerun idempotent |
| E6 | shim compatibility | decision table | L1 | automated | {WordCraft v1 build no profile line, GridCraft v1 build, WordCraft v2 build with stale profile hash, v2 build current hash} | status | WordCraft v1 → `ok` + update offered; GridCraft v1 → `shim-outdated`; stale hash → `shim-outdated`; current → `ok` |
| E7 | downgrade parse | EP | L1 | automated | v2 `index.html` (both marker lines) | parse with the v1 `MARKER_RE` `/<!-- craft-shim:(\d+) -->/` | captures `2` (old plugin reports `shim-outdated`, never mis-parses) |
| E8 | title parsing | decision table | L1 | automated | profile patterns × titles: `report • - WordCraft`, `report - WordCraft`, `report — WordCraft`, `photo.jpg — PhotoCraft`, `budget.xlsx`, `budget.xlsx — Edited`, `Book1`, `LightCraft` | shim title handler with delivered names `report.docx` / `photo.jpg` / `budget.xlsx` | names: `report` (dirty marker stripped, dirty), `report`, `report`, `photo.jpg`, `budget.xlsx`, `budget.xlsx` (marker → dirty); `Book1` and `LightCraft` never post `opened` |
| E9 | dirty rules | decision table | L1 | automated | `cleanOnAckedSave` {true, false} × {ack own overwrite, ack copy, ack sibling, trusted input after save request before ack, persisting `— Edited` title after ack, title changes to `— Edited` after ack} | shim message sequence | true+own ack → `dirty:false`; copy/sibling ack → stays `true`; input after request → stays `true`; persisting marker → stays `false`; marker change after ack → `true`; false (WordCraft) → only title-driven clean |
| E10 | opened fallback | state-transition | L1 | automated | no-title profile, `openedFallbackMs` 3000 | synthetic drop delivered; then (a) 3000 ms pass, (b) canvas removed at 2000 ms, (c) frame reload at 2000 ms, (d) start error at 1000 ms | (a) `opened{confirmed:false}` then `dirty:false`; (b) and (c) no `opened`; (d) `start-failed`, no `opened` |
| E11 | start-failed detector | state-transition | L1 | automated | `WebAssembly.RuntimeError` window error; `console.error("panicked at …")`; same events after `opened` | shim | before opened → one `start-failed`; after opened → no `start-failed` |
| E12 | v1 compatibility of `opened` | EP | L1 | automated | `opened` message without `confirmed` | host first overwrite | no unconfirmed-open dialog; core first-overwrite notice only |
| E13 | save routing | decision table | L1 | automated | `routeSave` inputs: tab `photo.jpg` claim `photocraft-raster` (sibling `.psd`); tab `mix.scraftz` (`inner-title`); tab `report.docx`; names {`photo.jpg`, `draft.jpg`, `photo.psd`, `other.psd`, `photo.pdf`}, {`Midnight Groove.scraftz` twice, `Other.scraftz`}, oversize bytes; preview claim | `routeSave` | `photo.jpg` → own; `draft.jpg` → save-as; `photo.psd` and `other.psd` → sibling (target `photo.psd`); `photo.pdf` → download; first `Midnight Groove.scraftz` → save-as even if stem matched, second (answer remembered) → own, `Other.scraftz` → save-as; oversize → too-large; preview claim → download for every name |
| E14 | Create-and-open availability | decision table | L1 | automated | native claim `photocraft` {enabled+verified, disabled, absent} | sibling dialog render | "Create and open" shown only when enabled+verified; "Create", "Download instead", "Cancel" always |
| E15 | `siblingExtensions` manifest rules | EP | L1 | automated | edit claim `[".jpg"]` + sibling `[".psd"]`; preview claim with siblings; sibling `.md`; sibling `.psd` also in `extensions`; sibling `psd` (no dot) | `validateManifest` | first accepted and survives registry generation; others throw naming plugin, claim and extension |
| E16 | registry hash | EP | L1 | automated | two manifests differing only in `siblingExtensions` | registry generation | hashes differ |
| E17 | core sibling copy | decision table | L1 | automated | cwd with `photo.jpg`; {no `photo.psd`, `photo.psd` exists, `photo.psd`…`photo-99.psd` exist}; `siblingExt` {`.psd`, `.exe`}; `mode` {copy, overwrite} | `POST /api/file/write-binary` | `.psd` copy → 200 `photo.psd`, then `photo-2.psd`; 99 taken → 409; `.exe` → 403; overwrite+`siblingExt` → 400; `photo.jpg` bytes unchanged in every case; validator received ext `.psd` |
| E18 | sibling containment | EP | L1 | automated | `<cwd>/photo.jpg` symlink to a file outside cwd | sibling copy | rejected; nothing written inside or outside cwd |
| E19 | old runtime drops field | EP | L1 | automated | client registry claim without `siblingExtensions` (as an older server generates) | `routeSave` for `photo.psd` | `download`; no request with `siblingExt` |
| E20 | format validators | EP | L1 | automated | per ext a valid sample and invalid ones: `.pdf` (no `%%EOF`, PNG bytes); `.dxf` (ASCII, binary sentinel, PDF bytes); `.dwg` (`AC1015`, `AC9999`, garbage); `.odt` (stored `mimetype` first, wrong mimetype, no `content.xml`); `.rtf` (`{\rtf1`, `{\rtf2`); `.psd` (v1, v2, v3); PNG bytes as `.jpg`; `.designcraft` (with/without `document.json`, wrong mimetype); `.scraftz` (one `.scraft`, two, none; no `Audio Files/`); `.deckcraft` (with/without `presentation.json`); zip with 10 001 entries; unknown ext `.exe` | dispatcher `validate(bytes, ext)` in the worker pool | valid → `{ok:true}`; each invalid → `{ok:false}`; `.scraftz` without `Audio Files/` → ok; unknown ext → reject |
| E21 | SVG script filter | EP | L1 | automated | SVGs: plain; comment+PI before `<svg`; `<!DOCTYPE`; `<!ENTITY`; `<script>`; `<svg:script>`; `onload=`; `<set attributeName="onmouseover">`; `<animate attributeName="href" values="javascript:…">`; `href="&#106;avascript:…"`; `href=" java\tscript:…"`; `data:text/html`; `<foreignObject>`; `<script>` after 1 MiB of padding; first element `<html>` | `validate(bytes, ".svg")` | plain and comment+PI → ok; every other input → reject |
| E22 | size caps | BVA | L1 | automated | `.odt` bytes at docx cap, cap+1; `.svg` at 16 MiB, 16 MiB+1 | core write-binary | at cap → passes size check; cap+1 → 413 |
| E23 | fixed channel | decision table | L1 | automated | `latestChannel:false` app (GridCraft, DeckCraft) with stored `version:"latest"`; `latestChannel:true` (WordCraft) | status; prepare | fixed apps: status reports verified version, zero latest-metadata requests, prepare installs verified; WordCraft unchanged |
| E24 | settings fixed channel | EP | L1 | automated | status rows for DeckCraft (fixed, reason "newer web builds fail to start"), GridCraft (fixed, "latest builds not verified yet"), WordCraft | `CraftWebSettings` render | DeckCraft/GridCraft selectors disabled with their reason text; WordCraft selector enabled |
| E25 | frame flags invariant | EP | L1 | automated | every profile; profile with `frameParams:["nosw"]` | `CraftFrame` render | iframe `sandbox` = `allow-scripts`, `allow` = `clipboard-write` for every profile; `nosw` appears only in the `src` query |
| E26 | worker trampoline | EP | L1 | automated | `new Worker("https://h/apps/craft-x/worker.js", {type:"module"})`; classic URL; URL containing `"` and a newline; `blob:` URL; `data:` URL | wrapped `Worker` (jsdom) | http → `blob:` whose body is exactly one `import`/`importScripts` of the `JSON.stringify`-escaped absolute URL; `blob:`/`data:` passed through unchanged |
| E27 | view-only host | state-transition | L1 | automated | preview claim instance | `opened`, then `dirty:true` messages after trusted input, then close | `setDirty(false)` once; dirty messages ignored; no save-target toggle rendered; close → no unsaved prompt |
| E28 | unconfirmed-open dialog order | decision table | L1 | automated | instance `opened{confirmed:false}` with fidelity notice; user choice {Overwrite, Save as copy, Cancel} | first own save | Overwrite → plugin dialog then core notice; Save as copy → copy, no core notice; Cancel → nothing written, `save-result ok:false`; second save → neither dialog |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | first open per app | tail-latency | L3 | automated | each shipped app row, build already prepared, its committed fixture, headless Chromium `?webgl` | mode select → `opened` p95 ≤ 10 s | 5 opens per app per run |
| P2 | SVG validator cost | timed | L1 | automated | 16 MiB worst-case SVG (deep nesting, many attributes, entity-like text) | validation wall time in the worker pool ≤ 2 s (and below the 5 s worker kill) | 5 runs, max |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | open per app | state-convergence | L3 | automated | table row per shipped app with its fixture (`report.docx`, `letter.odt`, `letter.rtf`, `budget.xlsx`, `doc.pdf`, `plan.dxf`, `plan.dwg`, `mag.designcraft`, `mix.scraftz`, `photo.psd`, `photo.jpg`, `shapes.svg`, `talk.pptx`, `talk.deckcraft`) | select the app's mode | converges to `opened` (title apps confirmed, no-title apps unconfirmed); frame URL has no document data |
| F2 | in-place save per type A app | state-convergence | L3 | automated | the app's fixture; an edit the row defines (xlsx: `999` into C2; dxf: `CIRCLE 10,10 5`; designcraft: none, save only; pdf: none; scraftz: none) | Ctrl/Cmd+S (+ accept the unconfirmed/fidelity dialogs) | file on disk changes, passes its validator, contains the edit (`C2=999`; a new CIRCLE r=5); `.designcraft` still contains `assets/` |
| F3 | dirty round trip | state-transition | L3 | automated | GridCraft `budget.xlsx`; CADCraft `plan.dxf` | type → close tab → cancel; save → close tab | first close prompts; after acknowledged save the close does not prompt, although GridCraft still shows `— Edited` |
| F4 | unconfirmed-open guard | decision table | L3 | automated | CADCraft `plan.dxf` | first save, choose Save as copy | `plan.cadcraft.dxf` created, `plan.dxf` unchanged, no core first-overwrite notice shown |
| F5 | CSP per app | invariant | L3 | automated | each shipped app frame | frame evaluates `fetch("https://example.com")` and `fetch("/api/health")` | both rejected; a `csp` report reaches the server; no request reaches example.com |
| F6 | rendering legs | state-convergence | L3 | automated | each shipped app | open with WebGPU leg and with `?webgl` | both converge to `opened` |
| F7 | native sibling | state-convergence | L3 | automated | PhotoCraft `photo.jpg` | save → dialog → Create and open | `photo.psd` exists and passes the PSD validator; a `photo.psd` tab is active in PhotoCraft's `.psd` mode; `photo.jpg` unchanged; the `photo.jpg` tab still dirty |
| F8 | session-named save | state-transition | L3 | automated | SoundCraft `mix.scraftz` | save → choose Overwrite → edit → save | first save shows the Save As question; second save writes without a question; `mix.scraftz` passes its validator |
| F9 | worker isolation | invariant | L3 | automated | LightCraft frame (trampoline enabled) | frame evaluates `new Worker("https://example.com/w.js")` | worker script blocked under CSP; no request reaches example.com; LightCraft keeps running |
| F10 | RAW view | state-transition | L3 | automated | committed CC0 DNG | open LightCraft view mode; drag exposure; close; reopen; export JPEG | opens; close shows no unsaved prompt; DNG bytes unchanged; export offered as device download, no workspace file created |
| F11 | v1 build keeps working | state-convergence | L3 | automated | harness seeds a WordCraft tree whose `index.html` carries only the v1 marker (no profile line) | select "Edit in WordCraft"; open settings | WordCraft opens `report.docx` with zero `prepare` requests and zero outbound release fetches; settings shows an Update action |
| F12 | broken latest | state-transition | L3 | automated | `DECKCRAFT_WEB_VERSION=0.8.0` prepared | select DeckCraft mode on `talk.pptx` | "could not start" panel with Retry; exactly one `open` message sent; no `opened` |
| F13 | first click starts SoundCraft audio | hardware/audio | — | manual-only | `mix.scraftz` in SoundCraft, no `autoplay` grant | press play after one click inside the frame | [judgment: audio is heard — no automatable audio-output observable in headless CI] |
| F14 | cross-browser drop | real browsers | — | manual-only | one type A (CADCraft) and one type B (PhotoCraft) app | open in Firefox and Safari | [judgment: document visible and save works — headless harness is Chromium-only] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | unrecognised start-up | fault-injection (abort) | L1 | automated | a new release's loader where the hook point matches 0 or 2 times | `POST /api/plugins/craft-web/prepare/:app` | 502 `extract-failed`; `current` still points at the old build; the old build still served |
| X2 | GitHub unreachable for a new app | fault-injection (abort) | L1 | automated | release download fails for GridCraft (not prepared) | status; prepare | status `not-prepared`; prepare → `offline` 503; built-in xlsx preview unaffected |
| X3 | sibling names exhausted | fault-injection (abort) | L1 | automated | core answers 409 for a sibling copy | plugin save handling | "too many copies" message; `save-result ok:false`; tab stays dirty |
| X4 | validator rejects frame output | fault-injection (abort) | L1 | automated | sibling `.psd` bytes that fail the PSD check | sibling copy | 422; no `photo*.psd` created; plugin reports rejected |
| X5 | worker trampoline in a broken worker | fault-injection (abort) | L1 | automated | trampolined worker whose import throws | worker `error` event | the app's own worker error handling runs; no `start-failed` after `opened` |

---

## Coverage summary

- Requirements covered: 14/14 delta requirements:
  - craft-web-editor: 10 (claims, prepared/served, loaded, saves, unsaved state, validators, settings channel, isolation, view-only, fixed channel);
  - editor-pane-file-handlers: 1;
  - dashboard-shell-slots: 1;
  - baseline isolation and rendering re-asserted per app: 2.
- Scenarios by class: edge 28 · perf 2 · frontend 14 · error 5.
- Scenarios by level: L1 35 · L3 14 · manual 2 (L2: none; no process/install surface changes).
- Scenarios by disposition: automated 47 · manual-only 2.

## New infra needed

- A committed CC0 DNG and the format fixtures under `docker/fixtures/sample-git/craft/`.
- A harness seed step for F11: write a v1-marked WordCraft tree into the plugin data dir before the run (extend the existing craft-web seeding in `docker/`).
