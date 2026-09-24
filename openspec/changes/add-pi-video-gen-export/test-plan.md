# Test Plan — add-pi-video-gen-export

Stage: design   Generated: 2026-09-24

Hard gate resolved (user, 2026-09-24): Q1 mux → L1 argv assertions via injected runner + one opt-in real-ffmpeg integration test (`skipIf` ffmpeg/ffprobe absent). Q2 external-format contract → opt-in L1 contract test loading pi-video-gen from `PI_VIDEO_GEN_DIR` (skipped when unset). Q3 ffmpeg stderr tail = 10 lines.

Harness exemplars: L1 pure → `packages/video-production/src/__tests__/{shots,inspect,render}.test.ts` + `fixture.ts` (`makePackage`/`shotMd`); L1 injected ffmpeg runner → `packages/video-transcription/src/__tests__/audio-decode.test.ts`; L1 CLI via `spawnSync` of the bin → `packages/deck3d/src/check/__tests__/check.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | sidecars: Sidecar mode detection | EP | L1 | automated | package with shots/*.md, no film.json | `loadSidecars` + `inspectPackage` | `enabled:false`, no sidecar problems; inspect JSON + human report deep-equal to a pre-change snapshot (no `sidecars` key, no `sidecar` per shot) |
| E2 | sidecars: Film sidecar schema | EP | L1 | automated | film.json variants: valid; `style:""`; no style; dup character id `arm`; invalid JSON | load | valid → 0 problems; others → exactly one problem each (`film.json: style is required` / names `arm` / `film.json: invalid JSON`), scope `film` |
| E3 | sidecars: Shot sidecar schema | decision-table | L1 | automated | shot_01 ok; shot_02 md without json; shot_09 json without md; shot_03 missing `prompt.action`; shot_04 `visibleCharacters:["ghost"]` | load | problems: `shot_02: sidecar missing`, `shot_09: sidecar has no matching shot markdown`, shot_03+`action`, shot_04+`ghost`; all scope `shot` |
| E4 | sidecars: Shot sidecar schema (durationSec) | BVA | L1 | automated | durationSec ∈ {absent, "8", 0.99, 1, 8, 300, 300.01} | load | 1, 8, 300 accepted; absent, "8", 0.99, 300.01 → problem naming shot |
| E5 | sidecars: Timeline sidecar schema (segment shape) | decision-table | L1 | automated | segments: `{shot,image}`; `{}`; `{shot:"shot_99"}`; `{image}` without durationSec | load | one problem per segment naming its index (and `shot_99`), scope `timeline` |
| E6 | sidecars: Timeline sidecar schema (enums) | EP | L1 | automated | `transitionTo.style:"crossfade"`; `overlay.position:"top-right"`; `output.codec:"vp9"`; `output.extra:1` | load | problem per field listing allowed values / naming the key |
| E7 | sidecars: Timeline sidecar schema (output bounds) | BVA | L1 | automated | resolution ∈ {`64x64`, `100x100`, `1920x1080`, `1921x1080`, `4096x4096`, `4098x4096`}; fps ∈ {0, 1, 29.97, 120, 121} | load | accepted: 100x100, 1920x1080, 4096x4096, fps 1, 120; others → problem naming field |
| E8 | sidecars: Timeline sidecar schema (durations/transitions/trim) | BVA | L1 | automated | 8 s shot: segment durationSec ∈ {0.49, 0.5, 8, 8.01}; trimStartSec ∈ {7.99 w/o durationSec, 8}; trim 2 + durationSec 6 vs 6.01; transition durationSec ∈ {0, 3, 3.01, = segment duration}; transition on last segment | load | exactly the out-of-range cases produce a problem naming the segment index; `trim 2 + 6` accepted, `2 + 6.01` rejected; last-segment transition rejected |
| E9 | sidecars: Problem scopes | EP | L1 | automated | missing `voiceover.path` file; unknown timeline shot; missing shot sidecar; bad film | load | scopes `audio`, `timeline`, `shot`, `film` respectively |
| E10 | export: Job directory and job id | EP+BVA | L1 | automated | project dir names `booth-2026`, `.Trade show v1.2`, `café`, 80-char name, `___`; `--job` ∈ {`-abc`, `a b`, 64-char, 65-char, `take1`} | build job id | defaults match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, end `-render-<YYYYMMDD-HHMMSS>`, `.Trade show v1.2` → prefix `Trade-show-v1-2-render-`, `___` → `package-render-…`; `--job` accepts `take1`, 64-char; rejects others before mkdir |
| E11 | export: Render spec mapping | EP | L1 | automated | 3-shot sidecar package (film with style/negative/2 characters; shot sidecars with visuals/action/scene/audio/visibleCharacters) | `exportRender` | `render-input.json` film fields equal film.json; per shot `prompt` deep-equals sidecar prompt; no `seed`/`resolution`/pre-joined prompt string anywhere |
| E12 | export: Seamless continuity | decision-table | L1 | automated | shot_02A seamless → shot_02B; last shot seamless; `--no-last-frame` | exportRender | 02A `lastFramePath` = `video_production/storyboard/shot_02B.png` (cwd = project); last shot: no lastFramePath + warning naming it; `--no-last-frame`: no lastFramePath anywhere + warning listing seamless shots |
| E13 | export: Duration rule and capability preflight | BVA + decision-table | L1 | automated | durationSec ∈ {7.4, 7.5, 8}; `--durations 5-8` with a shot rounding to 4 and one to 9; `--aspect 16:9` with film `9:16`; no flags | exportRender | 7→7 (warn), 8 (warn), 8 (no warn); range fails listing both shots; aspect fails naming `9:16`; no flags → only rounding |
| E14 | export: Dropped-field warnings | decision-table | L1 | automated | md with seed; md with reference image; shot_03 negative ≠ film negative; shot_04 aspect `9:16` vs film `16:9`; clean package | exportRender | warnings: resolution note (always), seed, reference images, `shot_03` negative, `shot_04` aspect; clean package → resolution note only |
| E15 | export: Render spec mapping (unsafe shot name) | EP | L1 | automated | shot files `shot_01.2.md`, `shot_01 final.md` | exportRender | fails naming the shot `shot id not accepted by pi-video-gen`; no job dir created |
| E16 | export: Timeline spec mapping | EP | L1 | automated | timeline: 12 segments incl. 2 repeats of shot_01 + image end-card; `--clips renders/` layout and `--clips job/shots` (`<shot>/video.mp4`) layout | exportTimeline | ids `seg-01`…`seg-12`; video paths absolute to the right layout; durationSec = effective; `sourceAudio.volume` = ambientVolume or 1; `transitionTo.type:"xfade"`; JSON has no `voice`/`narration`/`bgm`/`subtitles` |
| E17 | export: Export report | EP | L1 | automated | successful render export with 1 warning; `export timeline --json` | CLI via spawnSync | human stdout contains spec path, `video_render`, cwd used, outputDir note, the warning; JSON stdout parses to `{specPath, jobDir, tool:"video_compose", warnings}` |
| E18 | inspect: Sidecar reporting | EP | L1 | automated | sidecar package, shot_02.json missing, prompts clean | inspectPackage + formatReport | JSON: shot_02 `sidecar:"missing"`, others `ok`, `sidecars.enabled:true`, `problems` (shot names) unchanged `[]`; human: `Sidecars:` block after rows, last line `✓ All shots have a Full Veo prompt block.` |
| E19 | inspect: Sidecar reporting (exit code) | EP | L1 | automated | sidecar package with shot sidecar missing `prompt.action` | `parse <target>` via spawnSync | exit 1; problem text on output |
| E20 | cli: Subcommand dispatch | decision-table | L1 | automated | argv: `export`, `export foo x`, `export render` (no target), `export timeline <t>` (no --clips), `bogus` | spawnSync bin | each exits 1; stderr contains resp. usage naming both modes / usage naming both modes / `missing <target>` / `--clips <dir> is required` / usage listing six subcommands |
| E21 | cli: Flag parsing | EP | L1 | automated | `--durations 4-15 --aspect 16:9,9:16 --clips renders --job j --picture p.mp4`; `--durations 8-4`; `--durations x` | parse args | values stored; malformed durations → exit 1, stderr names `--durations` |
| E22 | mux: Audio mix (arg builder) | decision-table | L1 | automated | combos: picture audio {yes,no} × VO {yes,no} × music {yes,no} × captions {soft,burn,none}, VO offset 1.5 | `buildMuxArgs` | inputs/`-map` indices consistent per combo; `adelay=1500`; volumes from timeline (music default 0.3); `amix … normalize=0`, `alimiter`, `apad`; `-t <picture duration>`; `-c:v copy` unless burn; `-c:s mov_text` for soft; captions-only → no audio filter, `-map 0:a?` |
| E23 | mux: Captions (burn path safety) | EP | L1 | automated | `captions.path` = `captions/vo,a:b;'c.srt`; `--burn` | runMux with injected runner | runner invoked with `cwd` = temp dir containing `captions.srt`; filter arg exactly `subtitles=captions.srt`; all path args absolute; no shell option |
| E24 | mux: Output location and overwrite | EP | L1 | automated | no `--out`; `--out renders/final.mp4 --burn`; existing output w/o `--force`; with `--force` | runMux (injected runner writing temp output) | default `video_production/master/master.mp4`; `renders/final.mp4` relative to invoking cwd; existing w/o force → `output exists — pass --force to overwrite`; with force → replaced |
| E25 | mux: Mux inputs | EP | L1 | automated | no timeline.json; timeline with no VO/music/captions; missing `--picture`; only problem is scope `shot` | runMux | messages `timeline.json required for mux` / `timeline.json declares no voiceover, music or captions` / names picture path; scope-`shot` → proceeds with warning |
| E26 | mux: real ffmpeg end-to-end (opt-in) | integration | L1 | automated | lavfi-generated 6 s picture with ambient tone, 3 s VO wav, 10 s music wav, SRT first cue 00:00:02,500, offsetSec 2 (`skipIf` no ffmpeg/ffprobe) | `pi-veo mux` | ffprobe: duration 6.0±0.05 s; video codec/resolution equal picture; one subtitle stream, first cue at 2.5 s; audio RMS in [0,2) s ≈ ambient only and rises after 2 s |
| E27 | external contract (opt-in, `PI_VIDEO_GEN_DIR`) | contract | L1 | automated | E11/E12 render export + E16 timeline export outputs | load pi-video-gen dist from `PI_VIDEO_GEN_DIR`; run `runRender` with throwing rate-limiter gate for seedance-2.0 and kling-3.0; `parseTimelineSpec` on timeline | render preflight reaches the gate (`PREFLIGHT_OK`); timeline parses without error; test skipped when env unset |

