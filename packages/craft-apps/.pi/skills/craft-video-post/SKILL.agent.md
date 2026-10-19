# SKILL.md — craft-video-post index

Pull-only condensed map. Source: packages/craft-apps/.pi/skills/craft-video-post/SKILL.md. Footage/Veo clips → captions + alpha overlays + SoundCraft mix → verified h264+aac mp4.

Triggers: "edit these clips into a finished video with captions and music", "add a lower third and subtitles to my footage", "post-produce this recording". Apps: FilmCraft, EffectCraft, SoundCraft. Resume rules: `craft-studio` § Craft jobs.

## Step table
- 0 Preflight + job → `craft-jobs/<slug>/job.json`; gate `check: job`.
- 1 Footage (`veo-generator` / `footage-redaction` / user files) → `01-footage/*.mp4`; gate `pi-craft verify --has-video --duration ${CLIP_SECONDS}±0.2`.
- 2 Graphics (optional; EffectCraft or `hyperframes-showreel`) → `02-graphics/*.mov` ProRes 4444 alpha; gate `--alpha`.
- 3 Assembly (FilmCraft) → `03-assembly/cut.mp4`, `ref.mp4`; gate `--frame-diff`.
- 4 Captions input (`video-transcription`) → `04-captions/cues.srt`; gate `check: srt`.
- 5 Mix (SoundCraft) → `05-mix/mix.wav` PCM 24-bit 48 kHz; gate `--codec audio=pcm_s24le --max-peak -1`.
- 6 Delivery (FilmCraft) → `06-delivery/final.mp4`; gate h264 + aac, `--frame-diff`.
- Tolerances: ±0.1 s picture, ±0.05 s audio. Write `${PIC}±0.1`.

## Step 0 — Preflight and job
- Probes: `veo-generator` (`pi-veo` on PATH); `footage-redaction` (skill); `video-transcription` (`pi-transcribe`); `hyperframes-showreel` (skill + `npx hyperframes --version`).
- Install: `pi install npm:@blackbelt-technology/pi-dashboard-video-production`, `…-video-transcription`.
- Missing transcribe → skip steps 4 and caption part of 6, or ask `.srt`.
- Missing hyperframes → EffectCraft only.
- Failed probe = absent.

## Step 1 — Footage
- One clip per camera cut (veo). Redact when sensitive. Keep originals out of `01-footage/`.

## Step 2 — Graphics (optional)
- EffectCraft: `--format prores --prores 4444 --channels rgba`. Name lower-thirds → `craft-motion-titles`.
- HyperFrames: only code-driven motion; never author a composition here. `npx hyperframes render . --format mov -o title.mov --fps 25` (alpha ProRes 4444; tested 0.8.168).
- Alpha branch → overlay V2 in step 3.
- Full-frame branch → fails `--alpha`; place on V1; gate `pi-craft verify seg.mp4 --size … --duration …`.
- EffectCraft templates include opaque "Preview Background" solid — delete it.

## Step 3 — Assembly
- FilmCraft: footage V1; `playhead.set` before each placement.
- Export un-overlaid `cut.mp4`; overlays V2+; export `ref.mp4`. Keep both.
- Trap: `source.overwrite` → targeted track; without sourcePatch overwrites V1.
- Overlay jsonl: `source.open`, `timeline.setTargeting` V2 `sourcePatch:true,targeted:true`, V1 `targeted:false`, `playhead.set`, `source.overwrite`.
- Gate: `--frame-diff T:cut.mp4>0.1` (overlay visible), `<40` (footage not replaced), `T_BEFORE:cut.mp4<0.1`.
- `--frame-diff` = share of pixels luma-diff > 40/255. Lower third ~0.5–5 %; replaced picture 50 %+.
- Quote `>`/`<`.

## Step 4 — Captions input
- `pi-transcribe <file>` → beside source (Soniox default; needs key). Copy to `04-captions/cues.srt`.
- Empty srt → no captions placed.

## Step 5 — Mix
- Music attenuated first; footage audio via `ffmpeg … -vn -ar 48000 -c:a pcm_s24le`.
- Each import = new track. Bounce, then `convert --bit-depth 24 --rate 48000` (bounce sets depth only).
- Length ≠ picture → do not start step 6.
- Sample rate/channels not machine-gated.
- Loudness target → `craft-podcast-master` two-pass loudnorm.

## Step 6 — Delivery
- FilmCraft from step-3 project saved as new file: mute A1; `mix.wav` on A2 (sourcePatch); `captions.import` SRT; export.
- Burn captions: `export … --format h264 --settings '{"burnCaptions":true}'` (plain export does not draw captions).
- Gate: `--size` `--has-video --has-audio --codec video=h264 --codec audio=aac`; `--frame-diff` at caption cue vs `ref.mp4` `>0.1` (small text ~0.3 %); drop caption check if no captions.
- Report final path + verify output.

## Resume
- Read `job.json` as data; restart at first step with no passing report or changed inputs (e.g. replaced clip).
- Reuse verified outputs upstream (e.g. `05-mix/mix.wav`).
- Record each passed step via `job-helper`.

## When a gate fails
- Stop. Re-discover: `pi-craft <app> exec describe <id>` / `commands <word>` (ids change between alpha releases).
- Max 2 retries; then report verify output, attempts, leftover file.

## Recipes
- `video-post-core`: ffmpeg testsrc2 footage (6 s, 1280x720) + sine music + hand `cues.srt`; EffectCraft `effectcraft exec --empty --save-as … run comp.new layer.newText prop.addKey …`; `render --format prores --prores 4444 --channels rgba`; verify `--alpha`; FilmCraft `file.newSequence` → `cut.mp4`; overlay at 2 s → `ref.mp4`; frame-diff checks; SRT check + copy; SoundCraft mix (`clip.gain {"db":-14}`) → convert → verify; delivery with `captions.import` + burnCaptions; final verify `--frame-diff 1:…\>0.1 --frame-diff 3.5:…\>0.1`.
