# Test Plan — add-photocraft-plugin

Stage: design   Generated: 2026-10-12 (rev 2: spike round 3 — S1–S5)

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
| E19 | cli › mcp rejects other options | EP | L1 | automated | `--automation-read-root /`, `--bridge 127.0.0.1:1`, `--control-token x`; `--help` | `mcp` | the three → usage error, exit 1, spawn spy not called; `--help` → usage, exit 0, spawn spy not called |
| E20 | cli › register file states | decision-table | L1 | automated | `.pi/mcp.json` absent / has `filesystem`+`docs` / has old `photocraft` / malformed; plus a cwd with neither `.git` nor `.pi/` | `mcp --register` in cwd `/tmp/p` (contains `.git`) | created with only `photocraft` / both kept + added / replaced / file byte-identical + exit 1; entry `command` = `process.execPath`, `args` = [absolute `bin/pi-photocraft` launcher, `mcp`] (no `--root`); stderr mentions machine-specific paths, project trust and starting pi in the project root; no-marker cwd → entry written + "does not look like a project root" warning |
| E21 | cli › no implicit registration | EP | L1 | automated | project dir without `.pi/mcp.json` | `ensure`, `exec --version`, `mcp` (stub) | `.pi/mcp.json` still absent |
| E22 | cli › manifest entry | EP | L1 | automated | `RECOMMENDED_EXTENSIONS` | load | contains id `@blackbelt-technology/pi-dashboard-photocraft`, `status:"optional"`, npm source, unlocks skill + CLI (extends `packages/shared/src/__tests__/recommended-extensions.test.ts`) |
| E23 | cli › skill shipped | EP | L1 | automated | `packages/photocraft/package.json` + `npm pack --dry-run` file list | packaging test | `pi.skills[0]` dir exists with `SKILL.md` frontmatter `name`/`description` (description mentions PhotoCraft + nano-banana); file is in the pack list (exemplar `packages/video-transcription/src/__tests__/packaging.test.ts`) |
| E24 | region › argument validation | decision-table + BVA | L1 | automated | two selectors; no selector; `--pad 23 --feather 8`; `--pad 24 --feather 8`; `--pad -1`; `--min-crop 0`; `--rect 0,0,0,10`; `--rect 1.5,0,10,10`; `--rect -5,-5,10,10`; `--out` = symlink to input | parse+validate | all invalid → exit 1 with provisioner spy uncalled; `--pad 24 --feather 8` and `-5,-5` rect accepted |
| E25 | region › crop geometry | BVA | L1 | automated | region `100,50,120,100`, image 320×200, pad 24, min-crop 1; region 42×8 in 2000×2000 defaults; region at `0,0,20,20` pad 32; image 200×150 min-crop 256 | `computeCrop` | `76,26,168,148`; ≥256×256 containing padded region; clipped to 0,0 and contains region; `0,0,200,150` |
| E26 | region › bounds normalisation | EP | L1 | automated | `[84,34,236,166]` corner form; `[139,96,42,8]` xywh form | normalise helpers | `{x:84,y:34,w:152,h:132}`; `{x:139,y:96,w:42,h:8}`; round-trip identity |
| E27 | region › composite command list | decision-table | L1 | automated | injected runner recording argv, generator returning 304×264; variants: `--rect` default mask, `--select object:100,50,120,100` default mask, `--select object:…` + `--mask selection`, `--rect` + `--mask selection` | pipeline | all: resize run targets crop w/h, `file.placeEmbedded{fit:false,scale:100,center:crop centre}`, `layer.layerMask.revealSelection`; default mask → `select.rect` = crop inset by pad−feather with `feather`; selection+select → composite run starts `select.object`, `select.saveSelection{name:"pc_region"}`, `select.deselect` and masks with `select.loadSelection{channel:"pc_region"}` + `select.modify.feather`; selection+rect → `select.rect{region,feather}` |
| E28 | region › success report + temp lifecycle | EP | L1 | automated | gemini backend result without `model`; default flags vs `--keep-temp` | pipeline success | stdout one JSON with keys `region crop backend model out layered timings`, `model:null`, `layered:null`; temp dir under `os.tmpdir()` gone vs kept |
| E29 | region › locality (real) | invariant | L1-real | automated | PNG fixture 320×200, `--rect 100,50,120,100 --pad 32 --feather 8`, stub generator = invert | `replace-region` | 0 pixels differ outside crop box; >95 % of rect pixels differ |
| E30 | region › generator resolution (real) | EP | L1-real | automated | crop `84,34,152,132` (rect `100,50,120,100 --pad 16 --feather 5 --min-crop 1`), stub generator returns 2× size, `--layered out.psd` | `replace-region` then `info out.psd` | patch layer bounds = `[84,34,236,166]` (corner form) |
| E31 | region › layered output (real) | invariant | L1-real | automated | as E30 | `info` + `convert out.psd flat.png` | 2 layers, patch `hasMask:true`; `flat.png` pixel-equal to `--out` |
| E32 | region › semantic selector (real) | EP | L1-real | automated | fixture with one high-contrast object, `--select object:<hint>` | `replace-region` | succeeds; reported `region` = probe bounds; 0 px differ outside crop |
| E33 | mcp › real server through wrapper | invariant | L1-real | automated | wrapper with `--root <tmp>` | `initialize`, `tools/list` | server name `photocraft`; tool names include `doc_open`, `command_run`, `doc_save` |
| E34 | mcp › root confinement (real) | EP | L1-real | automated | `--root <tmp>`; file inside and outside root | `doc_open` each | inside → success; outside → tool error mentioning the path |
| E35 | provisioning › genuine archive passes the guard (real) | EP | L1-real | automated | latest real asset for the host | `ensure` on empty `PHOTOCRAFT_HOME` | resolves; report `cacheHit:false`; no traversal false-positive; binary `--version` exit 0 |
| E36 | install per OS | EP | L2 | automated | fresh VM HOME, `npm install` of the packed package; OS ∈ {macOS arm64, macOS x64, Linux x86_64, Windows x64}; `NODE_OPTIONS` empty | `pi-photocraft --help`, `pi-photocraft ensure` twice, `exec --version`, `exec run --new '{"width":64,"height":64}' --out x.png`, `mcp` initialize/tools/list via stdin | `--help` exit 0 (bin runs without a TS loader); 1st report `cacheHit:false`, 2nd `cacheHit:true`; `--version` starts `photocraft-cli `; `x.png` exists; MCP tool list non-empty; macOS adds a `gatekeeper` field; no desktop executable in the cache dir; script `44-photocraft.sh` (macOS/Linux) and `.ps1` (Windows), exemplar `qa/tests/09-image-fit-extension.sh` |
| E37 | install › macOS x64 runs native slice | EP | L2 | automated | macOS x64 VM (`make test-macos-x86`) | `exec --version` + `sysctl -n sysctl.proc_translated` + `uname -m` | `uname -m` = `x86_64`, not translated, version printed (proves the universal zip's Intel slice executes) |
| E38 | region › crop-mask inset geometry | BVA | L1 | automated | crop `517,537,256,256` pad 32 feather 8 image 1024²; crop clipped at left/top (`0,0,200,200`, region at `10,10,…`) | `computeMask` | `541,561,208,208`; clipped sides get inset 0 → `0,0,176,176` |
| E39 | region › different-shape replacement shown whole (real) | invariant | L1-real | automated | PNG 1024² with a 182×182 disc at `554,574`; `--select object:540,560,210,210`; stub generator returns the crop with a larger disc (radius 120 px at crop scale) in another colour | `replace-region` (default mask) | every pixel inside the inset rect eroded by 3×feather (`565,585,160,160`) equals the patch (diff ≤ 1); no original-colour pixel remains inside the inset rect; 0 px differ outside the crop |
| E40 | region › selection mask opt-in (real) | invariant | L1-real | automated | as E39 but stub generator only recolours the original disc; `--mask selection` | `replace-region` | pixels inside the crop farther than 3×feather from the selection outline and outside it are identical to the input; disc pixels changed |
| E41 | provisioning › linux C library gate | decision-table | L1 | automated | injected platform linux with report `glibcVersionRuntime` = `2.31` / absent (musl) / `2.35` / `2.36`; fetch spy | `provision()` | 2.31 and musl → fail before any fetch, error names `glibc 2.31`/`musl`, `≥ 2.35`, `PHOTOCRAFT_BIN`; 2.35 and 2.36 proceed |
| E42 | region › generator subprocess | EP | L1 | automated | injected `execFileAsync` spy; options `--model gemini-3-pro-image --flash --backend pi`; second run spy exits 1 with stderr `✗ no key` | `replace-region` generate step | argv = [`process.execPath`, resolved `…/pi-dashboard-nano-banana/bin/pi-nano-banana`, prompt, `--file`, crop path, `--output`, gen path, `--model`, `gemini-3-pro-image`, `--flash`, `--backend`, `pi`]; failure → exit 1, message names `generate` and contains `no key` |
| E43 | cli › photocraft bin runs from an npm install | EP | L1 | automated | `npm pack` of packages/photocraft (prepack builds `dist`), tarball extracted to `<tmp>/node_modules/@blackbelt-technology/pi-dashboard-photocraft/` | `node <that>/bin/pi-photocraft --help`, then `PHOTOCRAFT_BIN=<stub printing a version> node <that>/bin/pi-photocraft ensure`, both with `NODE_OPTIONS=''` | `--help` exit 0; `ensure` exit 0 with a JSON report `source:"override"` (exercises the bundled shared `platform/exec` code); neither shows `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` / `ERR_MODULE_NOT_FOUND` (exemplar `packages/video-transcription/src/__tests__/packaging.test.ts`) |
| E44 | nano-banana › bin runs from an npm install | EP | L1 | automated | `npm pack` of packages/nano-banana, extracted under `<tmp>/node_modules/@blackbelt-technology/pi-dashboard-nano-banana/` | `node <that>/bin/pi-nano-banana` (no args), `NODE_OPTIONS=''` | exit 1 with the `usage: pi-nano-banana "<prompt>"` line on stderr, no module-loading error |
| E45 | cli + nano-banana › workspace bins run | EP | L1 | automated | monorepo checkout after `pnpm install` | `node_modules/.bin/pi-photocraft --help`; `node_modules/.bin/pi-nano-banana` | exit 0 with usage; exit 1 with the nano-banana usage line |
| E46 | provisioning › desktop executable removed + listing pairing | EP | L1 | automated | fixture tarball with `bin/photocraft-cli` + `bin/photocraft`; fixture where `tar -tf` and `tar -tvf` line counts differ (entry name containing a newline) | `provision()` | first: `<ver>/…/bin/photocraft` absent, CLI present; second: rejected before extraction |
| E47 | region › nano-banana launcher resolution in an installed layout | EP | L1 | automated | fake tree `<tmp>/node_modules/@blackbelt-technology/pi-dashboard-photocraft/dist/photocraft.js` (resolver entry) + `<tmp>/node_modules/@blackbelt-technology/pi-dashboard-nano-banana/package.json` with `bin.pi-nano-banana = "bin/pi-nano-banana"` | `resolveNanoBananaLauncher(<dist file URL>)`; same from the checkout `src/` | installed → `<tmp>/node_modules/@blackbelt-technology/pi-dashboard-nano-banana/bin/pi-nano-banana`; checkout → `packages/nano-banana/bin/pi-nano-banana`; missing package → error naming the package |
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

- Requirements covered: 20/20 (provisioning 6, entry point 8, region-replace 5, nano-banana-cli-entrypoint 1 → every requirement has ≥1 row; skill requirement also gets the M1 judgement)
- Scenarios by class: edge 47 · perf 0 · frontend 3 · error 15 · manual 1
- Scenarios by level: L1 53 · L1-real 10 · L2 2 · — 1
- Scenarios by disposition: automated 65 · manual-only 1

## New infra needed

- Local HTTP fixture server for GitHub API + release assets (vitest helper in `packages/photocraft/src/__tests__/helpers/`), including crafted hostile archives generated at test time.
- `PHOTOCRAFT_E2E` gate for L1-real (pattern exists: `describe.skipIf`).
- `qa/tests/44-photocraft.sh` + `.ps1` (new scripts in the existing VM matrix; macOS x64 via `make test-macos-x86`).
