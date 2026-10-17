---
name: craft-beat-cut
description: Cut footage on the beat with ArtCraft FilmCraft - analyse a track, cut it to length on its downbeat grid, pick camera-punch hits, place edits on downbeats and keyframe punch-ins on the hits, deliver an mp4 with the music. Use for "cut my footage to the beat", "sync the video edit to the music drops", "add camera punches on the hits", "make a beat-synced edit from these clips".
---

# craft-beat-cut — music grid → footage cut on downbeats → punches on hits → mp4

Footage-timeline counterpart of `hyperframes-showreel`'s beat-synced composition: here the picture is edited in
FilmCraft (`filmcraft` skill — read it first); for a composition-driven showreel use `hyperframes-showreel`
(see the split in `craft-studio`). The music side comes from the `music-production` skills; resumable-job rules are
in the `craft-studio` router, section **Craft jobs**.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Analyse | `music-analysis` | track → `01-music/track_map.json` | `check: map` |
| 2 | Cut music | `music-edit-to-length` | map → `02-music/edit.wav`, `edit_edit.json` | `pi-craft verify` + `check: edit` |
| 3 | Pick hits | `beat-sync-video` | edit → `03-hits/hits.json` (`music-hits/1`) | `check: hits` |
| 4 | Conform audio | SoundCraft | `edit.wav` → `04-audio/music.wav` (PCM 24-bit 48 kHz) | `pi-craft verify --codec audio=pcm_s24le` |
| 5 | Cut picture | FilmCraft | footage + grid + hits → `05-cut/p.fcproj`, `rough.mp4` | `pi-craft verify` duration |
| 6 | Punch + deliver | FilmCraft | project + music → `06-delivery/final.mp4` | `pi-craft verify` h264 + aac + `--frame-diff` |

Hand-off formats: wav PCM 24-bit 48 kHz, `music-edit/1` and `music-hits/1` json, mp4 h264 + aac. Write tolerances as
`${D}±0.1` — in bash `$D±0.1` swallows the `±` into the variable name.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

All three music skills are **essential** — never guess beat times.

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `music-analysis` | `music-production` | skill in the loaded skill list | stop: name `music-production` (`pi install npm:@blackbelt-technology/pi-dashboard-music-production`) |
| `music-edit-to-length` | `music-production` | skill in the loaded skill list | stop, same package |
| `beat-sync-video` | `music-production` | skill in the loaded skill list | stop, same package — do not invent hit times |

