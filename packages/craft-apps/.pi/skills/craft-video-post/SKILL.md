---
name: craft-video-post
description: Post-production workflow for footage or Veo clips with ArtCraft apps - optional redaction, FilmCraft assembly with alpha overlays, captions from a transcript SRT, SoundCraft mix, mp4 h264+aac delivery, each step verified and resumable. Use for "edit these clips into a finished video with captions and music", "add a lower third and subtitles to my footage", "assemble the Veo shots and deliver an mp4", "post-produce this recording".
---

# craft-video-post — footage → captions + overlays + mix → verified mp4

Chains FilmCraft (timeline, captions, export), EffectCraft (alpha graphics) and SoundCraft (mix) with the
sibling skills for redaction, transcription and code-driven motion. App dialects, traps and the
discover → execute → save → verify loop are in the app skills and in `craft-studio`; **read `filmcraft` before
step 3.** Resumable-job rules are in the `craft-studio` router, section **Craft jobs**.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Footage | `veo-generator` / `footage-redaction` / user files | clips → `01-footage/*.mp4` | `pi-craft verify` per clip |
| 2 | Graphics (optional) | EffectCraft or `hyperframes-showreel` | text/data → `02-graphics/*.mov` (ProRes 4444 alpha) | `pi-craft verify --alpha` |
| 3 | Assembly | FilmCraft | clips + overlays → `03-assembly/cut.mp4`, `ref.mp4` | `pi-craft verify --frame-diff` |
| 4 | Captions input | `video-transcription` | recording → `04-captions/cues.srt` | `check: srt` |
| 5 | Mix | SoundCraft | footage audio + music → `05-mix/mix.wav` (PCM 24-bit 48 kHz) | `pi-craft verify --codec audio=pcm_s24le` |
| 6 | Delivery | FilmCraft | project + mix + srt → `06-delivery/final.mp4` | `pi-craft verify` h264 + aac |

Hand-off formats: wav PCM 24-bit 48 kHz (audio), mov ProRes 4444 with alpha (graphics), srt (captions), mp4 h264 + aac
(delivery). Duration tolerance: ±0.1 s for picture, ±0.05 s for audio. Write the tolerance as `${PIC}±0.1` — in bash
`$PIC±0.1` swallows the `±` into the variable name.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

Check what is available before promising anything (soft references — no package is required):

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `veo-generator` | `video-production` | skill in the loaded skill list; `pi-veo` on PATH | the user supplies footage files |
| `footage-redaction` | `video-production` | skill in the loaded skill list | no redaction — say so and confirm the footage is safe to ship |
| `video-transcription` | `video-transcription` | skill in the loaded skill list; `command -v pi-transcribe` | offer to continue without captions (skip steps 4 and the caption part of 6), or ask for a ready `.srt` |
| `hyperframes-showreel` | `video-production` | skill in the loaded skill list **and** `npx hyperframes --version` succeeds | no code-driven overlays — use EffectCraft graphics only |

"Loaded skill list" is the available-skills list in your own system prompt. A loaded skill does not prove its
runtime works, hence the extra probes; a failed probe counts as absent. Name the package to install
(`pi install npm:@blackbelt-technology/pi-dashboard-video-production`, `…-video-transcription`) when a sibling is
missing, then continue on the degraded path or stop if the request needs it.

Then set up the job (see **Craft jobs** in `craft-studio`: slug rule, `job-helper` snippet) and run **Resume** below.

