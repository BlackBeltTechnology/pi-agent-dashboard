# Test Plan — add-photocraft-plugin

Stage: design   Generated: 2026-10-12

Levels used here:
- **L1** = vitest under `packages/photocraft/src/__tests__/`, with injected seams (fetch, clock, env, runner, generator, spawn).
- **L1-real** = vitest gated with `describe.skipIf(!process.env.PHOTOCRAFT_E2E)` (exemplar `packages/deck3d/src/__tests__/e44-one-shot-build.test.ts:30`). It runs against a real provisioned `photocraft-cli` and a stub generator, never Gemini. It runs locally and on demand, and is skipped in normal CI.
- **L2** = `qa/tests/44-photocraft.sh` + `qa/tests/44-photocraft.ps1` in the VM matrix, covering macOS arm64, macOS x64, Linux x86_64 and Windows x64.

User decisions (gate answers):
- Real-binary scenarios run in both L1-real (pipeline, locality, MCP) and L2 (install per OS).
- L2 OS set is macOS arm64, macOS x64, Linux x86_64 and Windows x64.

No performance requirement exists in the specs, so there are no performance rows; no thresholds were invented.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | provisioning › version resolution | decision-table | L1 | automated | `PHOTOCRAFT_BIN` = executable stub file; fetch spy | `provision()` | returns that path; fetch spy called 0 times; cache dir untouched |
| E2 | provisioning › override not executable | decision-table | L1 | automated | `PHOTOCRAFT_BIN` = (a) missing path (b) directory (c) file mode 0644 | `provision()` | rejects; message contains `PHOTOCRAFT_BIN`, the path and reason (`not found`/`not a file`/`not executable`); no fetch |
| E3 | provisioning › pinned version | EP | L1 | automated | `PHOTOCRAFT_VERSION` = `v0.7.0`, then `0.7.0` | `provision()` against fixture server | both request `/releases/tags/v0.7.0` assets with asset version `0.7.0`; `/releases/latest` never requested |
| E4 | provisioning › latest cache 24 h | BVA | L1 | automated | `latest.json` checkedAt = now−23h59m / now−24h / now+1h / invalid JSON | `provision()` with fake clock | API calls: 0 / 1 / 1 / 1 |
| E5 | provisioning › GITHUB_TOKEN | EP | L1 | automated | `GITHUB_TOKEN=abc` set vs unset | latest lookup | request carries `Authorization: Bearer abc` only when set |
| E6 | provisioning › host→asset table | decision-table | L1 | automated | every (os, arch) row of the spec table + `linux/s390x` | `assetFor(os, arch, "0.7.0")` | exact asset names per table; s390x throws naming `linux`, `s390x`, `PHOTOCRAFT_BIN` |
| E7 | provisioning › SHA256SUMS parse | EP | L1 | automated | sums lines: `<h>  name`, `<h> *name`, `<h>  ./name`, CRLF line, duplicate entry, no entry | verify against matching digest | first four accepted; duplicate and missing rejected, nothing written to `<ver>/` |
| E8 | provisioning › binary lookup | decision-table | L1 | automated | fixture trees: known path present; known path absent + one basename match; plus a `__MACOSX/` copy; two matches | locate binary | known path; fallback match; `__MACOSX` ignored; two matches → error naming asset, staging removed |
| E9 | provisioning › cache hit + damaged entry | state-transition | L1 | automated | `<ver>/` with valid binary / missing binary / 0-byte binary / mode 0644 | `provision()` | valid → no fetch, `cacheHit: true`; the three damaged states → entry removed, re-downloaded, `cacheHit: false` |
| E10 | provisioning › headless only | EP | L1 | automated | fixture release listing every installer format | `provision()` on each mapped host | fixture server request log contains only the API path(s), the mapped archive and `SHA256SUMS.txt` |
| E11 | provisioning › report | EP | L1 | automated | fresh install of 0.7.0; override with stub printing `photocraft-cli 0.7.0 (…)` | `ensure` | JSON has `version:"0.7.0"`, `source:"latest"`, asset name, `cacheHit:false`, absolute `binary`, numeric `durationMs`; override → `source:"override"`, `asset:null`, `version:"0.7.0"` |
| E12 | provisioning › macOS gatekeeper advisory | decision-table | L1 | automated | injected `spctl` result accepted / rejected, platform darwin | `provision()` | `gatekeeper` recorded both times; rejected → stderr warning, still resolves |
| E13 | cli › dispatch + exit codes | EP | L1 | automated | args `[]`, `["frobnicate"]` | run CLI main | usage listing `ensure path exec mcp replace-region` on stderr; exit 1 |
| E14 | cli › path output | EP | L1 | automated | provisioner resolves `/abs/photocraft-cli` | `path` | stdout exactly `/abs/photocraft-cli\n` |
| E15 | cli › exec argv verbatim | EP | L1 | automated | stub binary that echoes argv as JSON | `exec run in.png --cmd x --params '{"radius":3}' --out "out file.png"` | stub received `--params` = `{"radius":3}` and `--out` = `out file.png` as single elements |
| E16 | cli › exec streaming | BVA | L1 | automated | stub writes 12 MB to stdout | `exec` | captured stdout length = 12 MB exactly; exit 0 |
| E17 | cli › exec exit propagation | EP | L1 | automated | stub exits 0 / 1 / 3 | `exec` | wrapper exits 0 / 1 / 3 |
| E18 | cli › mcp root translation | EP | L1 | automated | cwd `/tmp/p`, no `--root`; then `--root /tmp/q` | `mcp` with spawn spy | spawn argv = `mcp --automation-read-root R --automation-write-root R` with R = `/tmp/p` then `/tmp/q`; stderr names R |
| E19 | cli › mcp rejects other options | EP | L1 | automated | `--automation-read-root /`, `--bridge 127.0.0.1:1`, `--control-token x` | `mcp` | usage error, exit 1, spawn spy not called |
| E20 | cli › register file states | decision-table | L1 | automated | `.pi/mcp.json` absent / has `filesystem`+`docs` / has old `photocraft` / malformed | `mcp --register` in cwd `/tmp/p` | created with only `photocraft` / both kept + added / replaced / file byte-identical + exit 1; entry `command` = `process.execPath`, `args[0]` absolute entry script, rest `mcp --root /tmp/p`; stderr mentions machine-specific + trust |
| E21 | cli › no implicit registration | EP | L1 | automated | project dir without `.pi/mcp.json` | `ensure`, `exec --version`, `mcp` (stub) | `.pi/mcp.json` still absent |
| E22 | cli › manifest entry | EP | L1 | automated | `RECOMMENDED_EXTENSIONS` | load | contains id `@blackbelt-technology/pi-dashboard-photocraft`, `status:"optional"`, npm source, unlocks skill + CLI (extends `packages/shared/src/__tests__/recommended-extensions.test.ts`) |
| E23 | cli › skill shipped | EP | L1 | automated | `packages/photocraft/package.json` + `npm pack --dry-run` file list | packaging test | `pi.skills[0]` dir exists with `SKILL.md` frontmatter `name`/`description` (description mentions PhotoCraft + nano-banana); file is in the pack list (exemplar `packages/video-transcription/src/__tests__/packaging.test.ts`) |
| E24 | region › argument validation | decision-table + BVA | L1 | automated | two selectors; no selector; `--pad 23 --feather 8`; `--pad 24 --feather 8`; `--pad -1`; `--min-crop 0`; `--rect 0,0,0,10`; `--rect 1.5,0,10,10`; `--rect -5,-5,10,10`; `--out` = symlink to input | parse+validate | all invalid → exit 1 with provisioner spy uncalled; `--pad 24 --feather 8` and `-5,-5` rect accepted |
| E25 | region › crop geometry | BVA | L1 | automated | region `100,50,120,100`, image 320×200, pad 24, min-crop 1; region 42×8 in 2000×2000 defaults; region at `0,0,20,20` pad 32; image 200×150 min-crop 256 | `computeCrop` | `76,26,168,148`; ≥256×256 containing padded region; clipped to 0,0 and contains region; `0,0,200,150` |
| E26 | region › bounds normalisation | EP | L1 | automated | `[84,34,236,166]` corner form; `[139,96,42,8]` xywh form | normalise helpers | `{x:84,y:34,w:152,h:132}`; `{x:139,y:96,w:42,h:8}`; round-trip identity |
| E27 | region › composite command list | EP | L1 | automated | `--select object:100,50,120,100`, injected runner recording argv, generator returning 304×264 | pipeline | resize run targets crop w/h; composite run contains in order `select.object`, `select.saveSelection{name:"pc_region"}`, `select.deselect`, `file.placeEmbedded{fit:false,scale:100,center:crop centre}`, `select.loadSelection{channel:"pc_region"}`, `select.modify.feather`, `layer.layerMask.revealSelection`; `--rect` variant uses `select.rect{feather}` |
| E28 | region › success report + temp lifecycle | EP | L1 | automated | gemini backend result without `model`; default flags vs `--keep-temp` | pipeline success | stdout one JSON with keys `region crop backend model out layered timings`, `model:null`, `layered:null`; temp dir under `os.tmpdir()` gone vs kept |
| E29 | region › locality (real) | invariant | L1-real | automated | PNG fixture 320×200, `--rect 100,50,120,100 --pad 32 --feather 8`, stub generator = invert | `replace-region` | 0 pixels differ outside crop box; >95 % of rect pixels differ |
| E30 | region › generator resolution (real) | EP | L1-real | automated | crop `84,34,152,132` (rect `100,50,120,100 --pad 16 --feather 5 --min-crop 1`), stub generator returns 2× size, `--layered out.psd` | `replace-region` then `info out.psd` | patch layer bounds = `[84,34,236,166]` (corner form) |
| E31 | region › layered output (real) | invariant | L1-real | automated | as E30 | `info` + `convert out.psd flat.png` | 2 layers, patch `hasMask:true`; `flat.png` pixel-equal to `--out` |
| E32 | region › semantic selector (real) | EP | L1-real | automated | fixture with one high-contrast object, `--select object:<hint>` | `replace-region` | succeeds; reported `region` = probe bounds; 0 px differ outside crop |
| E33 | mcp › real server through wrapper | invariant | L1-real | automated | wrapper with `--root <tmp>` | `initialize`, `tools/list` | server name `photocraft`; tool names include `doc_open`, `command_run`, `doc_save` |
| E34 | mcp › root confinement (real) | EP | L1-real | automated | `--root <tmp>`; file inside and outside root | `doc_open` each | inside → success; outside → tool error mentioning the path |
| E35 | provisioning › genuine archive passes the guard (real) | EP | L1-real | automated | latest real asset for the host | `ensure` on empty `PHOTOCRAFT_HOME` | resolves; report `cacheHit:false`; no traversal false-positive; binary `--version` exit 0 |
| E36 | install per OS | EP | L2 | automated | fresh VM HOME, `npm install` of the packed package; OS ∈ {macOS arm64, macOS x64, Linux x86_64, Windows x64} | `pi-photocraft ensure` twice, `exec --version`, `exec run --new '{"width":64,"height":64}' --out x.png`, `mcp` initialize/tools/list via stdin | 1st report `cacheHit:false`, 2nd `cacheHit:true`; `--version` starts `photocraft-cli `; `x.png` exists; MCP tool list non-empty; macOS adds a `gatekeeper` field; script `44-photocraft.sh` (macOS/Linux) and `.ps1` (Windows), exemplar `qa/tests/09-image-fit-extension.sh` |
| E37 | install › macOS x64 runs native slice | EP | L2 | automated | macOS x64 VM (`make test-macos-x86`) | `exec --version` + `sysctl -n sysctl.proc_translated` + `uname -m` | `uname -m` = `x86_64`, not translated, version printed (proves the universal zip's Intel slice executes) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | cli › mcp serialization | state-transition | L1 | automated | stub server that answers `tools/call` after 200 ms, records arrival order | client writes `initialize`, `tools/call#1 doc_open`, `tools/call#2 command_run`, `notifications/x` back-to-back | `initialize` and the notification reach the server immediately; `#2` arrives only after `#1`'s response was emitted; client receives both responses with matching ids |
| F2 | cli › mcp serialization (real) | state-transition | L1-real | automated | real server through wrapper, fixture PNG under root | pipelined `doc_open` + `command_run{image.adjustments.invert}` without awaiting | `command_run` result is not an error (not "no document open") |
| F3 | cli › non-JSON server stdout | invariant | L1 | automated | stub server prints `warning: x` then a JSON response | proxy running | client stdout contains only the JSON line; `warning: x` on stderr |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | provisioning › fallback-installed | fault-injection (abort) | L1 | automated | latest API → 403; cache holds `0.6.0`, `0.7.0`, `0.10.0` | `provision()` | uses `0.10.0` (semver, not lexical); `source:"fallback-installed"`; stderr warning names 403 and `0.10.0` |
| X2 | provisioning › empty cache + offline | fault-injection (abort) | L1 | automated | latest API → network error; empty cache | `ensure` | exit 69; stderr names error and suggests `GITHUB_TOKEN` / `PHOTOCRAFT_VERSION` / `PHOTOCRAFT_BIN` |
| X3 | provisioning › asset missing | fault-injection | L1 | automated | release JSON without mapped asset | `provision()` | error names tag `v0.7.0` and expected asset name |
| X4 | provisioning › digest mismatch | fault-injection (corrupt) | L1 | automated | served asset bytes ≠ sums digest | `provision()` | error shows expected + actual digest; no `<ver>/`; no staging left |
| X5 | provisioning › sums unavailable | fault-injection (abort) | L1 | automated | `SHA256SUMS.txt` → 404 | `provision()` | fails; nothing in `<ver>/`; no staging left |
| X6 | provisioning › hostile archive | fault-injection (malicious) | L1 | automated | crafted tar.gz with `../../x`; with `/etc/x`; with symlink; with hardlink; crafted zip with symlink | `provision()` | aborts before extraction; no file created outside staging; no `<ver>/`; staging removed |
| X7 | provisioning › concurrent install | fault-injection (race) | L1 | automated | two child processes provisioning same version against slow fixture server, empty cache | run both | both exit 0 with same binary path; one `<ver>/`; no `.staging-*` left |
| X8 | provisioning › interrupted download | fault-injection (abort mid-stream) | L1 | automated | fixture server closes socket at 50 % | `provision()` then `provision()` again | first fails, no `<ver>/`, own staging removed; second downloads fully |
| X9 | provisioning › stale staging sweep | BVA | L1 | automated | `.staging-*` dirs aged 59 min and 61 min | `provision()` | 61-min dir removed, 59-min dir kept |
| X10 | cli › provisioning failure on mcp | fault-injection | L1 | automated | provisioner throws | `mcp` | stdout empty (0 bytes); error on stderr; exit 69 |
| X11 | cli › signal handling | fault-injection (signal) | L1 | automated | stub long-running server | send SIGTERM / SIGINT to wrapper | child terminated; wrapper exits 143 / 130 |
| X12 | region › rect outside image | fault-injection | L1 | automated | image 320×200, `--rect 400,300,10,10`; separately provisioner throws | `replace-region` | exit 1 naming rect + `320×200`, generator spy uncalled; provisioner failure → exit 69 |
| X13 | region › empty selection | fault-injection | L1 | automated | probe result `{"selected":false,"coverage":0}`; separately bounds `[0,0,0,0]` | `replace-region --select sky` | exit 1 "nothing was selected"; generator spy uncalled |
| X14 | region › generator failure | fault-injection (abort) | L1 | automated | generator returns `{ok:false,error:"no key"}`; pre-existing `--out` file with known bytes | `replace-region` | exit 1, message names generate step; `--out` bytes unchanged; input unchanged; no new files beside `--out` |
| X15 | region › late composite failure | fault-injection (abort) | L1 | automated | runner fails on composite run after successful generation; `--layered` set; no pre-existing outputs | `replace-region` | exit 1 naming composite step; neither `--out` nor `--layered` exists; temp dir removed |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | cli › shipped skill (recipes) | exploratory | — | manual-only | real photo, real Gemini key, pi session with the package | ask the agent "replace the sky with a sunset" | [judgment: agent follows the skill (replace-region or recipe) and the result looks seamless — no automatable observable] |

---

## Coverage summary

- Requirements covered: 18/18 (provisioning 6, entry point 7, region-replace 5 → every requirement has ≥1 row; skill requirement also gets the M1 judgement)
- Scenarios by class: edge 37 · perf 0 · frontend 3 · error 15 · manual 1
- Scenarios by level: L1 45 · L1-real 8 · L2 2 · — 1
- Scenarios by disposition: automated 55 · manual-only 1

## New infra needed

- Local HTTP fixture server for GitHub API + release assets (vitest helper in `packages/photocraft/src/__tests__/helpers/`), including crafted hostile archives generated at test time.
- `PHOTOCRAFT_E2E` gate for L1-real (pattern exists: `describe.skipIf`).
- `qa/tests/44-photocraft.sh` + `.ps1` (new scripts in the existing VM matrix; macOS x64 via `make test-macos-x86`).
