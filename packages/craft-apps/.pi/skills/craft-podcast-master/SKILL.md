---
name: craft-podcast-master
description: Master a spoken recording with ArtCraft apps - transcribe, name speakers, per-speaker SoundCraft mix, loudness-targeted master, optional chapters and mp4 mux; verified and resumable. Use for "master this podcast episode to -16 LUFS", "balance the speakers in this interview", "put the mastered audio back on the video".
---

# craft-podcast-master — recording → per-speaker tracks → loudness-targeted master

Speech-first pipeline: `video-transcription` + `speaker-id` tell who speaks when, SoundCraft mixes one track per
speaker, **ffmpeg `loudnorm`** hits the loudness target (SoundCraft only peak-normalises), FilmCraft muxes the
master back onto a video recording. Read `soundcraft` (and `filmcraft` for step 7) first. Resumable-job rules are
in the `craft-studio` router, section **Craft jobs**.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Transcribe | `video-transcription` | recording → `01-transcript/rec.srt` | `check: srt` |
| 2 | Name speakers | `speaker-id` | srt → `02-speakers/rec.named.srt` (`[Name] text`) | `check: named` |
| 3 | Stems | ffmpeg | recording + named srt → `03-stems/<speaker>.wav` | `pi-craft verify` per stem |
| 4 | Mix | SoundCraft | stems → `04-mix/mix.wav` (PCM 24-bit 48 kHz) | `pi-craft verify --codec audio=pcm_s24le` |
| 5 | Master | ffmpeg `loudnorm` | mix → `05-master/master.wav` | `pi-craft verify --loudness` |
| 6 | Chapters (optional) | agent | named srt → `06-chapters/chapters.txt` | `check: chapters` |
| 7 | Deliver | FilmCraft (video) / the wav | master (+ picture) → `07-delivery/final.mp4` | `pi-craft verify` h264 + aac |

Hand-off formats: wav PCM 24-bit 48 kHz between steps, srt with `[Name]` speaker prefixes, mp4 h264 + aac for a video
recording. The **reference length** is the recording's (or its picture's) duration; every audio step is gated
against it with ±0.05 s. Write tolerances as `${REF}±0.05` — in bash `$REF±0.05` swallows the `±` into the
variable name.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `video-transcription` | `video-transcription` | skill in the loaded skill list; `command -v pi-transcribe` | ask for a ready `.srt` with speaker labels, or stop (no transcript → no per-speaker split; a single-track master is still possible: skip steps 1–3, import the recording as one track) |
| `speaker-id` | `video-transcription` | skill in the loaded skill list; `command -v pi-voiceid` (needs the optional `sherpa-onnx-node`) | continue with the anonymous `[Speaker N]` labels — one track per label, not named |

Package: `pi install npm:@blackbelt-technology/pi-dashboard-video-transcription`. "Loaded skill list" is the
available-skills list in your own system prompt; a loaded skill does not prove its runtime works, so a failed probe
counts as absent. Needs `ffmpeg` (stems and loudness): without it step 3/5 cannot run — stop and say so.
The reference length: `REF=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$REC")`.

Set up the job (**Craft jobs** in `craft-studio`: slug rule, `job-helper`) and run **Resume**.