Runtime probe: the scripts need the quick-tier venv of `music-analysis` step 0 —
`.venv-music/bin/python -c "import librosa"` must succeed; a failed probe counts as absent (stop and point to
that skill's step 0). "Loaded skill list" is the available-skills list in your own system prompt; its entry location
also gives the package directory (`PKG`). Needs the user's local music file (no ripping from streaming services).

Then set up the job (**Craft jobs** in `craft-studio`: slug rule, `job-helper`) and run **Resume**.

```bash check: job
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Analyse

**Output:** `01-music/track_map.json` (`music-map/1`).
**Gate:** `check: map`.

Run `music-analysis` on the local track; read the sections and drop candidates and confirm the drop by ear.

```bash check: map
jq -e '.schema=="music-map/1"' track_map.json
```

### Step 2 — Cut the music

**Output:** `02-music/edit.wav` and `02-music/edit_edit.json` (`music-edit/1`).
**Gate:** `pi-craft verify` on the wav (duration = target) and `check: edit`.

`music-edit-to-length` renders the cut and a preview. **Listen before lock**: ask the user to approve the preview
(`ask_user`) before any picture is cut to its grid; keep rejected versions with a `_vN` suffix.

```bash
pi-craft verify "$JOB/02-music/edit.wav" --duration "${D}±0.1" --has-audio
```

```bash check: edit
jq -e '.schema=="music-edit/1" and .duration > 0 and (.downbeats_video | length) > 0' edit_edit.json
```

### Step 3 — Pick the hits

**Output:** `03-hits/hits.json` (`music-hits/1`).
**Gate:** `check: hits` — right schema and at least one hit.

Run `beat-sync-video` (`pick_hits.py`) on `edit_edit.json`. Hits are video time; add hand-placed hits with
`"source":"manual"`. An empty or wrong-schema file stops the workflow — do not cut to guessed times.

```bash check: hits
jq -e '.schema=="music-hits/1" and (.hits|length>0)' hits.json
```

### Step 4 — Conform the audio

**Output:** `04-audio/music.wav` (PCM 24-bit, 48 kHz).
**Gate:** `pi-craft verify --codec audio=pcm_s24le`, duration unchanged.

```bash
pi-craft soundcraft exec convert "$JOB/02-music/edit.wav" "$JOB/04-audio/music.wav" --bit-depth 24 --rate 48000
pi-craft verify "$JOB/04-audio/music.wav" --duration "${D}±0.05" --codec audio=pcm_s24le
```

### Step 5 — Cut the picture

**Output:** `05-cut/p.fcproj`, `05-cut/rough.mp4` (the retained reference for step 6).
**Gate:** `pi-craft verify` — duration equals the music, one clip more than there are cuts.

`hits[].t` and `downbeats_video` are video time, i.e. sequence time when the footage starts at 0 and the music
starts at 0 (add the lead-in to every time if the picture has one — probe the offset, never guess). FilmCraft: put
the footage on V1 and split **all tracks** at each cut time with `sequence.addEditAllTracks` (ticks, 254016000000 per
second; snapped to the frame). Cut times = every Nth downbeat (default N = 4; N = 2 for a busy edit) united with
every hit time, frame-rounded and de-duplicated by `jq` (no helper script needed). The footage must be at least
as long as the music; export with `--start 0 --end <music seconds>` so the picture ends with the music.

```bash
CUTS=$(jq -n --slurpfile e edit_edit.json --slurpfile h hits.json --argjson n 4 --argjson fps "$FPS" '
  ([$e[0].downbeats_video | to_entries[] | select(.key % $n == 0) | .value] + [$h[0].hits[].t])
  | map(select(. > 0 and . < $e[0].duration)) | map(. * $fps | round) | unique | map(. / $fps)')
jq -c '.[] | {id:"sequence.addEditAllTracks",params:{time:(. * 254016000000 | round)}}' <<<"$CUTS"   # one line per cut
pi-craft filmcraft exec --project "$JOB/05-cut/p.fcproj" --save run "$JOB/05-cut/cuts.jsonl"
pi-craft filmcraft exec --project "$JOB/05-cut/p.fcproj" export "$JOB/05-cut/rough.mp4" --format h264 --start 0 --end "$D"
pi-craft verify "$JOB/05-cut/rough.mp4" --duration "${D}±0.1" --has-video
```

Count the clips with `inspect sequence --compact` (`[.video[].items[]?]|length` must be cuts + 1): two hits closer
than one frame produce one cut, not two, and the next step pairs clips with hits by start frame.

### Step 6 — Punch and deliver

**Output:** `06-delivery/p.fcproj`, `06-delivery/final.mp4` (h264 + aac).
**Gate:** `pi-craft verify` — `--codec video=h264 --codec audio=aac`, duration ±0.1 s, `--frame-diff` at a hit
(punched, > 5 %) and after the settle (identical to `rough.mp4`, < 1 %).

The punch is FilmCraft's own motion effect — no EffectCraft round trip. For the clip that **starts** at each hit,
keyframe the `motion` effect's `scale`: `recipe.<tier>.scale × 100` at the hit and `100` after `recipe.<tier>.settle`
seconds (read both from `hits.json`; defaults: big 1.12 / 0.6 s, mid 1.07 / 0.45 s). Use
`effects.setParam` with `keyframe:true` and a `time` in ticks; `inspect sequence --compact` gives the clip ids and
start frames, paired with hits by `round(t × fps)`. Then put `music.wav` on **A2** with a source patch and **mute
A1** (footage sound off — the music is the soundtrack), and export. A plain `effects.setParam` without
`keyframe:true` is a static scale on the whole clip, not a punch.

```bash
pi-craft filmcraft exec --project "$JOB/06-delivery/p.fcproj" --save run "$JOB/06-delivery/punch.jsonl"
pi-craft filmcraft exec --project "$JOB/06-delivery/p.fcproj" export "$JOB/06-delivery/final.mp4" --format h264 --start 0 --end "$D"
pi-craft verify "$JOB/06-delivery/final.mp4" --duration "${D}±0.1" --has-video --has-audio \
  --codec video=h264 --codec audio=aac \
  --frame-diff "$T_HIT_PLUS:$JOB/05-cut/rough.mp4>5" --frame-diff "$T_SETTLED:$JOB/05-cut/rough.mp4<1"
```

`$T_HIT_PLUS` ≈ hit time + 0.1 s; `$T_SETTLED` = hit time + settle + 0.1 s but before the next cut. Edge bleed (frame
edge showing background at peak scale) cannot occur at scale ≥ 100 %.

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job
name, and start at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed —
a replaced footage file or a re-cut music edit. Re-run every step downstream of it and reuse the verified outputs
before it (a changed `edit.wav` invalidates hits, conformed audio, cut and delivery). Record each step with the
`job-helper` snippet after its gate passed.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft filmcraft exec
describe <id>` / `commands <word>`), repeat the step and re-run the gate. At most 2 retries per step; after the
second failure stop and report the verify output and what was tried.

## Recipes

```bash recipe: beat-cut-core
# The FilmCraft/SoundCraft steps end to end with stand-ins for the music skills' output (music-edit/1, music-hits/1).
FPS=25; D=8
ffmpeg -v error -y -f lavfi -i testsrc2=size=640x360:rate=$FPS:duration=12 -f lavfi -i sine=frequency=330:duration=12 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac footage.mp4
ffmpeg -v error -y -f lavfi -i sine=frequency=110:duration=$D -ar 44100 -c:a pcm_s16le edit.wav
echo '{"schema":"music-edit/1","duration":8,"bpm":120,"downbeats_video":[0,2,4,6]}' > edit.json
echo '{"schema":"music-hits/1","edit":"edit.json","hits":[{"t":2.0,"tier":"big","source":"structural"},{"t":5.0,"tier":"mid","source":"hook"}],"recipe":{"big":{"scale":1.12,"settle":0.6},"mid":{"scale":1.07,"settle":0.45}}}' > hits.json
mkdir -p 04-audio 05-cut 06-delivery

# 03 hits: the skill-level check
jq -e '.schema=="music-hits/1" and (.hits|length>0)' hits.json

# 04 conform audio: PCM 24-bit 48 kHz
pi-craft soundcraft exec convert edit.wav 04-audio/music.wav --bit-depth 24 --rate 48000
pi-craft verify 04-audio/music.wav --duration ${D}±0.05 --codec audio=pcm_s24le

# 05 cut picture: edits on every 2nd downbeat and on every hit
CUTS=$(jq -n --slurpfile e edit.json --slurpfile h hits.json --argjson n 2 --argjson fps $FPS '
  ([$e[0].downbeats_video | to_entries[] | select(.key % $n == 0) | .value] + [$h[0].hits[].t])
  | map(select(. > 0 and . < $e[0].duration)) | map(. * $fps | round) | unique | map(. / $fps)')
echo "$CUTS" > 05-cut/cuts.json
pi-craft filmcraft exec --save-as 05-cut/p.fcproj import footage.mp4 > 05-cut/items.json
FOOT=$(jq -r '.items[0]' 05-cut/items.json)
{ echo "{\"id\":\"file.newSequence\",\"params\":{\"name\":\"beat\",\"width\":640,\"height\":360,\"fps\":$FPS,\"fromItem\":$FOOT}}"
  jq -c '.[] | {id:"sequence.addEditAllTracks",params:{time:(. * 254016000000 | round)}}' 05-cut/cuts.json; } > 05-cut/cuts.jsonl
pi-craft filmcraft exec --project 05-cut/p.fcproj --save run 05-cut/cuts.jsonl
pi-craft filmcraft exec --project 05-cut/p.fcproj export 05-cut/rough.mp4 --format h264 --start 0 --end $D
pi-craft verify 05-cut/rough.mp4 --duration ${D}±0.1 --has-video
test "$(pi-craft filmcraft exec --project 05-cut/p.fcproj inspect sequence --compact | jq '[.video[].items[]?]|length')" -ge "$(( $(jq length 05-cut/cuts.json) + 1 ))"

# 06 punch + deliver: scale keyframes on the clip that starts at each hit, music on A2
pi-craft filmcraft exec --project 05-cut/p.fcproj --save-as 06-delivery/p.fcproj import 04-audio/music.wav > 06-delivery/items.json
MUSIC=$(jq -r '.items[0]' 06-delivery/items.json)
pi-craft filmcraft exec --project 06-delivery/p.fcproj inspect sequence --compact | jq -c '[.video[].items[]?|{clip,startFrame}]|sort_by(.startFrame)' > 06-delivery/clips.json
jq -n -c --slurpfile h hits.json --slurpfile c 06-delivery/clips.json --argjson fps $FPS '
  $c[0][] as $clip
  | ($h[0].hits[] | select((.t * $fps | round) == $clip.startFrame)) as $hit
  | ($h[0].recipe[$hit.tier] // {scale:(if $hit.tier=="big" then 1.12 else 1.07 end),settle:0.5}) as $r
  | ({id:"effects.setParam",params:{clip:$clip.clip,effect:"motion",param:"scale",value:($r.scale*100),time:($hit.t*254016000000|round),keyframe:true}},
     {id:"effects.setParam",params:{clip:$clip.clip,effect:"motion",param:"scale",value:100,time:(($hit.t+$r.settle)*254016000000|round),keyframe:true}})' > 06-delivery/punch.jsonl
test -s 06-delivery/punch.jsonl
cat >> 06-delivery/punch.jsonl <<JSONL
{"id":"timeline.setTrack","params":{"track":"A1","muted":true}}
{"id":"source.open","params":{"item":$MUSIC}}
{"id":"timeline.setTargeting","params":{"track":"A2","sourcePatch":true,"targeted":true}}
{"id":"timeline.setTargeting","params":{"track":"A1","targeted":false}}
{"id":"playhead.set","params":{"seconds":0}}
{"id":"source.overwrite","params":{}}
JSONL
pi-craft filmcraft exec --project 06-delivery/p.fcproj --save run 06-delivery/punch.jsonl
pi-craft filmcraft exec --project 06-delivery/p.fcproj export 06-delivery/final.mp4 --format h264 --start 0 --end $D
pi-craft verify 06-delivery/final.mp4 --duration ${D}±0.1 --has-video --has-audio --codec video=h264 --codec audio=aac \
  --frame-diff 2.1:05-cut/rough.mp4\>5 --frame-diff 3.5:05-cut/rough.mp4\<1
```
