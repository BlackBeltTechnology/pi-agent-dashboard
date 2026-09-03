# Test Plan — add-skill-tool-provisioning

Stage: design   Generated: 2026-07-23

Adversarial scenarios derived from the `tool-registry` delta (ingestion, probe
kinds, static-npm, opt-in auto-run, MODIFIED path/Source invariants, skill-tool
surfacing). Two design-stage gaps were resolved via `ask_user`: (1) non-interactive
`requiresConfirm` → auto-deny + blocked/degraded + non-zero exit; (2) doctor
reporting → full scope, riding existing registry surfaces (L3 row F1).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Manifest ingestion | EP | L1 | automated | `pi.tools:[{id:"ffmpeg",probe:"resolve",optional:true}]`, `ffmpeg` already registered | skill loads | entry ingested; references existing def; `optional===true` carried |
| E2 | Manifest ingestion | negative | L1 | automated | entry `{id,probe,provide:"brew install x"}` (extra key) | ingest | entry rejected, named in error; no ingestion |
| E3 | id charset | BVA (invalid) | L1 | automated | `id:"npm:@the-focus-ai/nano-banana"` (`:`,`@`) | ingest | rejected |
| E4 | id charset | BVA (valid) | L1 | automated | `id:"SONIOX_API_KEY"` (upper+underscore) | ingest | accepted |
| E5 | id charset | BVA (invalid first char) | L1 | automated | `id:"-ffmpeg"` / `id:".x"` | ingest | rejected (first char not `[A-Za-z0-9_]`) |
| E6 | Unmanifested skill | EP | L1 | automated | skill pkg with no `pi.tools` | load | no ingestion; registry behavior byte-identical |
| E7 | env probe | state | L1 | automated | `SONIOX_API_KEY` set | `resolve` env tool | `ok:true`, `source:"probe"`, `path:null` |
| E8 | env secret hygiene | fault/observability | L1 | automated | `SONIOX_API_KEY=secret123` set | resolve + serialize `Resolution` + capture logs | value `secret123` absent from `Resolution`, report, and every log line |
| E9 | docker-image probe | state | L1 | automated | injected docker runner reports image present | resolve `pi-doc-engine` | `ok:true`, `source:"probe"`, `path`=image ref |
| E10 | pw-browser probe | state | L1 | automated | fake `PLAYWRIGHT_BROWSERS_PATH` containing chromium dir | resolve `chromium` | `ok:true`, `source:"probe"` |
| E11 | static-npm ffmpeg | state | L1 | automated | `ffmpeg-static` installed (bare string export) | `resolve("ffmpeg")` | `ok:true`, `path`=exported binary path, `source:"static-npm"` |
| E12 | static-npm fallthrough | BVA | L1 | automated | no `ffmpeg-static`, no PATH `ffmpeg` | `resolve("ffmpeg")` | `ok:false`; recommendation = `ffmpeg` `installHints` |
| E13 | ffprobe independence | EP | L1 | automated | `@ffprobe-installer/ffprobe` (object `.path` export), no `ffmpeg-static` | `resolve("ffprobe")` | `ok:true`, `path` read from `.path`; not dependent on ffmpeg-static |
| E14 | static-npm dual export | decision-table | L1 | automated | pkg exports bare string \| pkg exports `{path}` | static-npm strategy | both yield the binary path string |
| E15 | ensureTools report | state | L1 | automated | required tool absent, no autoInstall | `ensureTools` | entry `action:"blocked"`, `EnsureReport.ok:false`, NO throw |
| E16 | ensureTools optional | state | L1 | automated | optional tool absent | `ensureTools` | entry `action:"degraded"`; `ok` not set false |
| E17 | ensureTools present | state | L1 | automated | all tools present | `ensureTools` | every entry `action:"present"`, `ok:true` |
| E18 | Source: path invariant | BVA | L1 | automated | binary tool resolves ok | `resolve` | `path` absolute |
| E19 | Source: env null path | BVA | L1 | automated | env tool resolves ok | `resolve` | `path:null` accepted (not a violation) |
| E20 | Source: docker ref path | BVA | L1 | automated | docker-image tool resolves ok | `resolve` | `path`=non-fs image ref accepted |
| E21 | Source: bundled regression | state | L1 | automated | bundled-node succeeds for `node` | `resolve("node")` | `source:"bundled"` (unchanged) |
| E22 | Source: new sources | decision-table | L1 | automated | static-npm succeeds \| probe succeeds | classify | `"static-npm"` \| `"probe"`; never mislabelled `"system"` |
| E23 | installHints requiresConfirm | EP | L1 | automated | chromium def with network hint | `list()` | `chromium` hint carries `requiresConfirm:true` |
| E24 | installHints opaque | invariant | L1 | automated | tool with vs without `installHints` | `resolve` | `ok/path/source/tried` identical; `installHints` absent from `Resolution` |
| E25 | skill tool surfacing | EP | L1 | automated | skill `pi.tools:[{id:"ffmpeg"}]` loaded | `registry.list()` / `GET /api/tools` | `ffmpeg` row present with `Resolution` + `installHints` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | env probe absent | fault-injection | L1 | automated | `SONIOX_API_KEY` unset | resolve env tool | `ok:false`; recommendation names the var + url only, no value |
| X2 | docker-image absent | fault-injection (abort) | L1 | automated | injected docker runner: daemon unavailable / image missing | resolve docker tool | `ok:false` + reason in `tried[]`; never assumes docker; `installHints` recommended |
| X3 | pw-browser absent | fault-injection | L1 | automated | Playwright cache missing chromium | resolve `chromium` | `ok:false` + `installHints` (`npx playwright install chromium`) |
| X4 | CLI ensure exit code | state | L2 | automated | pkg `pi.tools` with a missing REQUIRED tool | run TS `ensure` CLI | exit non-zero; `--json` invocation exits 0 with outcome encoded |
| X5 | opt-in default recommend | decision | L1 | automated | missing tool, `ensureTools` WITHOUT `autoInstall` | ensure | `action:"recommended"`; zero install commands executed (exec spy uncalled) |
| X6 | opt-in first-party only | fault-injection | L1 | automated | missing tool, `autoInstall:true`, manifest tries to inject a string | ensure | executed command originates from registry `installHints` def; manifest string never executed |
| X7 | requiresConfirm denied | decision | L1 | automated | `requiresConfirm` hint, `autoInstall:true`, confirm-callback→false | ensure | command NOT executed |
| X8 | requiresConfirm non-interactive | state-transition | L2 | automated | `ensure --install` on headless host (no TTY), missing required tool with `requiresConfirm` hint | run CLI | hint auto-denied; entry `action:"blocked"`; process exit non-zero (optional tool → `degraded`, exit 0) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | skill tool renders in Settings→Tools | state-transition | L3 | automated | a skill-declared tool that resolves `ok:false` with `installHints[hostOs]` | open Settings→Tools in the docker-harness UI | row renders identically to a built-in missing tool: `[Install ▾]` dropdown present, lists host-OS `commands` |

### Performance

None — the delta declares no latency/throughput/memory threshold (resolution is
cached by the existing registry; no new perf budget). No perf scenario is
fabricated without a spec threshold.

---

## Coverage summary

- Requirements covered: all 9 ADDED + 3 MODIFIED tool-registry requirements
- Scenarios by class: edge 25 · perf 0 · frontend 1 · error 8
- Scenarios by level: L1 30 · L2 3 · L3 1
- Scenarios by disposition: automated 34 · manual-only 0

## New infra needed

- none — L1 vitest, L2 process/CLI smoke, and L3 Playwright (docker harness,
  derived `dashboardPort` from `.pi-test-harness.json`) all exist.