```bash check: job
# run from the directory that contains craft-jobs/ (SLUG set as in step 0)
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Transcribe

**Output:** `01-transcript/rec.srt`.
**Gate:** `check: srt` — at least one cue.

`pi-transcribe <recording>` writes `<name>.srt` beside the recording (diarized `[Speaker N]` labels, needs the
Soniox key). Copy it to `01-transcript/rec.srt`.

```bash check: srt
# run inside the step directory: cd "$JOB/01-transcript" (the file is named as below)
test "$(grep -cE '^[0-9:,.]+ --> [0-9:,.]+' rec.srt)" -ge 1
```

### Step 2 — Name the speakers

**Output:** `02-speakers/rec.named.srt`.
**Gate:** `check: named` — cues still timed and every speaker label is a `[Name]` prefix.

`pi-voiceid label --srt rec.srt --dry-run`, read the decision table, then `pi-voiceid label --srt rec.srt` (writes
`rec.named.srt`, never overwrites the source). Never guess a name: unmatched clusters keep `[Speaker N]`. If
`analyze` reports drift (one person split in two), name both clusters the same — they land on one track.
`pi-voiceid` needs the recording beside the SRT.

```bash
pi-voiceid analyze --srt "$JOB/01-transcript/rec.srt"
```

```bash check: named
# run inside the step directory: cd "$JOB/02-speakers" (the file is named as below)
test "$(grep -cE '^[0-9:,.]+ --> [0-9:,.]+' rec.named.srt)" -ge 1 && grep -qE '^\[[^]]+\]' rec.named.srt
```

### Step 3 — Stems

**Output:** `03-stems/<speaker>.wav` (PCM 24-bit 48 kHz, full recording length).
**Gate:** `pi-craft verify` on every stem — duration = reference.

Decision (open question of the design): **pre-split stems** — each speaker's stem is the recording silenced outside
that speaker's cues (0.15 s padding), plus an 80 Hz high-pass for rumble. Deterministic, gate-able and independent of
SoundCraft's selection state. Extract turns from the named SRT with `awk` (`[Name]` prefix), build one ffmpeg filter
script per speaker, render. Set `LC_ALL=C` so decimals use a point.

```bash
LC_ALL=C awk -F'\t' -v w="$who" '$1==w{e=e (e?"+":"") sprintf("between(t,%.3f,%.3f)",$2-0.15,$3+0.15)} END{printf "highpass=f=80,volume=enable=\x27not(%s)\x27:volume=0\n", e}' turns.tsv > "$slug.filter"
ffmpeg -v error -y -i rec.wav -filter_script:a "$slug.filter" -c:a pcm_s24le "$slug.wav"
pi-craft verify "$slug.wav" --duration "${REF}±0.05" --codec audio=pcm_s24le
```

The full loop (turn extraction, one stem per speaker) is in recipe `podcast-master-core`. A stem whose length differs
from the reference stops the workflow here — the recording extract was cut short or the SRT is for another file.

### Step 4 — Mix

**Output:** `04-mix/mix.wav` (PCM 24-bit, 48 kHz), `04-mix/mix.scraft`.
**Gate:** `pi-craft verify` — duration = reference, `--codec audio=pcm_s24le`, `--max-peak -1`.

SoundCraft (`soundcraft` skill): `session.new`, then one `file.import_audio` per stem (each import is a new track —
that is how speakers play together), balance with `clip.gain` (`db` sets the gain; give the clip id or run
`edit.select_all` first), optional `edit.fades_create` at the edges, `--save` the session, `--bounce`, then `convert`
to 24-bit 48 kHz (the bounce only sets the bit depth). A mono stem bounced to the stereo bus is 3 dB quieter.

```bash
pi-craft soundcraft exec convert "$JOB/04-mix/mix-raw.wav" "$JOB/04-mix/mix.wav" --bit-depth 24 --rate 48000
pi-craft verify "$JOB/04-mix/mix.wav" --duration "${REF}±0.05" --codec audio=pcm_s24le --max-peak -1
```

A mix whose length differs from the reference stops here; the master step is **not** started.

### Step 5 — Master to a loudness target

**Output:** `05-master/master.wav` (PCM 24-bit, 48 kHz).
**Gate:** `pi-craft verify --loudness` (integrated LUFS) and `--max-peak`.

SoundCraft has no LUFS-target command (probed: only peak normalise, `file.bounce_mix normalize`). Use ffmpeg
`loudnorm` in **two passes**: measure with `print_format=json`, then apply with the measured values and
`linear=true` (single-pass `loudnorm` is dynamic and pumps on speech). Podcast targets: −16 LUFS stereo / −19 LUFS
mono, true peak −1.5 dBTP.

```bash
M=$(ffmpeg -hide_banner -nostats -i 04-mix/mix.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
ffmpeg -v error -y -i 04-mix/mix.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$(jq -r .input_i <<<"$M"):measured_TP=$(jq -r .input_tp <<<"$M"):measured_LRA=$(jq -r .input_lra <<<"$M"):measured_thresh=$(jq -r .input_thresh <<<"$M"):offset=$(jq -r .target_offset <<<"$M"):linear=true" -ar 48000 -c:a pcm_s24le 05-master/master.wav
pi-craft verify 05-master/master.wav --duration "${REF}±0.05" --codec audio=pcm_s24le --loudness -16±1 --max-peak -1.5
```

Without `ffmpeg`, `pi-craft verify --loudness` exits 3 naming it: stop after the un-normalised bounce and report that
the loudness target could not be met or checked. Linear mode needs the measured LRA to be within the target;
if ffmpeg falls back to dynamic mode the verify still decides.

### Step 6 — Chapters (optional)

**Output:** `06-chapters/chapters.txt` (`MM:SS title` per line).
**Gate:** `check: chapters` — first chapter at `00:00`, every line well formed.

Pick chapter starts from the named SRT (topic changes, speaker introductions) with the user. Probed: FilmCraft has
`markers.addChapter` (video only, not verified to be written into the mp4) and SoundCraft only session markers
(`markers.add`, memory locations that are not written into a wav) — so chapters ship as a **sidecar text file**
(YouTube/podcast-app style).

```bash check: chapters
# run inside the step directory: cd "$JOB/06-chapters" (the file is named as below)
grep -qE '^00:00 ' chapters.txt && ! grep -vqE '^[0-9]{2}:[0-9]{2}(:[0-9]{2})? .+' chapters.txt
```

### Step 7 — Deliver

**Output:** `07-delivery/final.mp4` for a video recording; for audio-only the deliverable is `05-master/master.wav`.
**Gate:** `pi-craft verify` — `--codec video=h264 --codec audio=aac`, duration ±0.1 s, `--frame-diff` (picture
untouched).

Audio-only: the master wav is the deliverable (gate = step 5). Video recording: FilmCraft sequence from the recording,
**mute A1**, place `master.wav` on **A2** with a source patch (`timeline.setTargeting … sourcePatch`, as in
`craft-video-post`), export h264 + aac. Plain `source.overwrite` without a source patch lands on the targeted
track — check the track in `inspect sequence`.

```bash
pi-craft filmcraft exec --project "$JOB/07-delivery/p.fcproj" export "$JOB/07-delivery/final.mp4" --format h264
pi-craft verify "$JOB/07-delivery/final.mp4" --duration "${REF}±0.1" --has-video --has-audio \
  --codec video=h264 --codec audio=aac --frame-diff "1:$REC<0.5"
```

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job
name, and start at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed —
a re-recorded file or an edited SRT. Re-run every step downstream of it (a changed `rec.named.srt` re-cuts the stems,
mix, master and delivery) and reuse the verified outputs before it. Record each step with the `job-helper` snippet
after its gate passed.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft soundcraft exec describe
<id>` / `commands <word>` — note the filter is positional in SoundCraft), repeat the step and re-run the gate. At most
2 retries per step; after the second failure stop and report the verify output and what was tried.

