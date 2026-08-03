# Tasks

Ordered by dependency and by the design's phased, no-flag-day migration. This
change **extends `packages/shared/src/tool-registry/`** — it does NOT build a new
resolver, catalog, or CLI. TDD: write/adjust the test first, watch it fail, then
implement. Phase 0 lands inert; each later phase is independently shippable and
revertable.

## 1. Phase 0 — Types + probe-kind strategies (`tool-registry`)

- [ ] 1.1 Write failing tests: `Source` union extended with `"static-npm"` +
  `"probe"`; `classify()` maps the new strategy names (not to `"system"`);
  `PlatformInstallHint` gains optional `requiresConfirm?: boolean`
- [ ] 1.2 Extend `types.ts` (`Source`, `PlatformInstallHint.requiresConfirm`,
  probe-kind `ToolDefinition.kind: "probe"`) + `definitions.ts` `classify()`
- [ ] 1.3 Write failing tests for the `env` strategy: present var → `ok:true`
  `source:"probe"` `path:null`, value never in `Resolution`/logs; absent → `ok:false`
- [ ] 1.4 Implement the `env` probe strategy (boolean presence, no value read)
- [ ] 1.5 Write failing tests for the `docker-image` strategy: image present →
  `ok:true`; daemon/image absent → `ok:false` + reason in `tried[]`, never assumes docker
- [ ] 1.6 Implement the `docker-image` probe strategy
- [ ] 1.7 Write failing tests for the `pw-browser` strategy: chromium present in
  Playwright cache → `ok:true`; absent → `ok:false` + `installHints`
- [ ] 1.8 Implement the `pw-browser` probe strategy (reads Playwright browsers dir)
- [ ] 1.9 Write failing tests asserting the relaxed `Resolution.path` invariant:
  path-kind tools absolute-when-ok; non-path kinds may be null/non-fs ref
- [ ] 1.10 Adjust resolution so non-path kinds satisfy the modified invariant

## 2. Phase 0 — Media tool definitions (static-npm strategy)

