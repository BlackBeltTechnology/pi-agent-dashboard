# @blackbelt-technology/pi-dashboard-music-production

pi skills for fitting music to video. Python scripts driven by the agent; no
TypeScript runtime, no bin.

| Skill | Does |
|---|---|
| `music-analysis` | local audio → `<stem>_map.json` (`music-map/1`): downbeat-grid tempo, 1-based bars, key, band levels, classed sections, drop candidates; deep tier adds beat_this grid, stems, style tags |
| `music-edit-to-length` | scores joins, cuts the track to length on the grid with click-checked 30 ms crossfades → `<out>.wav` + `<out>_edit.json` (`music-edit/1`) + `.m4a` preview |
| `beat-sync-video` | irregular camera-punch hits from bass re-entries and vocal hooks → `<stem>_hits.json` (`music-hits/1`), scene-grid rules and a HyperFrames adapter |

`hyperframes-showreel` and `footage-redaction` (in `@blackbelt-technology/pi-dashboard-video-production`)
use these skills for the music step of a showreel.

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-music-production
```

## Python environments

The scripts never install packages. Build project-local venvs with [uv](https://docs.astral.sh/uv/)
from the pinned files at the package root (verified: Python 3.14, macOS arm64):

```bash
uv venv -p python3.14 .venv-music && uv pip install --python .venv-music -r requirements-core.txt   # quick tier
uv venv -p python3.14 .venv-mir   && uv pip install --python .venv-mir   -r requirements-mir.txt    # deep tier (multi-GB)
```

A missing module exits 2 with a one-line hint naming the requirements file. `ffmpeg`
is optional (m4a preview, audio extraction).

## Contracts

Three versioned JSON files decouple the steps; each consumer reads only its
producer's file plus the files it references. Paths inside a contract are relative
to that contract file; bars are 1-based (bar *n* starts at `cut_grid.downbeats[n-1]`);
times are seconds with 3 decimals; a consumer rejects an unknown major `schema`.

| Contract | Time base | Producer → consumer |
|---|---|---|
| `music-map/1` | source | `analyze_music.py` / `analyze_mir.py` → `score_joins.py`, `edit_music.py`, `pick_hits.py` |
| `music-edit/1` | video | `edit_music.py` → `pick_hits.py`, the composition generator |
| `music-hits/1` | video | `pick_hits.py` → the composition generator |

Shared helpers (contract load, relative paths, bar/time and source→video mapping,
atomic writes, argv-only ffmpeg, verified model fetch) live in `lib/musiclib.py`.

## Rules

- **No rip.** Only local audio the user supplies (purchased, from the artist, or the
  user's own recording). Nothing is downloaded from a streaming service.
- **Non-commercial tag models.** The Discogs-EffNet tag heads (MTG) are CC BY-NC-SA 4.0.
  They are fetched on first use, sha256-verified, into
  `${XDG_CACHE_HOME:-~/.cache}/pi-music-production/models/` and never redistributed.
  Commercial work: `analyze_mir.py --no-tags`.

## Tests

- `pytest packages/music-production/tests` — quick-tier behaviour on synthetic audio
  (CI job `music-pytest`); deep-tier tests self-skip without `requirements-mir.txt`.
- `npx vitest run --project packages/music-production` — skill-text and wiring invariants.
