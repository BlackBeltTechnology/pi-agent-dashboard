# SKILL.md — craft-podcast-master index

Pull-only condensed map. Source: packages/craft-apps/.pi/skills/craft-podcast-master/SKILL.md. Master spoken recording: transcribe → name speakers → per-speaker stems → SoundCraft mix → ffmpeg loudnorm → chapters → FilmCraft mux.

Triggers: "master this podcast episode to -16 LUFS", "balance the speakers in this interview", "put the mastered audio back on the video". Resume rules: `craft-studio` § Craft jobs.

## Step table
- 0 Preflight + job → `craft-jobs/<slug>/job.json`; gate `check: job` (jq `.name and .workflow and (.steps|type=="object")`).
- 1 Transcribe (`video-transcription`, `pi-transcribe <rec>`) → `01-transcript/rec.srt`; gate `check: srt` (≥1 cue).
- 2 Name speakers (`speaker-id`, `pi-voiceid label --srt rec.srt [--dry-run]`) → `02-speakers/rec.named.srt` (`[Name] text`); gate `check: named`.
- 3 Stems (ffmpeg) → `03-stems/<speaker>.wav` PCM 24-bit 48 kHz; gate `pi-craft verify` duration = REF ±0.05.
- 4 Mix (SoundCraft) → `04-mix/mix.wav`; gate `--codec audio=pcm_s24le --max-peak -1`.
- 5 Master (ffmpeg loudnorm) → `05-master/master.wav`; gate `--loudness -16±1 --max-peak -1.5`.
- 6 Chapters (optional) → `06-chapters/chapters.txt`; gate `check: chapters`.
- 7 Deliver (FilmCraft, video only) → `07-delivery/final.mp4`; gate h264 + aac, ±0.1 s, `--frame-diff`.

Hand-off: wav PCM 24-bit 48 kHz; srt with `[Name]` prefixes; mp4 h264 + aac. Reference REF = recording (or picture) duration. Write tolerances `${REF}±0.05` (bash `$REF±0.05` breaks).

## Step 0 — Preflight and job
- Sibling probes: `video-transcription` skill + `command -v pi-transcribe`; `speaker-id` skill + `command -v pi-voiceid` (needs optional `sherpa-onnx-node`).
- Missing transcribe → ask ready `.srt` or stop; single-track master possible (skip 1–3).
- Missing speaker-id → anonymous `[Speaker N]`, one track per label.
- Install: `pi install npm:@blackbelt-technology/pi-dashboard-video-transcription`.
- Needs `ffmpeg` (steps 3, 5); absent → stop.
- `REF=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$REC")`.
- Loaded skill list ≠ working runtime; failed probe = absent.

## Step 1 — Transcribe
- `pi-transcribe` writes `<name>.srt` beside recording; diarized; needs Soniox key.

## Step 2 — Name the speakers
- `pi-voiceid label --srt rec.srt --dry-run` → read table → `pi-voiceid label --srt rec.srt` (writes `rec.named.srt`, never overwrites).
- Never guess names; unmatched keep `[Speaker N]`.
- `pi-voiceid analyze --srt <srt>` reports drift; name split clusters identically.
- Recording must sit beside SRT.

## Step 3 — Stems
- Decision: pre-split stems — silence outside speaker cues ±0.15 s pad, `highpass=f=80`.
- `LC_ALL=C` for decimal point; `turns.tsv` via awk on `[Name]` prefix.
- `ffmpeg -filter_script:a <slug>.filter -c:a pcm_s24le`.
- Length mismatch → stop (cut short or wrong SRT).
- Recipe: `podcast-master-core`.

## Step 4 — Mix
- SoundCraft: `session.new`; `file.import_audio` per stem (one track each); `clip.gain` (`db`); optional `edit.fades_create`; `--save`, `--bounce`; `convert --bit-depth 24 --rate 48000`.
- Mono stem on stereo bus = 3 dB quieter.
- Length mismatch → do not start step 5.

## Step 5 — Master to loudness target
- SoundCraft: peak-only (`file.bounce_mix normalize`); no LUFS.
- Two-pass ffmpeg `loudnorm`: measure `print_format=json`, apply `measured_I/TP/LRA/thresh`, `offset=target_offset`, `linear=true`.
- Targets: −16 LUFS stereo / −19 LUFS mono; TP −1.5 dBTP; LRA=11.
- No ffmpeg → `pi-craft verify --loudness` exits 3; report target unmet.
- Dynamic fallback: verify decides.

## Step 6 — Chapters (optional)
- Sidecar `06-chapters/chapters.txt`, `MM:SS title` per line; first `00:00`.
- FilmCraft `markers.addChapter` (video only, unverified in mp4); SoundCraft `markers.add` (not written into wav).
- Gate: `grep -qE '^00:00 '` and no malformed line.

## Step 7 — Deliver
- Audio-only: deliverable = `05-master/master.wav`.
- Video: FilmCraft sequence from recording; mute A1; `master.wav` on A2 via `timeline.setTargeting … sourcePatch`; export h264 + aac.
- Plain `source.overwrite` w/o sourcePatch hits targeted track — check `inspect sequence`.
- Export: `filmcraft exec --project p.fcproj export final.mp4 --format h264`.
- Gate: `--has-video --has-audio --codec video=h264 --codec audio=aac --frame-diff "1:$REC<0.5"`.

## Resume
- Read `job.json` as data; confirm name; restart at first step with no passing report or changed inputs (path, size, mtime).
- Changed `rec.named.srt` → rerun stems, mix, master, delivery.
- Record each passed step via `job-helper` snippet.

## When a gate fails
- Stop; re-discover with `pi-craft soundcraft exec describe <id>` / `commands <word>` (filter positional in SoundCraft).
- Max 2 retries per step; then report verify output.

## Recipes
- `podcast-master-core`: ffmpeg testsrc2 + sine → `rec.mp4`; `rec.wav`; hand `named.srt`; awk → `turns.tsv`; per-speaker stems; `pi-craft soundcraft exec run --cmd session.new --cmd file.import_audio=… --save … --bounce …`; loudnorm two-pass; chapters grep; `filmcraft exec --save-as … import rec.mp4 master.wav` → items.json; `deliver.jsonl` (newSequence, setTrack A1 muted, source.open, setTargeting A2 sourcePatch, source.overwrite); export; verify `--frame-diff 1:rec.mp4\<0.5`.
