---
name: youtube-srt
description: Download YouTube subtitles (SRT + compact timestamped TXT) for a channel, playlist or video without downloading media, via yt-dlp — then optionally mine them into a categorized catalog (e.g. an AI-model catalog with function, open weights, local runnability, size, hardware tier). Use on "download the srt of this video", "get transcripts of channel X for the last N months", "subtitles from youtube", "catalog the models AI Search talked about", "update docs/models".
---

# YouTube SRT → catalog

Two stages. Stage 1 is generic (any channel/video). Stage 2 is the model-catalog pipeline
that produced `docs/models/` from [@theAIsearch](https://www.youtube.com/@theAIsearch).

## Prerequisites

- `yt-dlp` on PATH (`pipx install yt-dlp`; if pipx complains about uv: `pipx install --backend pip yt-dlp`).
- `python3` (stdlib only) for stage 2. No API keys — YouTube captions are free.

## Stage 1 — fetch subtitles

```bash
S=packages/video-transcription/.pi/skills/youtube-srt/scripts
$S/yt-srt.sh -s now-6months "https://www.youtube.com/@theAIsearch"      # channel, date window
$S/yt-srt.sh "https://www.youtube.com/watch?v=VIDEO_ID"                   # single video
$S/yt-srt.sh -o ~/somewhere -l "de.*,de" -n 50 "https://youtube.com/playlist?list=..."
```

| Flag | Meaning | Default |
|---|---|---|
| `-o DIR` | output dir | `~/Documents/Media/youtube/<@handle>` (or `misc`) |
| `-s SINCE` | lower upload-date bound (`YYYYMMDD`, `now-6months`, `today-30days`) — stops at first older video | none |
| `-l LANGS` | yt-dlp `--sub-langs` | `en.*,en` |
| `-n MAX` | max playlist items scanned | 200 |

Output per video: `<YYYYMMDD>_<id>_<title>.<lang>.srt` + `.txt` (`[mm:ss] line`, rolling
auto-caption duplicates removed, ~4× smaller — feed THIS to LLMs). `index.tsv` = id, date,
duration, url, title. Manual subs preferred, auto-captions fallback; when both `en-orig` and `en`
exist only `en-orig` is kept.

Idempotent: `.archive.txt` skips fetched IDs; IDs whose subtitles failed (HTTP 429) are removed
from the archive and the script prints `WARN: N video(s) without subtitles` → just rerun later.

## Stage 2 — model catalog (`docs/models/`)

1. Fetch: `$S/yt-srt.sh -s <window> "https://www.youtube.com/@theAIsearch"`.
2. Batch: in `<out>/extract/`, `ls ../*.txt | sort | split -l 6 -a 1 - batch-` (~6 videos ≈ 60k tokens per batch; for an incremental update list only the new `.txt` files and pick unused batch letters).
3. Extract: one `general-purpose` subagent per batch (host cap ≈ 2 concurrent), prompt:
   `Working dir: <out>. Read extract/PROMPT.md and follow it exactly. Batch file extract/batch-X; write extract/X.jsonl.`
   `PROMPT.md` holds the schema below; copy it from an existing `<out>/extract/PROMPT.md` or recreate from this section.
4. Render: `python3 $S/build-catalog.py <out>/extract docs/models` → `README.md`, one `<category>.md`
   per function, `local-hardware.md` (tiers T0–T5), `models.jsonl` (merged, one model per line).
   Hand-curated `picks.md` is never touched by the renderer — refresh it via DocScribe when data changes.

### Extraction schema (one JSON object per model per video)

`model, family, vendor, category, functions[], open_weights, license, local_runnable, params,
size_gb, hardware, tooling, access, strengths, weaknesses, benchmarks, video_id, video_date, timestamp`

`category` ∈ `llm coding multimodal-omni image-gen image-edit video-gen video-edit music tts-voice
asr-speech realtime-voice 3d world-model avatar-lipsync agent robotics science-medical embedding-other`.
Null when the video doesn't say — never invent numbers. Skip sponsor segments.

### Merge + tier rules (`build-catalog.py`)

- Same model across videos = same normalized `model` string; latest non-null fact wins; category = most frequent; every mention kept as a timestamped source link.
- Hardware tier (local models only): explicit GB → tier; else presenter wording (per `;`-clause strongest requirement, cheapest clause wins); else checkpoint size as *est.*
  T0 phone/CPU · T1 ≤8 GB · T2 ≤16 GB · T3 ≤32 GB · T4 ≤128 GB workstation · T5 multi-GPU.

## Pitfalls

- HTTP 429 from YouTube on bulk runs: built-in `--sleep-subtitles 2`; rerun to fill gaps.
- `--break-on-reject` makes yt-dlp exit non-zero on a date-bounded run — expected, ignored.
- Auto-captions mishear names ("clawed" = Claude, "Quen" = Qwen); extraction prompt tells the agent to correct obvious ones; residual oddities stay as heard.
- Names that differ between videos ("Qwen 3.6" vs "Qwen3.6 35B-A3B") stay separate rows — normalization is deliberately conservative.
- Specs are the presenter's claims, unverified. The catalog says so; keep that caveat.
- Keep raw transcripts outside the repo; the catalog cites YouTube URLs with `&t=` only.