```bash check: job
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Footage

**Output:** `01-footage/*.mp4` (redacted or generated clips).
**Gate:** `pi-craft verify` on every clip.

Generate shots with `veo-generator` (one clip per camera cut) or take the user's files; run each clip through
`footage-redaction` when the footage shows anything sensitive. Keep originals out of `01-footage/`.

```bash
pi-craft verify "$JOB/01-footage/c01.mp4" --has-video --duration "${CLIP_SECONDS}±0.2"
```

### Step 2 — Graphics (optional)

**Output:** `02-graphics/title.mov` (ProRes 4444, alpha).
**Gate:** `pi-craft verify --alpha`.

Two producers, one rule: the file must have an alpha channel.

- **EffectCraft** (default) — read the `effectcraft` skill; render with `--format prores --prores 4444 --channels rgba`.
  For name/title lower-thirds use `craft-motion-titles`.
- **HyperFrames** — only for code-driven motion (data overlays); never author a composition here, use
  `hyperframes-showreel`. Alpha render: `npx hyperframes render . --format mov -o title.mov --fps 25` (MOV is always
  the alpha-preserving ProRes 4444 profile; tested with HyperFrames 0.8.168).
  - **Alpha branch** — the render passes `pi-craft verify --alpha`: overlay it on V2 in step 3.
  - **Full-frame branch** — it fails `--alpha` (opaque render): do **not** overlay it. Place it as a full-frame
    segment on V1 in step 3 and gate the segment with `--size` against the sequence size
    (`pi-craft verify seg.mp4 --size 1920x1080 --duration …`).

```bash
pi-craft verify "$JOB/02-graphics/title.mov" --alpha --size 1920x1080 --duration "${TITLE_SECONDS}±0.1"
```

A passing `--alpha` only proves the pixel format. EffectCraft template projects carry an opaque
"Preview Background" solid — delete it (see `craft-motion-titles`) or the overlay is opaque.

### Step 3 — Assembly

**Output:** `03-assembly/p.fcproj`, `03-assembly/cut.mp4` (V1 only) and `03-assembly/ref.mp4` (with overlays).
**Gate:** `pi-craft verify --frame-diff` (overlay visible, rest unchanged).

FilmCraft: footage on V1 with explicit `playhead.set` before every placement (trap in `filmcraft`), export the
un-overlaid `cut.mp4`, then place overlays on **V2+** and export `ref.mp4`. Keep both files for the job's lifetime
— `cut.mp4` is the reference for the overlay check, `ref.mp4` for the caption check in step 6.

Overlay placement is the trap: `source.overwrite` goes to the *targeted* video track. Without a source patch it
overwrites **V1 and silently replaces the footage** (the export still has the right duration). Patch the source to V2:

```bash
cat > "$JOB/03-assembly/overlay.jsonl" <<JSONL
{"id":"source.open","params":{"item":$TITLE}}
{"id":"timeline.setTargeting","params":{"track":"V2","sourcePatch":true,"targeted":true}}
{"id":"timeline.setTargeting","params":{"track":"V1","targeted":false}}
{"id":"playhead.set","params":{"seconds":2}}
{"id":"source.overwrite","params":{}}
JSONL
pi-craft filmcraft exec --project "$JOB/03-assembly/p.fcproj" --save run "$JOB/03-assembly/overlay.jsonl"
pi-craft filmcraft exec --project "$JOB/03-assembly/p.fcproj" export "$JOB/03-assembly/ref.mp4" --format h264
# overlay visible (> 0.1 %) but footage not replaced (< 40 %), and untouched before the overlay starts
pi-craft verify "$JOB/03-assembly/ref.mp4" --duration "${PIC}±0.1" --size 1920x1080 \
  --frame-diff "$T_OVERLAY:$JOB/03-assembly/cut.mp4>0.1" --frame-diff "$T_OVERLAY:$JOB/03-assembly/cut.mp4<40" \
  --frame-diff "$T_BEFORE:$JOB/03-assembly/cut.mp4<0.1"
```

(Quote the `>`/`<` in `--frame-diff` or escape them.) The `--frame-diff` value is the share of pixels whose luma
differs by more than 40/255: a lower third is ~0.5–5 %, a replaced picture 50 %+.

### Step 4 — Captions input

**Output:** `04-captions/cues.srt`.
**Gate:** `check: srt` — at least one cue; an empty file stops the step and no caption is placed.

Transcribe the recording (or the final dialogue) with `video-transcription` — `pi-transcribe <file>` writes
`<name>.srt` beside the source (Soniox by default; needs its API key). Copy it to `04-captions/cues.srt`. Offer a
hand-written or user-supplied `.srt` when the skill is missing. Never place captions from a file the check rejects.

```bash check: srt
test "$(grep -cE '^[0-9:,.]+ --> [0-9:,.]+' cues.srt)" -ge 1
```

### Step 5 — Mix

**Output:** `05-mix/mix.wav` (PCM 24-bit, 48 kHz, stereo).
**Gate:** `pi-craft verify` — duration equals the picture, `--codec audio=pcm_s24le`, peak below clipping.

SoundCraft (read `soundcraft`): the music goes in first and is attenuated, then the footage audio extracted with
`ffmpeg … -vn -ar 48000 -c:a pcm_s24le`. Each import is a new track. Bounce, then `convert` — the bounce
itself only sets bit depth, not the rate:

```bash
pi-craft soundcraft exec convert "$JOB/05-mix/mix-raw.wav" "$JOB/05-mix/mix.wav" --bit-depth 24 --rate 48000
pi-craft verify "$JOB/05-mix/mix.wav" --duration "${PIC}±0.05" --codec audio=pcm_s24le --max-peak -1
```

A mix that is shorter or longer than the picture stops here: **do not start step 6** (a wrong-length mix produced a
silent tail in the export). Sample rate and channel count are not machine-gated — they are fixed by `convert`.
For a loudness target on the final mix use the ffmpeg two-pass in `craft-podcast-master` (SoundCraft normalises to
peak only).

### Step 6 — Delivery

**Output:** `06-delivery/p.fcproj`, `06-delivery/final.mp4` (h264 + aac).
**Gate:** `pi-craft verify` — `--codec video=h264 --codec audio=aac`, duration ±0.1 s, `--frame-diff` for captions
and overlay.

FilmCraft, from the step-3 project saved as a new file: **mute A1** (footage audio is already inside the mix),
place `mix.wav` on **A2** with a source patch (same mechanics as the V2 overlay), `captions.import` the SRT, export
with captions burned in. `captions.import` makes a caption track but a plain export does **not** draw it — burning
needs the export setting:

```bash
pi-craft filmcraft exec --project "$JOB/06-delivery/p.fcproj" export "$JOB/06-delivery/final.mp4" --format h264 \
  --settings '{"burnCaptions":true}'
pi-craft verify "$JOB/06-delivery/final.mp4" --duration "${PIC}±0.1" --size 1920x1080 --has-video --has-audio \
  --codec video=h264 --codec audio=aac \
  --frame-diff "$T_CUE:$JOB/03-assembly/ref.mp4>0.1" --frame-diff "$T_OVERLAY:$JOB/03-assembly/cut.mp4>0.1"
```

`--frame-diff` at a caption cue time against the retained uncaptioned `ref.mp4` must show a difference (small text is
~0.3 % of a 640×360 frame — use `>0.1`). Without captions, drop the first frame-diff. Report the final path and the
verify output.

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job
name, and start at the first step that has no passing report **or** whose recorded inputs (path, size, mtime) no
longer match the files — e.g. a footage clip replaced after the job ran. Re-run every step downstream of it; reuse the
verified outputs of the steps before it (an interrupted job whose mix passed starts again at step 6 or at
assembly if an input changed, and reuses `05-mix/mix.wav`). After each passing gate record the step with the
`job-helper` snippet.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft <app> exec describe <id>` /
`commands <word>` — ids change between releases), repeat the step, and re-run the gate. At most 2 retries per
step; after the second failure stop and report the verify output, what was tried and the file left behind.

## Recipes

```bash recipe: video-post-core
# The app steps of the workflow end to end: alpha overlay -> assembly -> srt check -> mix -> burned-in delivery.
# ffmpeg-made footage and music and a hand-written cues.srt stand in for the sibling skills' output.
PIC=6
ffmpeg -v error -y -f lavfi -i testsrc2=size=1280x720:rate=25:duration=$PIC -f lavfi -i sine=frequency=440:duration=$PIC \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac footage.mp4
ffmpeg -v error -y -f lavfi -i sine=frequency=220:duration=$PIC -ar 48000 music.wav
printf '1\n00:00:00,500 --> 00:00:02,000\nFirst caption\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond caption\n' > cues.srt
mkdir -p 02-graphics 03-assembly 04-captions 05-mix 06-delivery

# 02 graphics: EffectCraft alpha overlay, fully visible from 1 s of its comp
pi-craft effectcraft exec --empty --save-as 02-graphics/t.ecproj run \
  comp.new '{"name":"Title","width":1280,"height":720,"frameRate":25,"duration":2}' \
  layer.newText '{"text":"Lower","size":120,"position":[640,360]}' \
  prop.addKey '{"layer":"Lower","path":"transform/opacity","time":0,"value":0}' \
  prop.addKey '{"layer":"Lower","path":"transform/opacity","time":1,"value":100}'
pi-craft effectcraft exec --project 02-graphics/t.ecproj render --out 02-graphics/title.mov --format prores --prores 4444 --channels rgba
pi-craft verify 02-graphics/title.mov --alpha --size 1280x720 --duration 2±0.1

# 03 assembly: footage on V1 (un-overlaid cut kept), then the overlay on V2 at 2 s
pi-craft filmcraft exec --save-as 03-assembly/p.fcproj import footage.mp4 02-graphics/title.mov > 03-assembly/items.json
FOOT=$(jq -r '.items[0]' 03-assembly/items.json); TITLE=$(jq -r '.items[1]' 03-assembly/items.json)
cat > 03-assembly/cut.jsonl <<JSONL
{"id":"file.newSequence","params":{"name":"post","width":1280,"height":720,"fps":25,"fromItem":$FOOT}}
JSONL
pi-craft filmcraft exec --project 03-assembly/p.fcproj --save run 03-assembly/cut.jsonl
pi-craft filmcraft exec --project 03-assembly/p.fcproj export 03-assembly/cut.mp4 --format h264
pi-craft verify 03-assembly/cut.mp4 --duration ${PIC}±0.1 --size 1280x720 --has-video
cat > 03-assembly/overlay.jsonl <<JSONL
{"id":"source.open","params":{"item":$TITLE}}
{"id":"timeline.setTargeting","params":{"track":"V2","sourcePatch":true,"targeted":true}}
{"id":"timeline.setTargeting","params":{"track":"V1","targeted":false}}
{"id":"playhead.set","params":{"seconds":2}}
{"id":"source.overwrite","params":{}}
JSONL
pi-craft filmcraft exec --project 03-assembly/p.fcproj --save run 03-assembly/overlay.jsonl
pi-craft filmcraft exec --project 03-assembly/p.fcproj export 03-assembly/ref.mp4 --format h264
pi-craft verify 03-assembly/ref.mp4 --duration ${PIC}±0.1 --size 1280x720 \
  --frame-diff 3.5:03-assembly/cut.mp4\>0.1 --frame-diff 3.5:03-assembly/cut.mp4\<40 --frame-diff 1:03-assembly/cut.mp4\<0.1

# 04 captions: the skill-level check, then keep the file
test "$(grep -cE '^[0-9:,.]+ --> [0-9:,.]+' cues.srt)" -ge 1
cp cues.srt 04-captions/cues.srt

# 05 mix: music under the footage audio, PCM 24-bit 48 kHz
ffmpeg -v error -y -i footage.mp4 -vn -ar 48000 -c:a pcm_s24le 05-mix/footage.wav
pi-craft soundcraft exec run \
  --cmd session.new \
  --cmd "file.import_audio={\"path\":\"$PWD/music.wav\"}" \
  --cmd edit.select_all --cmd 'clip.gain={"db":-14}' \
  --cmd "file.import_audio={\"path\":\"$PWD/05-mix/footage.wav\"}" \
  --save 05-mix/mix.scraft --bounce 05-mix/mix-raw.wav
pi-craft soundcraft exec convert 05-mix/mix-raw.wav 05-mix/mix.wav --bit-depth 24 --rate 48000
pi-craft verify 05-mix/mix.wav --duration ${PIC}±0.05 --codec audio=pcm_s24le --max-peak -1

# 06 delivery: mix on A2 (A1 muted), captions burned in, mp4 h264 + aac
pi-craft filmcraft exec --project 03-assembly/p.fcproj --save-as 06-delivery/p.fcproj import 05-mix/mix.wav > 06-delivery/items.json
MIX=$(jq -r '.items[0]' 06-delivery/items.json)
cat > 06-delivery/deliver.jsonl <<JSONL
{"id":"timeline.setTrack","params":{"track":"A1","muted":true}}
{"id":"source.open","params":{"item":$MIX}}
{"id":"timeline.setTargeting","params":{"track":"A2","sourcePatch":true,"targeted":true}}
{"id":"timeline.setTargeting","params":{"track":"A1","targeted":false}}
{"id":"playhead.set","params":{"seconds":0}}
{"id":"source.overwrite","params":{}}
{"id":"captions.import","params":{"path":"$PWD/04-captions/cues.srt"}}
JSONL
pi-craft filmcraft exec --project 06-delivery/p.fcproj --save run 06-delivery/deliver.jsonl
pi-craft filmcraft exec --project 06-delivery/p.fcproj export 06-delivery/final.mp4 --format h264 --settings '{"burnCaptions":true}'
pi-craft verify 06-delivery/final.mp4 --duration ${PIC}±0.1 --size 1280x720 --has-video --has-audio \
  --codec video=h264 --codec audio=aac \
  --frame-diff 1:03-assembly/ref.mp4\>0.1 --frame-diff 3.5:03-assembly/cut.mp4\>0.1
```
