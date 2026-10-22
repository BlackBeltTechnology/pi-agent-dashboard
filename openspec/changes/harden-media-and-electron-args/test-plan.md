# Test Plan — harden-media-and-electron-args

Stage: design   Generated: 2026-10-22

Hard gate resolved: every spec gap scenario-design surfaced (81) was answered and **accepted by the user** — see `scenario-gap-decisions.md` (same directory). No open clarification marker remains. Most load-bearing values used below:

- Boundary equality: a bearer / TTL / 30 d ceiling / grace window is expired or invalid at `now >= limit` (A-G6).
- CSP report sink limiter = token bucket, capacity 20, refill 1 token/s (= 60/min), per socket peer; precedence 404 → 429 → 415 → 413; sink read deadline 5 s → 408 (W-G6, W-G11, W-G13).
- Bridge prompt allowance: `PI_DASHBOARD_BRIDGE_PROMPT_RATE="<burst>/<refillPerSec>"` (e.g. `30/10`), bucket kept per bridge process across reconnects; invalid limit values fall back to the default + one log line (B-G2..B-G4).
- `maxAudioMb`: 1 MB = 1024² bytes; invalid values fall back to 200 + warn (B-G7). Rotation limiter 10/min per device, sliding 60 s window, 429 + `Retry-After` (A-G9).

Slice notes — auth: 7 d = 604 800 s; 30 d = 2 592 000 s; 25 % threshold base = issue→`expiresAt`; grace = 60 s; "T" = fake-clock issue instant (`vi.useFakeTimers` + `vi.setSystemTime`); log capture = `vi.spyOn(console, …)`; remote peer = `203.0.113.9` unless stated; wire declaration = `holder:"browser"`. Web: `P` = `/__pi/csp-report/`; "counters" = persisted violation counter incl. `dropped` and `since`; sink L1 rows use a real Fastify app with the global `@fastify/rate-limit` loopback allow-list registered as in `server.ts`. Id prefixes: `A*` auth, `W*` web/CSP/CORS, `S*` server, `B*` bridge/media/electron; `E` edge · `P` perf · `F` frontend · `X` error.

---


## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| BE27 | video-transcription: Extracted audio size limit (BVA) | BVA | L1 | automated | `maxAudioMb`=L (200; 1 MB = 1024² bytes ⇒ limit 209 715 200 B); extracted audio sizes (stubbed `stat`, bytes) ∈ {`maxAudioMb`=0 (limit disabled) with 367 001 600 (350 MB), 209 715 199 (L-1), 209 715 200 (L), 209 715 201 (L+1), 367 001 600 (350 MB), 0} | run transcription | 209 715 199 and 209 715 200 proceed; 209 715 201 and 367 001 600 fail with an error naming the limit `200` and the found size with one decimal (`200.0` and `350.0`); `L=0` never refuses (350 MB proceeds); on refusal the upload/transcription API is called 0 times | packages/video-transcription/src/__tests__/run.test.ts |
| BE28 | video-transcription: limit is on the EXTRACTED audio | EP | L1 | automated | (a) source video 1 GB → extracted audio 10 MB; (b) source video 5 MB → extracted audio 350 MB; `MAX_AUDIO_MB=50` via env | transcription | (a) proceeds; (b) refused naming 50 and 350; `MAX_AUDIO_MB=50` env wins over default 200 (60 MB refused); invalid config/env values (`-1`, `NaN`, `abc`, `1.5`) fall back to the default 200 with one warning (a 250 MB audio is still refused naming `200`) | packages/video-transcription/src/__tests__/config.test.ts |
| BE29 | video-transcription: dash-leading paths — ffmpeg.ts sites | EP × spawn site | L1 | automated | names ∈ {`-i.mp4`, `--help.mp4`, `-`, `--`, `-x y.mp4`, `./-i.mp4` (relative), absolute `/abs/in.mp4`}; spawn cwd ≠ `process.cwd()`; sites: extract output (`ffmpeg.ts:82`), ffprobe input (`:108-116`), chunk destination (`:149`) | each site runs with a mocked `spawn` | every path argument is absolute, resolved against the SPAWN cwd (not process cwd); none starts with `-`; absolute inputs pass through byte-identical; the file named `-i.mp4` is the one opened | packages/video-transcription/src/__tests__/ffmpeg.test.ts |
| BE30 | video-transcription: dash-leading paths — discover.ts, audio-decode.ts, voiceid.ts | EP × spawn site | L1 | automated | relative dir `-dir` containing `-a.mp4`; `decodeAudio` with relative out path `-out.wav`; voice sample `-voice.wav` via `voiceid` runner (`decodeAudio` + `getDurationSeconds`) | discover → process; decode; verify voice sample | `discover.ts` returns absolute paths; every `ffmpeg`/`ffprobe` argv entry that is a path (including the decode output) is absolute; no argv entry parsed as option; absolute input unchanged | packages/video-transcription/src/__tests__/audio-decode.test.ts |
| BE31 | nano-banana: Dash-leading prompt is text (argv shape) | EP + BVA | L1 | automated | prompts ∈ {`--output /tmp/x.png a cat`, `-a red logo`, `--`, `-`, `""`, `a cat`, prompt with newline}; options: none, each of output/model/flash/file, all together | `buildArgs` / spawn spy (non-win32) | argv contains `"--prompt"` immediately followed by the prompt as ONE unchanged element; no positional prompt; no output path taken from the prompt (`--output` count = 1 only when set); `--output/--model/--flash/--file` present only when set and unaffected by prompt content | packages/nano-banana/src/__tests__/nano-banana.test.ts |
| BE32 | nano-banana: pinned version on every platform | EP | L1 | automated | platform ∈ {`linux`, `darwin`, `win32` (resolvable entry)} | generate image (Gemini backend) | argv has the exact string `@the-focus-ai/nano-banana@1.0.10` (no `@latest`, no bare package name), `npx -y` semantics on non-win32; `GEMINI_API_KEY` in child env; pi backend spawns nothing | packages/nano-banana/src/__tests__/nano-banana.test.ts |
| BE33 | nano-banana: win32 direct node invocation | EP | L1 | automated | `process.platform` stubbed `win32`; npx JS entry resolvable at `<dirname(execPath)>/node_modules/npm/bin/npx-cli.js` (variant: only at `<dirname(execPath)>/../lib/node_modules/npm/bin/npx-cli.js`, and a variant with both); prompt `a cat & dog \| "logo"`; `--model m&%!^ x`, `file`/`output` containing `&`, `%`, `!`, `^`, quotes, spaces | generate | spawn file = `process.execPath`, argv[0] = the first existing of those two candidates (the `node_modules/npm/bin` one wins when both exist); each of prompt/model/file/output is exactly one unchanged argv element; no spawn with `cmd.exe`, no `buildSafeArgv("npx"…)` call; non-win32 passes the same values unchanged | packages/nano-banana/src/__tests__/nano-banana.test.ts |
| BE34 | electron-shell: Doctor window navigation guard (open handler) | decision-table (target URL) | electron | automated | `setWindowOpenHandler` target ∈ {`https://example.com/a`, `http://example.com`, `HTTPS://EXAMPLE.COM`, `file:///etc/passwd`, `javascript:alert(1)`, `data:text/html,x`, ` https://x` (leading space), `//evil.com`, `""`, unparseable `http://`} | invoke the handler returned for the Doctor window | always `{action:"deny"}`; `shell.openExternal` called only for parsed protocol `http:`/`https:` (first three); 0 external calls for the rest | packages/electron/src/__tests__/doctor-window.test.ts |
| BE35 | electron-shell: Doctor renderer is sandboxed | EP | electron | automated | `BrowserWindow` options captured at `createDoctorWindow` | create window | `webPreferences.sandbox === true`, `contextIsolation === true`, `nodeIntegration === false` — identical to the connecting window's values | packages/electron/src/__tests__/doctor-window.test.ts |
| BE36 | electron-shell: Node probe never uses a shell string | EP | electron | automated | detected node paths: `/usr/bin/node`, `C:\Program Files\node\node.exe`, `/tmp/a b/node`, `/tmp/q"x/node`, `/tmp/a&b/node`; `.cmd` / `.ps1` override | `dependency-detector` version probe, `child_process` mocked | `execFileSync(path, ["--version"])` with the path as ONE program argument; `execSync`/`exec` with a shell string called 0 times; `.cmd`/`.ps1` override → probe fails, no fallback, dependency reported not usable | packages/electron/src/__tests__/dependency-detector.test.ts |
| BE37 | electron-shell: Doctor links are scheme-restricted | EP over href | electron | automated | hrefs ∈ {`javascript:alert(1)`, `JaVaScRiPt:alert(1)`, `\tjavascript:alert(1)`, `\u0001javascript:x`, `   javascript:x`, `data:text/html,x`, `vbscript:x`, `/local/path`, `http://`, `https://example.com/a`, `http://example.com`} rendered through the doctor.html link replacer | render report message with `[x](href)` | anchor emitted only for the last two (protocol `https:`/`http:`); all others render as plain text with no `<a>`; label text still visible | packages/electron/src/__tests__/doctor-html-escape.test.ts |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| BP6 | video-transcription: size check reads metadata only | threshold | L1 | automated | 350 MB sparse extracted-audio file; fs spy | single run | `fs.stat` called ≥1 on the extracted audio; `readFile`/`createReadStream`/upload-client calls before the check = 0; check completes without reading the file | packages/video-transcription/src/__tests__/run.test.ts |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| BF3 | electron-shell: https link opens externally, Doctor stays on report | state-transition | electron | automated | Doctor window showing report with `[docs](https://example.com/a)` | click the link | `shell.openExternal("https://example.com/a")` called once; window `webContents.getURL()` still the Doctor page; report content unchanged | packages/electron/src/__tests__/doctor-window.test.ts |
| BF4 | electron-shell: in-window navigation blocked (illegal edge) | state-transition | electron | automated | Doctor window open; `will-navigate` events to `https://evil.example`, `file:///etc/passwd`, `javascript:alert(1)`, `about:blank`; reload of the Doctor URL and a `#hash` change of it | emit each `will-navigate` | `preventDefault()` called for each foreign target; URL after the event remains the Doctor page; navigation whose URL equals the Doctor page file URL or differs only by hash (reload, `#hash`) is allowed: `preventDefault()` NOT called; every URL that differs from the Doctor file URL (incl. `about:blank`) is blocked | packages/electron/src/__tests__/doctor-window.test.ts |
| BF5 | electron-shell: sandbox preload works | smoke | L2 | automated | packaged/dev Electron with Doctor window `sandbox: true`; preload requires no Node APIs | launch app, open Doctor | window opens; preload exposes its bridge API (no `require is not defined` in console); report renders rows | qa/tests/08-electron-real-launch.sh |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| BX7 | nano-banana: win32 entry not resolvable is refused | fault-injection (abort) | L1 | automated | `process.platform` stubbed `win32`; npx JS entry absent at BOTH `<dirname(execPath)>/node_modules/npm/bin/npx-cli.js` and `<dirname(execPath)>/../lib/node_modules/npm/bin/npx-cli.js`; prompts incl. `a & b`, `--model`/`file`/`output` set | generate (Gemini backend) | rejects with an error that says npx's entry was not found and generation can't run safely on Windows; `spawn`/`execFile` called 0 times (no `cmd.exe`, no `npx.cmd` shim); invalid `backend` still validated first and creates no output directory | packages/nano-banana/src/__tests__/nano-banana.test.ts |
| BX8 | video-transcription: audio stat failure never uploads | fault-injection (abort) | L1 | automated | extraction exits 0 but `stat` on the audio rejects (ENOENT / EACCES) | transcription | run fails with an error; upload / transcription API called 0 times (the check cannot be bypassed by a failing stat) | packages/video-transcription/src/__tests__/run.test.ts |
| BX9 | electron-shell: Node probe failure is reported, not a crash | fault-injection (abort) | electron | automated | node binary missing (ENOENT), non-executable (EACCES), exits non-zero, prints garbage, hangs past timeout | version probe | dependency reported "not usable" with no thrown exception out of the detector; no shell fallback attempted | packages/electron/src/__tests__/dependency-detector.test.ts |

## Coverage summary

18 rows: L1/automated 10, L2/automated 1, electron/automated 7

## New infra needed

**Auth**
- Fake clock: `vi.useFakeTimers` + `vi.setSystemTime` only (registry reads `Date.now()`); no production seam.
**Web / CSP**
- No new infra for CORS rows, the passkey page (L1 only, W-G20) or the advisory-triage rows (pure functions + committed snapshot).
**Server**
- `redactGitText` / `assertRefArg` are new units; additions to `git-operations.test.ts` only (no new harness).
**Bridge / media / electron**
- win32 stub helper for L1 (`Object.defineProperty(process, "platform", …)` restored in `afterEach`) shared by BE33 / BX7 — a few lines in the nano-banana test file, no new package.
