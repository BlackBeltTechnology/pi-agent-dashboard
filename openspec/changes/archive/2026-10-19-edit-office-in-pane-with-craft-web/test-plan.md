# Test Plan — edit-office-in-pane-with-craft-web

Stage: design   Generated: 2026-10-18

Hard gate passed.
- **Performance:** "measure only" (P1, P2 record p95, never fail).
- **e2e:** always provisions the real pinned WordCraft release in the docker harness, which needs network in CI.
- **GridCraft/DeckCraft:** their L3 rows run only once their spike sets a registry `webVersion`. Until then the "unverified app" rows (E2) cover them.

Exemplars by level:

| Level | Exemplar |
|---|---|
| L1 craft-apps | `packages/craft-apps/src/__tests__/provision.test.ts`, `security.test.ts`, `registry.test.ts` |
| L1 plugin | `packages/browser-plugin/src/**/__tests__/` (plugin server + client tests) |
| L1 shared | `packages/shared/src/__tests__/bundle-runtime-contract.test.ts`, `bundled-plugins-complete.test.ts` |
| L3 | `tests/e2e/plugin-embedded-app.spec.ts` (plugin app mount), `tests/e2e/live-server-downloads.spec.ts` (sandboxed frame + host download), `tests/e2e/csp.spec.ts` |

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | claims per verified app | consistency | L1 | automated | plugin `package.json` claims + `craft-apps` registry + `OFFICE_SIZE_CAPS` | drift test | every claim's app has `webVersion`; `maxBytes`/`copySuffix`/`firstOverwriteNotice` equal registry values; every `webFidelityNote` ≤ 300 chars; every claim `validator: true` |
| E2 | unverified app | EP | L1 | automated | registry without `deckcraft.webVersion` | handler render for `deck.pptx` with a stale claim | renders "not verified", no iframe created, no status `prepare` call |
| E3 | per-app enable | decision table | L1 | automated | {plugin restart-pending, app disabled, app enabled} | status; `prepare`; save via claim's `enabled()` switch | status reasons `restart-required` / `disabled` / ok; `prepare` 403 for disabled; save 403 for disabled; written for enabled |
| E4 | web resolution precedence | decision table | L1 | automated | {`WORDCRAFT_WEB_DIR` set, `WORDCRAFT_WEB_VERSION=v0.8.0`, registry 0.8.0, `WORDCRAFT_BIN`/`WORDCRAFT_VERSION` set} combos; newer release exists | `provisionWeb("wordcraft")` | DIR wins (no network); else pin (leading `v` stripped); else registry; never latest; BIN/VERSION ignored |
| E5 | launcher source | EP | L1 | automated | `CRAFT_SOURCE=launcher` without / with `WORDCRAFT_WEB_DIR` | `provisionWeb` | first fails naming launcher source, zero network calls; second installs from the dir |
| E6 | override never mutated | EP | L1 | automated | override dir (read-only perms) | `provisionWeb` | succeeds; override dir checksum unchanged; tree installed under `<root>/wordcraft-web/dir-<digest>-s<shim>/` |
| E7 | override key | EP | L1 | automated | override dir; then only its wasm changed | provision twice | two distinct keys; `current` points at the second |
| E8 | zip list guard | EP | L1 | automated | zips with `../x`, `/abs`, a symlink entry, 2,001 entries, 513 MB uncompressed | `provisionWeb` | each aborts before extraction; nothing under `<root>/wordcraft-web/` except swept staging |
| E9 | Linux extraction | EP | L1 | automated | fixture web zip, `platform: "linux"` deps | `provisionWeb` | installed; no `tar`/`ditto` exec call (JS extraction) |
| E10 | CLI cache untouched | state | L1 | automated | CLI `wordcraft/0.8.0` cached | `provisionWeb` | CLI dir bytes unchanged; `provision("wordcraft")` still `cacheHit: true` |
| E11 | single-flight / cross-process | state | L1 | automated | two concurrent `provisionWeb` in-process; then a pre-existing final dir (`EEXIST`) | provision | one download; `EEXIST` branch verifies and uses existing matching-shim tree |
| E12 | shim version | state | L1 | automated | `current` tree with `shimVersion: 1`, plugin shim 2 | status; `prepare` | status `shim-outdated`; prepare installs `0.8.0-s2` and swaps `current`; `0.8.0-s1` left intact |
| E13 | post-install | EP | L1 | automated | fixture build with inline Trunk bootstrap | `postInstall` | `index.html` has no inline script; references `bootstrap-<hash>.js` and `craft-shim-<hash>.js` once (idempotent on rerun); `.gz` siblings exist; no `.br` |
| E14 | web report | EP | L1 | automated | fresh install | `provisionWeb` report | `{app, version, source:"registry", asset:"wordcraft-web-0.8.0.zip", cacheHit:false, dir (absolute), shimVersion, durationMs}` |
| E15 | CLI-scoped MODIFIED | regression | L1 | automated | existing `provision.test.ts` / `provision-apps.test.ts` suites | run after install-core refactor | all pass unchanged |
| E16 | static GET never provisions | EP | L1 | automated | unprepared build; network mock | anonymous `GET /apps/craft-wordcraft/index.html` | 503; zero outbound requests |
| E17 | CSP per request | EP | L1 | automated | two requests with forwarded hosts `a.example` / `b.example` | `GET /apps/craft-wordcraft/` | `script-src`/`connect-src` name `https://<host>/apps/craft-wordcraft/` per request; no `'self'`, no `sha256-`; `form-action 'none'`; ACAO `*`; no credentials header |
| E18 | OOXML validator | EP | L1 | automated | valid docx; valid xlsx sent as docx; non-zip; zip with `<!DOCTYPE` in content types; zip missing the `Override` main part; 10,001 entries | validate for `.docx` | only the first accepted |
| E19 | save routing | decision table | L1 | automated | `suggestedName` {`report.docx`, `REPORT.DOCX`, `draft.docx`, `report.pdf`} × target {overwrite, copy} × size {≤ cap, > cap} | shim `save` | same stem → `props.save` with target; different stem → Save-As dialog; `.pdf` → device download, no `props.save`; > cap → `save-result ok:false` + device download offer |
| E20 | dirty derivation | state-transition | L1 | automated | title warn sequence `report - WordCraft` → keydown → `report • - WordCraft` → save → `report - WordCraft`; then copy save | shim → host | `unknown` → `true` → `true` → `false`; after copy save stays `true` |
| E21 | message acceptance | EP | L1 | automated | messages: wrong `source`, wrong nonce, unknown `type`, bytes > cap, valid | host listener | only the valid one acts |
| E22 | shim open refusal | EP | L1 | automated | file input `click`, `showOpenFilePicker`, trusted drop with files, paste with file item, paste with text | shim (jsdom) | first four refused + `blocked` posted; text paste untouched |
| E23 | WebRTC removed | EP | L1 | automated | shim loaded | check globals | `RTCPeerConnection`, `webkitRTCPeerConnection`, `RTCDataChannel`, `RTCRtpSender` undefined |
| E24 | bundling | regression | L1 | automated | `bundledPlugins`, `BUNDLED_WORKSPACE_PKGS` | `bundled-plugins-complete.test.ts`, `bundle-runtime-contract.test.ts` | `craft-web-plugin` listed; `craft-apps` and `nano-banana` in the bundled workspace list |
| E25 | GPU probe | decision table | L1 | automated | {`navigator.gpu` present, absent+WebGL2, neither} | host before iframe | no flag / `?webgl` / message and no iframe |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | first Edit | tail-latency | L3 | automated | prepared (cached) WordCraft build, `report.docx` fixture, 5 runs | click Edit → `opened` p95, recorded only (measure-only) | one run |
| P2 | prepare | timing | L3 | automated | cold prepare of WordCraft 0.8.0 | prepare duration + served gzip bytes, recorded only | one run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | open in app | convergence | L3 | automated | plugin enabled, WordCraft prepared, `docker/fixtures/sample-git/report.docx` | select "Edit in WordCraft" | iframe `sandbox` = `allow-scripts`; `opened` received; frame URL has only `#n=`; page title text "report" visible in canvas screenshot |
| F2 | round trip | convergence | L3 | automated | F1 state | type "Edited in pane", confirm overwrite, save | `report.docx` on disk changed, valid zip, contains "Edited in pane" (unzip `word/document.xml`); no changed-on-disk banner |
| F3 | Save As name | convergence | L3 | automated | F1 state | in-app Save As `draft.docx` → "Save as copy" | dialog shown before any write; `report.wordcraft.docx` created; `draft.docx` absent |
| F4 | export | convergence | L3 | automated | F1 state | in-app Export PDF | Playwright `download` event `report.pdf` from the host page; no new workspace file |
| F5 | no network | convergence | L3 | automated | F1 state | `page.evaluate` in frame: `fetch("https://example.com")`, `fetch("/api/sessions")` | both rejected; a `csp` message logged server-side |
| F6 | hyperlink navigation | convergence | L3 | automated | fixture docx with a hyperlink, Chromium | activate link | editor stays loaded with edits; "open in new tab?" offer shown |
| F7 | frame navigated | state-transition | L3 | automated | dirty instance | force frame navigation (`frame.goto`) | "editor reloaded — unsaved edits were lost" shown with Resume; no further `open` posted |
| F8 | local open refused | convergence | L3 | automated | F1 state | `setInputFiles` on the app's file chooser / desktop drop | "open files from the dashboard" toast; next save still targets `report.docx` |
| F9 | sandboxed boot gate | convergence | L3 | automated | WordCraft in production sandbox, IndexedDB refused, `?webgl` leg | Edit | `opened` within 60 s in both legs (WordCraft ship gate) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | checksum | fault-injection | L1 | automated | `SHA256SUMS.txt` mismatch for the web zip | `provisionWeb` | fails; download deleted; nothing installed; status `checksum-mismatch` |
| X2 | offline prepare | fault-injection (abort) | L1 | automated | GitHub fetch rejects | `prepare` | status `offline`; client shows "could not be prepared"; built-in Preview still renders |
| X3 | readiness timeout | fault-injection (delay) | L1 | automated | shim never posts `ready` | host mount | after 60 s "could not start" + Retry; Retry after WebGPU path uses `?webgl` |
| X4 | opened timeout | fault-injection (delay) | L1 | automated | `ready` posted, no title naming the document | `open` sent | after 15 s "could not open" |
| X5 | blob revoke race | fault-injection | L1 | automated | app revokes the blob URL synchronously after `a.click()` | anchor-intercepted save | bytes still delivered (fetch issued inside the click handler) |
| X6 | win32 pointer swap | fault-injection | L1 | automated | `platform: "win32"` deps | swap `current` | never resolves to a partial tree; during the swap window requests get 503 |
| X7 | disabled mid-session | state | L3 | automated | dirty WordCraft instance | disable plugin in settings | instance stays with "re-enable or discard" overlay; edits intact |
| X8 | GridCraft / DeckCraft spikes | spike | — | manual-only | real GridCraft/DeckCraft web builds | per-app acceptance list (design Risks) | [judgment: seam behaviour of untested apps; the outcome is a registry `webVersion` or not, recorded in the spike note] |

---

## Coverage summary

- Requirements covered: 11/11 (craft-web-editor 8; craft-binary-provisioning ADDED 1 + MODIFIED 6 via E15/E4/E5/E14).
- Scenarios by class: edge 25 · perf 2 · frontend 9 · error 8.
- Scenarios by level: L1 31 · L2 0 · L3 12 · manual-only 1.
- Scenarios by disposition: automated 43 · manual-only 1.

## New infra needed

- **Docker e2e harness:**
  - outbound network to `github.com` / `objects.githubusercontent.com`, so the pinned WordCraft release can be provisioned (CI must allow it);
  - headless Chromium with WebGL2 (SwiftShader `--use-angle=swiftshader` / `--enable-unsafe-swiftshader`) for F1–F9.
- **Fixture:** a docx with a hyperlink for F6.