## Recipes

```bash recipe: podcast-master-core
# Stems -> SoundCraft mix -> loudnorm master -> chapters check -> mp4 mux, with a hand-made named SRT standing in
# for speaker-id. SRC_DUR (default 5) is the recording's audio length; REF is the picture's — a shorter audio
# source stops the workflow at the first duration gate and no master is written.
REF=5; SRC=${SRC_DUR:-5}
ffmpeg -v error -y -f lavfi -i testsrc2=size=640x360:rate=25:duration=$REF -f lavfi -i sine=frequency=300:duration=$REF \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac rec.mp4
# the recording's audio (here SRC seconds of it) and a hand-made named transcript (speaker-id's output: "[Name] text")
ffmpeg -v error -y -i rec.mp4 -t $SRC -vn -ar 48000 -c:a pcm_s24le rec.wav
printf '1\n00:00:00,000 --> 00:00:02,000\n[Ann] Welcome to the show.\n\n2\n00:00:02,500 --> 00:00:04,500\n[Bob] Thanks for having me.\n' > named.srt
mkdir -p 03-stems 04-mix 05-master 06-chapters 07-delivery

# 03 stems: one wav per speaker, silent outside that speaker's cues, 80 Hz high-pass for rumble
LC_ALL=C awk 'BEGIN{RS="";FS="\n"} function sec(x,a){split(x,a,/[:,]/);return a[1]*3600+a[2]*60+a[3]+a[4]/1000}
     {split($2,t," --> "); if (match($3,/^\[[^]]+\]/)) print substr($3,RSTART+1,RLENGTH-2) "\t" sec(t[1]) "\t" sec(t[2])}' named.srt > 03-stems/turns.tsv
cut -f1 03-stems/turns.tsv | sort -u | while IFS= read -r who; do
  slug=$(printf '%s' "$who" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
  LC_ALL=C awk -F'\t' -v w="$who" '$1==w{e=e (e?"+":"") sprintf("between(t,%.3f,%.3f)",$2-0.15,$3+0.15)} END{printf "highpass=f=80,volume=enable=\x27not(%s)\x27:volume=0\n", e}' 03-stems/turns.tsv > "03-stems/$slug.filter"
  ffmpeg -v error -y -i rec.wav -filter_script:a "03-stems/$slug.filter" -c:a pcm_s24le "03-stems/$slug.wav"
  pi-craft verify "03-stems/$slug.wav" --duration ${REF}±0.05 --codec audio=pcm_s24le
done

# 04 mix: one SoundCraft track per speaker, balanced, bounced, PCM 24-bit 48 kHz
pi-craft soundcraft exec run \
  --cmd session.new \
  --cmd "file.import_audio={\"path\":\"$PWD/03-stems/ann.wav\"}" \
  --cmd "file.import_audio={\"path\":\"$PWD/03-stems/bob.wav\"}" \
  --save 04-mix/mix.scraft --bounce 04-mix/mix-raw.wav
pi-craft soundcraft exec convert 04-mix/mix-raw.wav 04-mix/mix.wav --bit-depth 24 --rate 48000
pi-craft verify 04-mix/mix.wav --duration ${REF}±0.05 --codec audio=pcm_s24le --max-peak -1

# 05 master: ffmpeg two-pass loudnorm to -16 LUFS (measure, then apply the measured values linearly)
M=$(ffmpeg -hide_banner -nostats -i 04-mix/mix.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
ffmpeg -v error -y -i 04-mix/mix.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$(jq -r .input_i <<<"$M"):measured_TP=$(jq -r .input_tp <<<"$M"):measured_LRA=$(jq -r .input_lra <<<"$M"):measured_thresh=$(jq -r .input_thresh <<<"$M"):offset=$(jq -r .target_offset <<<"$M"):linear=true" \
  -ar 48000 -c:a pcm_s24le 05-master/master.wav
pi-craft verify 05-master/master.wav --duration ${REF}±0.05 --codec audio=pcm_s24le --loudness -16±1 --max-peak -1.5

# 06 chapters: sidecar text, one "MM:SS title" per line, first at 00:00
printf '00:00 Welcome\n00:02 Guest introduction\n' > 06-chapters/chapters.txt
grep -qE '^00:00 ' 06-chapters/chapters.txt && ! grep -vqE '^[0-9]{2}:[0-9]{2}(:[0-9]{2})? .+' 06-chapters/chapters.txt

# 07 deliver: master replaces the recording's audio, picture untouched, mp4 h264 + aac
pi-craft filmcraft exec --save-as 07-delivery/p.fcproj import rec.mp4 05-master/master.wav > 07-delivery/items.json
REC=$(jq -r '.items[0]' 07-delivery/items.json); MASTER=$(jq -r '.items[1]' 07-delivery/items.json)
cat > 07-delivery/deliver.jsonl <<JSONL
{"id":"file.newSequence","params":{"name":"podcast","width":640,"height":360,"fps":25,"fromItem":$REC}}
{"id":"timeline.setTrack","params":{"track":"A1","muted":true}}
{"id":"source.open","params":{"item":$MASTER}}
{"id":"timeline.setTargeting","params":{"track":"A2","sourcePatch":true,"targeted":true}}
{"id":"timeline.setTargeting","params":{"track":"A1","targeted":false}}
{"id":"playhead.set","params":{"seconds":0}}
{"id":"source.overwrite","params":{}}
JSONL
pi-craft filmcraft exec --project 07-delivery/p.fcproj --save run 07-delivery/deliver.jsonl
pi-craft filmcraft exec --project 07-delivery/p.fcproj export 07-delivery/final.mp4 --format h264
pi-craft verify 07-delivery/final.mp4 --duration ${REF}±0.1 --has-video --has-audio --codec video=h264 --codec audio=aac \
  --frame-diff 1:rec.mp4\<0.5
```