- [ ] 2.1 Write failing tests for a NEW `static-npm` strategy: reads the binary
  path exported by `require("<pkg>")` (distinct from `bare-import`'s pkg-dir/JS-entry)
- [ ] 2.2 Implement the `static-npm` strategy
- [ ] 2.3 Write failing tests: `resolve("ffmpeg")` → `static-npm(ffmpeg-static)`
  path, `source:"static-npm"`; falls through to `where` then `installHints`
- [ ] 2.4 Register `ffmpeg` definition (chain `override → static-npm(ffmpeg-static)
  → where`) + per-OS `installHints`
- [ ] 2.5 Write failing test: `resolve("ffprobe")` does NOT depend on ffmpeg-static
- [ ] 2.6 Register `ffprobe` (static-npm against `@ffprobe-installer/ffprobe`) +
  `imagemagick` (resolve + host `installHints`, optional) + `chromium`
  (`pw-browser` + `installHints.manual = "npx playwright install chromium"`)
- [ ] 2.7 Extend `install-hints.test.ts` to cover the new media tools; add any
  `docsAnchor` targets to `docs/faq.md`

## 3. Phase 0 — Manifest ingestion + ensureTools + CLI

- [ ] 3.1 Write failing tests for `pi.tools` ingestion: `{id,probe,optional}` only;
  reject entries with extra keys (e.g. `provide`); id charset
  `^[A-Za-z0-9_][A-Za-z0-9._-]*$` (accepts `SONIOX_API_KEY`, rejects `npm:@scope/pkg`);
  unmanifested skill = no ingestion
- [ ] 3.2 Implement `pi.tools` ingestion into the registry (reference existing def
  or synthesize a `probe`-kind def from probe kind + catalog `installHints`)
- [ ] 3.3 Write failing tests for `ensureTools(tools, opts): EnsureReport`:
  required-missing → `action:"blocked"` + `ok:false` WITHOUT throwing;
  optional-missing → `action:"degraded"` (does not fail `ok`); present → `present`
- [ ] 3.4 Implement `ensureTools()` (recommend-default) over `getDefaultRegistry()`
- [ ] 3.5 Write failing tests for opt-in auto-run: default never installs
  (`recommended`); `autoInstall` runs only a first-party `installHints.commands`
  string (never a manifest string); `requiresConfirm:true` hint gates on confirmation
- [ ] 3.6 Implement the opt-in auto-run path + `requiresConfirm` gate
- [ ] 3.7 Write failing tests for the TS `ensure` CLI: reads a package's `pi.tools`,
  exit 0 all-present, non-zero required-missing, `--json` always exit 0 with outcome
- [ ] 3.8 Implement the TS-backed `ensure` CLI bin in `packages/shared` (separate
  from the path-only build-time `pi-dashboard-resolve-tool.cjs`, which is untouched)
- [ ] 3.9 Verify Phase 0 inert end-to-end: no skill declares `pi.tools`; full test
  suite green; no runtime behavior change

## 4. Phase 1 — One exemplar per probe kind (battle-test)

- [ ] 4.1 `resolve`/static-npm (facade, no bootstrap): add `ffmpeg`+`ffprobe`
  `pi.tools` to `video-transcription`; add `ffmpeg-static` +
  `@ffprobe-installer/ffprobe` to `optionalDependencies`; route
  `isFfmpegAvailable`/`getDurationSeconds` through `registry.resolve`; ffmpeg-absent
  still degrades (audio-only) — preserve that test
- [ ] 4.2 `pw-browser` + CLI (bootstrap): replace `browser` Step 0a prose with the
  TS `ensure` CLI for `agent-browser` + `chromium`; keep recommend-only
- [ ] 4.3 `docker-image`: add a `docker-image` `pi.tools` entry to
  `document-converter`; map the existing `DOCKER_UNAVAILABLE` path to the probe;
  recommend `npm run build:image` via `installHints`
- [ ] 4.4 `env`: add `env` `pi.tools` entries to `nano-banana` (`GEMINI_API_KEY`)
  + `video-transcription` (`SONIOX_API_KEY`); confirm name-only recommend, no value leak
- [ ] 4.5 Confirm all four probe kinds + static-npm exercised; adjust
  types/strategies if reality contradicts the design before the long tail

## 5. Phase 2 — Roll remaining skills (one PR each)

- [ ] 5.1 `veo-generator` (`ffmpeg` via registry; `GEMINI_API_KEY` env)
- [ ] 5.2 `veo-showreel-production-kit` (`imagemagick` optional/degrade; env key)
- [ ] 5.3 `mockup-loop` (`chromium` via `pw-browser`)
- [ ] 5.4 `doc-summarizer` (shares `pi-doc-engine` docker-image)
- [ ] 5.5 Sweep remaining install-prose SKILL.md files (of the 11) to `pi.tools`;
  remove superseded prose

## 6. Phase 3 — Doctor reporting (additive)

- [ ] 6.1 Write failing test: skill-manifest tools appear in the per-tool status
  surface (`list()` / `GET /api/tools`) once ingested
- [ ] 6.2 Confirm whether Settings→Tools + `/api/tools` already render ingested
  skill tools (Phase 3 free) or a `doctor-diagnostic` delta is needed; implement
  the minimal wiring

## 7. Verification & docs

- [ ] 7.1 Full `npm test` green; new strategies + ensureTools + ingestion covered;
  `install-hints.test.ts` + `no-hardcoded-node-modules-paths.test.ts` extended
- [ ] 7.2 Manual cross-platform smoke: required-missing hard-stops with host-correct
  `installHints`; optional-missing degrades; a bad manifest is a doc bug
  (recommend), never a host mutation
- [ ] 7.3 Update `docs/architecture.md` with a skill-tool-provisioning section
  (delegate to DocScribe, caveman style)
- [ ] 7.4 Update affected skills' directory `AGENTS.md` rows +
  `packages/shared/src/tool-registry/AGENTS.md`

## 8. Test scenarios folded from test-plan.md (source of truth)

Each row below folds one `automated` scenario from `test-plan.md`. Author the
test in the cited category, copying harness glue from the exemplar. 0 `manual-only`
rows → nothing deferred to `ship-change`.

### L1 unit (vitest) — see `packages/shared/src/tool-registry/__tests__/install-hints.test.ts` (defs) / `bundled-node-strategy.test.ts` (strategies)

- [ ] 8.1 (test-plan #E1) valid `{id,probe,optional}` referencing a registered def · skill loads · ingested, `optional` carried
- [ ] 8.2 (test-plan #E2) entry with extra key `provide` · ingest · rejected, named
- [ ] 8.3 (test-plan #E3) id `npm:@the-focus-ai/nano-banana` · ingest · rejected (`:`,`@`)
- [ ] 8.4 (test-plan #E4) id `SONIOX_API_KEY` · ingest · accepted (upper+underscore)
- [ ] 8.5 (test-plan #E5) id `-ffmpeg`/`.x` · ingest · rejected (bad first char)
- [ ] 8.6 (test-plan #E6) skill pkg with no `pi.tools` · load · no ingestion, behavior byte-identical
- [ ] 8.7 (test-plan #E7) `SONIOX_API_KEY` set · resolve env tool · `ok:true` `source:"probe"` `path:null`
- [ ] 8.8 (test-plan #E8) `SONIOX_API_KEY=secret123` · resolve+serialize+capture logs · value absent from Resolution/report/logs
- [ ] 8.9 (test-plan #E9) injected docker runner: image present · resolve `pi-doc-engine` · `ok:true` `source:"probe"` path=image ref
- [ ] 8.10 (test-plan #E10) fake `PLAYWRIGHT_BROWSERS_PATH` w/ chromium · resolve `chromium` · `ok:true` `source:"probe"`
- [ ] 8.11 (test-plan #E11) `ffmpeg-static` installed · `resolve("ffmpeg")` · `ok:true` path=exported binary `source:"static-npm"`
- [ ] 8.12 (test-plan #E12) no ffmpeg-static, no PATH ffmpeg · `resolve("ffmpeg")` · `ok:false` + `installHints`
- [ ] 8.13 (test-plan #E13) `@ffprobe-installer/ffprobe` object `.path`, no ffmpeg-static · `resolve("ffprobe")` · `ok:true` path from `.path`
- [ ] 8.14 (test-plan #E14) pkg exports bare string \| `{path}` · static-npm strategy · both yield binary path
- [ ] 8.15 (test-plan #E15) required tool absent, no autoInstall · `ensureTools` · `action:"blocked"` `ok:false` NO throw
- [ ] 8.16 (test-plan #E16) optional tool absent · `ensureTools` · `action:"degraded"`, `ok` not false
- [ ] 8.17 (test-plan #E17) all present · `ensureTools` · all `action:"present"` `ok:true`
- [ ] 8.18 (test-plan #E18) binary tool ok · resolve · `path` absolute
- [ ] 8.19 (test-plan #E19) env tool ok · resolve · `path:null` accepted
- [ ] 8.20 (test-plan #E20) docker-image tool ok · resolve · non-fs image ref path accepted
- [ ] 8.21 (test-plan #E21) bundled-node succeeds for `node` · resolve · `source:"bundled"` (regression)
- [ ] 8.22 (test-plan #E22) static-npm \| probe succeeds · classify · `"static-npm"` \| `"probe"`, never `"system"`
- [ ] 8.23 (test-plan #E23) chromium def w/ network hint · `list()` · hint carries `requiresConfirm:true`
- [ ] 8.24 (test-plan #E24) tool with vs without `installHints` · resolve · `ok/path/source/tried` identical; absent from Resolution
- [ ] 8.25 (test-plan #E25) skill `pi.tools:[{id:"ffmpeg"}]` loaded · `list()`/`GET /api/tools` · `ffmpeg` row w/ Resolution + installHints
- [ ] 8.26 (test-plan #X1) `SONIOX_API_KEY` unset · resolve env tool · `ok:false`, recommend names var+url only, no value
- [ ] 8.27 (test-plan #X2) docker daemon unavailable/image missing · resolve · `ok:false`+reason in `tried[]`, no assume-docker, `installHints`
- [ ] 8.28 (test-plan #X3) Playwright cache missing chromium · resolve `chromium` · `ok:false` + `installHints`
- [ ] 8.29 (test-plan #X5) missing tool, no autoInstall · ensure · `action:"recommended"`, exec spy uncalled
- [ ] 8.30 (test-plan #X6) missing tool, autoInstall, manifest injects a string · ensure · executed cmd from registry def, manifest string never run
- [ ] 8.31 (test-plan #X7) `requiresConfirm` hint, autoInstall, confirm-callback→false · ensure · command NOT executed

### L2 process/CLI smoke — see `qa/tests/01-install.sh` (spawn + exit-code assertion pattern)

- [ ] 8.32 (test-plan #X4) pkg `pi.tools` w/ missing REQUIRED tool · run TS `ensure` CLI · exit non-zero; `--json` exits 0 with outcome
- [ ] 8.33 (test-plan #X8) `ensure --install` headless (no TTY), missing required tool w/ `requiresConfirm` hint · run CLI · auto-deny, `action:"blocked"`, exit non-zero (optional → `degraded`, exit 0)

### L3 Playwright (docker harness, derived `dashboardPort`) — see `tests/e2e/git-panel.spec.ts` (panel + rows render)

- [ ] 8.34 (test-plan #F1) skill-declared tool resolving `ok:false` w/ `installHints[hostOs]` · open Settings→Tools · row renders `[Install ▾]` dropdown identical to a built-in missing tool
