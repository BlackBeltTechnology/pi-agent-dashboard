---
name: music-analysis
description: "Analyse a local audio file into a versioned music map (<stem>_map.json, schema music-map/1): tempo from the downbeat grid, 1-based bars, key, band levels, classed sections, drop candidates, optional stems and style tags. Use on \"analyse this track\", \"what BPM / where is the drop\", \"map the song for editing\", or before cutting music or syncing video to it."
---

# music-analysis

Turns a **local** audio file into `<stem>_map.json` + `<stem>_analysis.png`. The map
is the input of `music-edit-to-length` and `beat-sync-video`.

## Step 0 — Python environment (once per project)

The scripts never install anything. Resolve the package root first:
`PKG=<this skill dir>/../../..` (it holds `lib/` and the requirements files).

```bash
# quick tier (librosa) — enough for everything except beat_this / stems / tags
uv venv -p python3.14 .venv-music
uv pip install --python .venv-music -r "$PKG/requirements-core.txt"

# deep tier — optional, multi-GB (torch, TensorFlow). Keep it in its OWN venv.
uv venv -p python3.14 .venv-mir
uv pip install --python .venv-mir -r "$PKG/requirements-mir.txt"
```

Verified platform: Python 3.14 on macOS arm64; every requirement is pinned exactly.
A missing module makes a script exit 2 with one line naming the requirements file.

## Step 1 — Source the audio (no-rip rule)

Analyse only a local file the user supplies. Never download or extract audio from a
streaming service, and never suggest a tool that does. Acceptable sources:

- a purchased file (lossless or high-bitrate);
- a file from the artist, label or composer (stems welcome);
- the user's own recording of a session they are allowed to use.

From a video recording, extract the audio and check its level:

```bash
ffmpeg -i recording.mkv -vn -ac 2 -ar 44100 -c:a pcm_s16le track_rec.wav
ffmpeg -i track_rec.wav -af volumedetect -f null - 2>&1 | grep -E "max_volume|mean_volume"
```

**Quiet recordings:** when `max_volume` is below −12 dBFS, gain the source up so it
peaks at about −2 dBFS before analysis (e.g. a −21.9 dB peak → `-af volume=19.9dB`),
and note the applied gain next to the file (README row or filename) so the mix stage
knows the source was lifted.

## Step 2 — Quick tier

```bash
.venv-music/bin/python "$PKG/.pi/skills/music-analysis/scripts/analyze_music.py" track.wav [--out-dir music/]
```

## Step 3 — Deep tier (optional)

```bash
.venv-mir/bin/python "$PKG/.pi/skills/music-analysis/scripts/analyze_mir.py" track.wav [--map music/track_map.json] [--no-tags] [--no-stems]
```

Enriches the same map: the beat_this downbeat grid replaces `cut_grid`
(`source: "beat_this"`) and every bar-indexed field is re-derived against it; essentia
tempo + 3-profile key vote; `tags {genre, instrument, mood}`; demucs `htdemucs_6s`
stems under `stems/` with `energy_share` and per-bar RMS, which sharpen section classes
and drop confidence. With stems, `drops[]` is recomputed on the new grid (drum
re-entry added to the confidence), so drop times move to beat_this downbeats.

**Model licences.** The tag classifiers (Discogs-EffNet, MTG) are **CC BY-NC-SA 4.0 —
non-commercial**. They are fetched on first use from a fixed URL table, sha256-verified
(200 MB cap per file) into `${XDG_CACHE_HOME:-~/.cache}/pi-music-production/models/`,
and never redistributed. For a **commercial deliverable**, use the quick tier plus
stems without tags: `analyze_mir.py --no-tags`.

**Third-party weight caches** (fetched by those libraries, not hash-pinned by this skill):
demucs and beat_this download their checkpoints into the torch hub cache,
`${TORCH_HOME:-~/.cache/torch}/hub/checkpoints/` (`beat_this-final0.ckpt`, htdemucs).
Delete any of these caches to reclaim space; they refill on the next deep run.

## The map contract — `music-map/1` (source time)

| Field | Meaning |
|---|---|
| `schema` | `"music-map/1"`; consumers reject another major version |
| `source` | analysed audio, **relative to the map file** |
| `duration`, `sr` | seconds, sample rate |
| `tempo {bpm, stable_span{start_bar,end_bar}, methods{}}` | `bpm = 60·meter·(k−1)/(t_k−t_1)` over the stable span (longest run of downbeat intervals within ±5 % of their median); per-method estimates only under `methods` |
| `cut_grid {source, meter, downbeats[]}` | the single authoritative grid; **bar n starts at `downbeats[n-1]`** |
| `beats[]`, `key {label, strength}`, `band_level_db_rel {sub,bass,low_mid,high_mid,air}` | |
| `sections[] {start,end,start_bar,end_bar,rms_db,bass_db,class}` | `end_bar` is exclusive; `class` ∈ `intro groove breakdown build drop outro` (advisory) |
| `drops[] {time, bar, confidence}` | candidates sorted by confidence; a start whose 30–150 Hz gain is not sustained over the next 2 bars scores < 0.5 |
| `stems {dir, energy_share{}, bar_rms_db{}}` | deep tier only; `dir` relative to the map |

All times are seconds, 3 decimals. Paths are relative, so a project folder can move.

## Rules

- **Confirm the drop by ear** (or by the drums/bass stem re-entering) before using it
  as an edit anchor. A loud breakdown start is the classic false positive.
- Trust `tempo.bpm`, not a method's median inter-beat value (frame-quantized, can be
  off by 2+ BPM).
- A track with fewer than 8 downbeats is rejected ("too short or arrhythmic").

## Verification

- Open `<stem>_analysis.png`: section spans, classes, downbeat lines and drop
  candidates should match what you hear.
- `jq '.tempo, .cut_grid.meter, .drops[:3]' <stem>_map.json`.
