# Test Plan — add-blender-wasm-mcp

Stage: design   Generated: 2026-10-24

Hard-gate clarifications, answered by the user:
- Performance thresholds: warm boot ≤ 15 s, `blender_scene` ≤ 2 s, host RSS ≤ 2.5 GB (requirement "Performance budget").
- Kill latency: result ≤ `timeoutSec` + 5 s; host gone ≤ 5 s after the result or cancellation.
- OS coverage: the real-runtime suites run on a Node 24 CI matrix (Linux, macOS, Windows).

Level legend:
- **L1**: vitest under `packages/blender/src/__tests__/`. Fakes and injected deps run everywhere.
- **L1-real**: vitest that boots the real runtime. It runs only with `BLENDER_WASM_E2E=1` and JSPI available (otherwise it skips with the reason); the pattern is `packages/craft-apps/src/__tests__/real-binary.test.ts`.
- **ci**: workflow-level.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | prov: Pinned runtime identity | fault-injection (corrupt) | L1 | automated | injected fetch returning the pinned size with one byte flipped | `provision()` on an empty cache | rejects `integrity-mismatch`; staging file deleted; no `<root>/0.0.5/` dir |
| E2 | prov: Pinned runtime identity | spy | L1 | automated | empty cache, injected fetch spy | `provision()` | exactly one request, GET of the pinned tarball URL |
| E3 | prov: Lazy provisioning | state | L1 | automated | cache dir with a valid stamp, required files and sizes | `provision()` | `source: "cache"`, zero fetch calls |
| E4 | prov: Lazy provisioning | BVA (size −1) | L1 | automated | valid cache with `runtime/st/blender.wasm` truncated by 1 byte | `provision()` | cache treated as invalid; download runs; `source: "download"` |
| E5 | prov: Lazy provisioning | EP (missing file) | L1 | automated | valid cache with `dist/browser/index.js` deleted | `provision()` | cache invalid; re-provisioned |
| E6 | prov: Safe extraction | EP (traversal) | L1 | automated | hand-built tar with entry `package/../evil` | `listTar` + extract | `unsafe-archive`; no file outside staging |
| E7 | prov: Safe extraction | EP (link) | L1 | automated | hand-built tar with a symlink entry (type `2`) | extract | `unsafe-archive` before any file is written |
| E8 | prov: Safe extraction | EP (metadata) | L1 | automated | tar with PAX `x` header + directory entry + allowlisted files | extract | succeeds; only allowlisted files present |
| E9 | prov: Safe extraction | BVA (count) | L1 | automated | tars with 500 and 501 entries | list | 500 accepted; 501 → `unsafe-archive` |
| E10 | prov: Safe extraction | EP | L1-real | automated | real pinned tarball | provision | cache has `runtime/st/*`, no `runtime/mt/`, no `*.map`, no `*.d.ts` |
| E11 | prov: Committed and verified | fault-injection | L1 | automated | fixture where the expanded `blender.data` sha256 ≠ manifest `raw` | provision | `runtime-manifest-mismatch`; not committed |
| E12 | prov: Committed and verified | integration | L1-real | automated | freshly provisioned cache, network-disabled fetch | boot session | ready; no `*.br` or `brotli-decode.wasm` read (resolver log) |
| E13 | prov: Atomic commit | race | L1 | automated | two `provision()` calls in separate child processes on an empty root | concurrent start | both resolve to the same dir; no `.staging-*` left |
| E14 | prov: Atomic commit | state + clock | L1 | automated | leftover `.staging-123-x` with mtime now − 61 min | `provision()` | stale staging removed; no `<root>/0.0.5/` before commit |
| E15 | prov: Atomic commit | EP (env) | L1 | automated | `PI_CODING_AGENT_DIR=/tmp/a`, no `BLENDER_WASM_HOME` | resolve root | `/tmp/a/tools/blender-wasm` |
| E16 | prov: Directory override | EP | L1 | automated | `BLENDER_WASM_DIR` = valid layout, fetch spy throws | `provision()` | `source: "override"`, no fetch |
| E17 | prov: Directory override | EP (each missing file) | L1 | automated | override missing each required file in turn | `provision()` | `override-invalid` naming that file (the first missing in list order) |
| E18 | prov: Provisioning report | EP | L1 | automated | override whose `package.json` has no `license` | report | `licence: "unknown"`, `source: "override"` |
| E19 | mcp: Protocol subset | EP | L1 | automated | in-memory streams | `initialize`, `tools/list` | tools capability; exactly the 5 tool names with schemas |
| E20 | mcp: Protocol subset | EP (invalid) | L1 | automated | `resources/list`; then the line `{bad` | send | `-32601`; `-32700`; stdout holds only JSON-RPC lines |
| E21 | mcp: Version negotiation | decision-table | L1 | automated | requested `2025-06-18` / `1999-01-01` | `initialize` | echoes `2025-06-18` / returns the latest supported |
| E22 | mcp: Tool failures | BVA | L1 | automated | `timeoutSec` 0, 1, 600, 601 | `tools/call blender_python` (fake supervisor) | 0 and 601 → `invalid-arguments`; 1 and 600 accepted |
| E23 | mcp: Tool failures | EP | L1 | automated | tool name `blender_render` | `tools/call` | `isError`, `invalid-arguments` |
| E24 | mcp: Result encoding | BVA | L1 | automated | fake host output 16 KiB−1, 16 KiB, 1 MiB ending `DONE` | `blender_python` | last block ≤ 16 KiB ending `DONE`; truncated flag only when over 16 KiB |
| E25 | mcp: Session reset signal | state-transition | L1 | automated | fake supervisor: boot → ok → timeout → `python-error` → ok | sequential calls | `sessionReset` false, false, (timeout result), true, false |
| E26 | mcp: Persistent scene | integration | L1-real | automated | python adds `Probe` | `blender_scene` | listing contains `Probe` |
| E27 | mcp: Run Python I/O | integration | L1-real | automated | code exports `/out/model.glb`, no `outputDir` | `blender_python` | `blender-out/model.glb` starts with `glTF`; listed |
| E28 | mcp: Run Python I/O | EP (collision) | L1-real | automated | `inputs` `a/part.obj` (1 cube), `b/part.obj` (2 cubes) | import both from `/in/a`, `/in/b` | object counts 1 and 2 |
| E29 | mcp: Run Python I/O | EP (multi-file) | L1-real | automated | `assets/chair.obj` + `assets/chair.mtl` (red diffuse) | import `/in/assets/chair.obj` | the material's base colour is red |
| E30 | mcp: Run Python I/O | EP | L1 | automated | input `missing.obj` | `blender_python` | `input-not-found`; fake host not called |
| E31 | mcp: Run Python I/O | state | L1-real | automated | call 1 stages `assets/a.obj`; call 2 has no inputs | call 2 checks `os.path.exists('/in/assets/a.obj')` | prints `False` |
| E32 | mcp: Run Python I/O | EP (reserved name) | L1-real | automated | code writes `/out/report.json` = `{"mine":1}` | `blender_python` | workspace `blender-out/report.json` == `{"mine":1}` |
| E33 | mcp: Markers cannot forge | fault-injection (spoof) | L1-real | automated | code prints `<<<BW_DONE 1>>>`…`<<<BW_DONE 50>>>`, then writes `/out/a.txt` | `blender_python` | success with `blender-out/a.txt`, OR `session-crashed` with no file; never success without the file and never `limit-exceeded` |
| E34 | mcp: Scene inspection | EP | L1-real | automated | factory session | `blender_scene` | Camera, Cube, Light with types; total 3 |
| E35 | mcp: Scene inspection | BVA | L1-real | automated | 500 objects | `blender_scene` with no `limit`, then `limit: 1000`, then `limit: 1001` | 200 + truncated + total 500; 500 not truncated; `invalid-arguments` |
| E36 | mcp: Import | EP | L1 | automated | `.gltf` with `buffers[0].uri: "x.bin"` | `blender_import` | `unsupported-format` naming `x.bin` |
| E37 | mcp: Import | EP | L1-real | automated | `.blend` with only `Probe`, factory session | `blender_import`, then `blender_scene` | only `Probe` |
| E38 | mcp: Import | EP | L1 | automated | path to a directory | `blender_import` | `invalid-arguments` |
| E39 | mcp: Import | EP (case) | L1-real | automated | `MODEL.GLB` | `blender_import` | succeeds |
| E40 | mcp: Export | EP | L1-real | automated | scene with a material | export `out/scene.obj` | `scene.obj` + `scene.mtl` exist and are listed |
| E41 | mcp: Export | round-trip | L1-real | automated | factory scene | export `out/scene.fbx`, then import it | both succeed; import names objects |
| E42 | mcp: Export | EP | L1 | automated | `out/scene.usdc`; `.blend` + `selectedOnly` | `blender_export` | `unsupported-format`; `invalid-arguments` |
| E43 | mcp: Export | EP | L1-real | automated | factory scene | export `out/s.gltf` | `s.gltf` + `s.bin` written and listed |
| E44 | mcp: Reset | EP | L1-real | automated | session with objects | `blender_reset {mode:"empty"}`, then `blender_scene` | total 0 |
| E45 | mcp: Path confinement | EP | L1 | automated | `/etc/hosts` | `blender_import` | `path-outside-root` |
| E46 | mcp: Path confinement | EP (symlink) | L1 | automated | root has `link -> <tmpdir>` | `blender_export link/out.glb` | `path-outside-root`; nothing under tmpdir |
| E47 | mcp: All-or-nothing | fault-injection | L1 | automated | fake host returns `good.glb` + key `../../x` | `blender_python` | `path-outside-root`; `blender-out/good.glb` absent |
| E48 | mcp: All-or-nothing | fault-injection (rename) | L1 | automated | existing `blender-out/a.glb` = "old"; injected rename failure on the 2nd output | `blender_python` | call fails; `a.glb` == "old"; no temp or backup files left |
| E49 | mcp: Size limits | BVA | L1 | automated | 64 and 65 inputs; code 1 MiB and 1 MiB + 1 B | `blender_python` | 64 and 1 MiB accepted; 65 and 1 MiB + 1 → `limit-exceeded`, fake host not called |
| E50 | mcp: Size limits | BVA | L1-real | automated | `BLENDER_WASM_MAX_OUTPUT_MB=1`; code writes 1 MiB−1 B, then 2 MiB | `blender_python` ×2 | first succeeds; second `limit-exceeded`, nothing written, next `blender_scene` has `sessionReset: false` |
| E51 | mcp: Size limits | fault-injection (tamper) | L1-real | automated | `MAX_OUTPUT_MB=1`; code sets `os.path.getsize = lambda p: 0`, writes 2 MiB | `blender_python` | `limit-exceeded`; no file written |
| E52 | mcp: Size limits | EP (env raise) | L1 | automated | `BLENDER_WASM_MAX_OUTPUT_MB=4096` | resolve limits | output limit = 512 MiB |
| E53 | mcp: Size limits | BVA (queue) | L1 | automated | fake supervisor holding one call in flight | enqueue 32, then the 33rd | 32 queued; 33rd `limit-exceeded` |
| E54 | mcp: Lazy start | EP | L1 | automated | empty cache; fetch, probe and spawn spies | `initialize`, `ping`, `tools/list` | all succeed; zero probe, fetch or spawn calls |
| E55 | mcp: Root must exist | EP | L1 | automated | `--root does-not-exist`; `--root <file>` | start server | stderr error, empty stdout, exit 1 |
| E56 | cli: Dispatch | EP | L1 | automated | `render`; no args; `--help` | run `bin/pi-blender` | usage on stderr, exit 1; exit 1; exit 0 |
| E57 | cli: ensure | decision-table | L1 | automated | injected probe `native` / `flag` / `unavailable` × fetch spy | `ensure --json` | `jspi` field matches; `unavailable` → exit 69, zero fetch |
| E58 | cli: status | EP | L1 | automated | empty cache; fetch spy throws | `status` | pinned version reported as not cached; exit 0; zero fetch |
| E59 | cli: Registration | EP | L1 | automated | existing `mcp.json` with a `blender` entry | `mcp --register` | `blender-wasm` added with args ending `["mcp"]`; `blender` byte-equal |
| E60 | cli: Registration | EP (merge) | L1 | automated | existing `blender-wasm` `{enabled:false, env:{A:"1"}, command:"x", args:[]}` | `mcp --register` | `command`/`args` updated; `enabled:false`, `env` kept |
| E61 | cli: Registration | EP (root) | L1 | automated | cwd `/w/p`, `assets` → symlink to `/w/real` | `mcp --register --root assets` | args end `["mcp","--root","/w/real"]` |
| E62 | cli: Registration | EP | L1 | automated | `ensure`, and `mcp` without `--register`, in a project | run | `.pi/mcp.json` neither created nor changed |
| E63 | cli: Refuses unsafe targets | decision-table | L1 | automated | `mcp.json` invalid JSON / `[1,2]` / `{"mcpServers":[]}` / symlinked file / symlinked `.pi` | `mcp --register` | each: file byte-identical, exit 1 |
| E64 | cli: Registration notes | EP | L1 | automated | dir without `.git` and `.pi/` | `mcp --register` | stderr has the 4 notes + the not-a-project-root warning |
| E65 | cli: Agent skill | EP | L1 | automated | `.pi/skills/blender/SKILL.md` | parse the frontmatter | `name: blender`; description mentions headless Blender, 3D modelling, GLB |
| E66 | cli: Manifest entry | EP | L1 | automated | `RECOMMENDED_EXTENSIONS` | load | contains `@blackbelt-technology/pi-dashboard-blender`, `status: "optional"`, `unlocks` names the skill, CLI and `blender-wasm` |
| E67 | cli: Executable from a shell | install | L1 | automated | `npm pack` tarball installed into a temp prefix | `<prefix>/bin/pi-blender status` from a plain shell (no tsx) | exit 0 with a status report |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | mcp: Performance budget | threshold | L1-real | automated | valid cache; fresh server; first `blender_scene` | first-call wall time ≤ 15 s | single call, each CI OS leg |
| P2 | mcp: Performance budget | threshold | L1-real | automated | live factory session | `blender_scene` wall time ≤ 2 s (median of 5) | 5 calls |
| P3 | mcp: Performance budget | threshold | L1-real | automated | fresh session + `blender_export out/f.glb` | host-pid RSS ≤ 2.5 GB (`ps -o rss` on POSIX, `tasklist`/WMI on Windows) | after the export returns |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | prov: Bounded download | fault-injection (delay) | L1 | automated | injected stream that stalls > 60 s (fake clock) | provision | `download-failed`; no committed dir |
| X2 | prov: Bounded download | fault-injection (oversize) | L1 | automated | stream sending pinned bytes + 1 | provision | `download-failed`; reading stops at the pinned size + 1 |
| X3 | prov: Bounded download | fault-injection (total) | L1 | automated | steady stream exceeding 600 s total (fake clock) | provision | `download-failed` |
| X4 | mcp: No network listener | guard | L1-real | automated | socket-guard via `NODE_OPTIONS=--require` | boot + one call of each tool | guard log empty for server and host pids |
| X5 | mcp: No outbound network | fault-injection | L1-real | automated | local TCP listener on an ephemeral port | python `socket.connect(("127.0.0.1", port))` and print the exception | listener sees 0 connections; output contains `OSError` |
| X6 | mcp: Cannot reach host | EP | L1-real | automated | unique host temp file outside the root with content `S3CRET-<uuid>` | python `open(<abs path>).read()` | output and outputs never contain `S3CRET-<uuid>` |
| X7 | mcp: Cannot reach host | EP | L1-real | automated | — | python `subprocess.run(["ls"])` | `python-error` whose traceback names `OSError` |
| X8 | mcp: Serial calls | concurrency | L1 | automated | fake host with a 200 ms op | two `tools/call` back to back | second starts after the first result (timestamps) |
| X9 | mcp: Cancellation | state-transition | L1 | automated | fake host; call A in flight, call B queued | cancel B | B never reaches the host; no response for B |
| X10 | mcp: Cancellation | state-transition | L1-real | automated | python `time.sleep(60)` in flight | cancel | no response; host pid gone ≤ 5 s; next call `sessionReset: true` |
| X11 | mcp: Timeout | fault-injection | L1-real | automated | python `while True: pass`, `timeoutSec: 5` | call | `timeout` ≤ 10 s after start; host pid gone ≤ 5 s after the result; next call `sessionReset: true` |
| X12 | mcp: Timeout | fault-injection (delay) | L1 | automated | first call with an empty cache; injected provisioning delay 8 s; `timeoutSec: 5` | call | not `timeout` |
| X13 | mcp: Boot failure + repair | fault-injection (corrupt) | L1-real | automated | cached `blender.wasm` with the same size and one flipped byte | `blender_scene` | `boot-failed`; `ping` ok; next call re-provisions (fetch observed) and succeeds |
| X14 | mcp: Boot failure + repair | fault-injection (corrupt) | L1-real | automated | cached `runtime/st/blender.js` with the same size, corrupted | `blender_scene` | `boot-failed`; next call re-provisions and succeeds |
| X15 | mcp: Boot failure + repair | EP | L1 | automated | override source + fake host boot failure | call | `boot-failed`; override dir untouched (no delete) |
| X16 | mcp: Crash recovery | fault-injection (abort) | L1-real | automated | python `os.abort()` | call | `session-crashed` with diagnostic lines; `ping` ok; next call `sessionReset: true` |
| X17 | mcp: Crash recovery | fault-injection (kill) | L1 | automated | fake host exits with code 1 mid-call | call | `session-crashed`; server alive |
| X18 | mcp: Idle shutdown | state + clock | L1-real | automated | `BLENDER_WASM_IDLE_SEC=2`; one call | wait 3 s, then call | old host pid gone during the gap; new result `sessionReset: true` |
| X19 | mcp: Idle shutdown | BVA | L1-real | automated | `BLENDER_WASM_IDLE_SEC=2`; python `time.sleep(4)` | call | completes; `sessionReset: false` |
| X20 | mcp: JSPI gate | decision-table | L1 | automated | injected probe `unavailable` (node `v22.22.0`), fetch spy | `blender_scene` | `jspi-unavailable` naming `v22.22.0` and "Node 24 or newer"; zero fetch |
| X21 | mcp: JSPI gate | EP (real Node 22) | ci | automated | Node 22 CI unit shards with an empty cache | the `jspi-gate` test calls `blender_scene` against the real probe | `jspi-unavailable`; no download (this is the real-probe path on the Node 22 legs) |
| X22 | mcp: JSPI gate | EP | L1-real | automated | Node 24, valid cache, no flags given to the server | `blender_scene` | succeeds (probe = `flag`) |
| X23 | mcp: Shutdown | state | L1-real | automated | live session | close the server's stdin | server exits; host pid gone ≤ 5 s |
| X24 | mcp: Shutdown | fault-injection (SIGKILL) | L1-real | automated | python `while True: pass` in flight | SIGKILL the launcher pid (POSIX legs; Windows: `taskkill /F` on the launcher pid only, no `/T`) | no server or host pid remains after 5 s |
| X25 | ci: matrix | workflow | ci | automated | PR touching `packages/blender` | CI | Node 24 legs on ubuntu, macos and windows green; Node 22 shards report the L1-real suites as skipped with the reason and pass `verify-executed` |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | design: Electron `execPath` risk | exploratory | — | manual-only | Electron-hosted dashboard; project with `pi-blender mcp --register` | open a pi session; call `blender_scene` | [judgment: tools listed and the call succeeds under the Electron runtime; recorded in the PR] |

---

## Coverage summary

- Requirements covered: 45/45 (provisioning 8, MCP server 28, CLI 9)
- Scenarios by class: edge 67 · perf 3 · error 25 · manual 1
- Scenarios by level: L1 57 · L1-real 36 · ci 2 · — 1
- Scenarios by disposition: automated 95 · manual-only 1

## New infra needed

- `BLENDER_WASM_E2E`-gated real-runtime helper and fixed test cache (task 3.1); socket-guard preload (task 4.4).
- A Node 24 CI job matrix on ubuntu, macos and windows (task 5.4). It is new: CI is Node 22 only today.