### Performance

No performance requirement in the specs (local CLI, small JSON). None.

### Frontend-quirk

No UI surface. None.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | sidecars: Sidecar path containment | fault-injection (hostile input) | L1 | automated | `voiceover.path` ∈ {`../../etc/passwd`, `/etc/hosts`, `audio/link.wav` symlink → in-package file, `audio/` dir symlink → outside, `audio/missing.wav`} | load | `path escapes package` ×2, `path is a symlink`, `path escapes package`, `file not found`; each naming the field |
| X2 | export: Frame preflight | fault-injection | L1 | automated | frame outside cwd; frame symlink; `shot_01.png` with text bytes; 20 MiB + 1 byte PNG; valid JPEG named `.jpeg` | exportRender | fails naming shot with `frame outside working directory` / `frame is a symlink` / not-an-image / too large; `.jpeg` accepted |
| X3 | export: Timeline media preflight | fault-injection | L1 | automated | `--clips` outside cwd; clip file symlink; missing clip for shot_02 | exportTimeline | `media outside working directory` / `media is a symlink` / missing list names `shot_02`; nothing written |
| X4 | export: No accidental re-render jobs | state-transition | L1 | automated | sequence: export → export (no flag) → export `--new-job` → delete first spec → export; plus prior export with `--job take1 --out <tmp>/vg` | exportRender | 2nd fails listing 1st spec + resume hint; 3rd succeeds; registry now 2 entries; after deleting specs only stale entries → succeeds; custom id/out prior → listed |
| X5 | export: No accidental re-render jobs (fail-closed) | fault-injection | L1 | automated | `.pi-veo/exports.json` = `{not json`; = `{"x":1}`; unreadable (chmod 000, skip on win32) | exportRender (also with `--new-job`) | fails naming the registry file; no job dir created |
| X6 | export: Export requires valid package / job dir | fault-injection | L1 | automated | no film.json; shot-scope problem; only audio-scope problem; timeline export w/o timeline.json; package outside cwd; job dir pre-created | export render/timeline | messages per spec; audio-only → success with warning; pre-existing job dir → `job directory exists — exports never reuse a job` |
| X7 | mux: Tool availability | fault-injection (abort) | L1 | automated | injected runner: `ffmpeg` ENOENT; `ffprobe` ENOENT | runMux | fails naming the missing tool; no file at output path |
| X8 | mux: Audio mix (VO fit) | BVA | L1 | automated | picture 10 s; VO 8 s with offsetSec ∈ {1.99, 2, 2.01} | runMux (ffprobe injected) | 1.99, 2 → proceed; 2.01 → fails naming both durations, nothing written |
| X9 | mux: Captions (burn capability) | fault-injection | L1 | automated | injected `ffmpeg -filters` output without ` subtitles ` | runMux `--burn` | fails naming the `subtitles` filter before any encode call |
| X10 | mux: Output location (ffmpeg failure) | fault-injection (abort) | L1 | automated | injected ffmpeg exits 1 after writing partial temp file, stderr 25 lines | runMux | no file at output path, temp removed; error shows exactly the last 10 stderr lines |
| X11 | mux: No shell interpolation | fault-injection (hostile input) | L1 | automated | sidecar paths containing `$(touch pwned)`, `;`, spaces (inside package) | runMux | runner receives them as literal argv entries; no `shell:true`; no `pwned` file created |

---

## Coverage summary

- Requirements covered: 29/29 (sidecars 6, export 11, mux 6, inspect 1, cli 3 incl. modified; plus external contract)
- Scenarios by class: edge 27 · perf 0 · frontend 0 · error 11
- Scenarios by level: L1 38 · L2 0 · L3 0
- Scenarios by disposition: automated 38 · manual-only 0

## New infra needed

- none — opt-in tests (E26 real ffmpeg, E27 `PI_VIDEO_GEN_DIR` contract) use `it.skipIf` inside the existing vitest setup; no new harness.
