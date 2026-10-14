---
name: filmcraft
description: Headless non-linear video editing with FilmCraft (~700 commands), provisioned on demand by pi-craft - import clips, build a sequence, place/insert/trim media on the timeline, add effects, export h264+aac mp4. Use for "assemble these clips into one video", "put clip B after clip A", "cut a section out of this mp4", "export the edit as an mp4", "make a rough cut from these shots".
---

# FilmCraft — headless video editing

FilmCraft is ArtCraft's non-linear editor (projects, bins, sequences, tracks, clips, effects). `pi-craft`
provisions the headless `filmcraft-cli` (no desktop app). Choosing between apps, the discover → execute →
save → verify loop and the MCP policy live in `craft-studio`; this skill is the FilmCraft dialect and its traps.

## What it is for / formats

Edits video + audio on a timeline. Reads common media (mp4, mov, wav…; `probe <media>` shows what it sees);
exports `h264 hevc prores dnxhr mjpeg gif png tiff wav aac …` (`export --list-presets`). Project file: `.fcproj`.
For motion graphics / alpha titles use EffectCraft (hand-off: mov ProRes 4444); for audio work SoundCraft (wav).

## CLI dialect

`pi-craft filmcraft exec <args…>` passes `<args…>` to `filmcraft-cli`. **`exec` appears twice** for a single
command: the first is `pi-craft`'s verb, the second is `filmcraft-cli`'s subcommand.

```bash
pi-craft filmcraft exec commands [filter] [--json]        # list ids (filter = substring; --filter word also works)
pi-craft filmcraft exec describe <id>                     # one command: params + "enabled" right now
pi-craft filmcraft exec [opts] exec <id> key=value …      # one command (value is JSON if it parses: seconds=3.5 item=2)
pi-craft filmcraft exec [opts] exec <id> '{"seconds":3}'  # same, params as one JSON object
pi-craft filmcraft exec [opts] run script.jsonl [--keep-going]   # one {"id","params"} per line, # comments ok
pi-craft filmcraft exec import a.mp4 b.mp4                # prints the new project item ids
pi-craft filmcraft exec [opts] export out.mp4 --format h264 [--start S --end S] [--scale 0.5] [--no-audio]
pi-craft filmcraft exec [opts] inspect [project|sequence] [--compact]    # JSON tree; ids, clip times (ticks)
pi-craft filmcraft exec probe clip.mp4
```

**Options go before the subcommand**: `--project p.fcproj`, `--save`, `--save-as new.fcproj`, `--keep-going`
(for `run`), `--compact` (one-line JSON). Times are ticks (254016000000 per second); most commands also take
`seconds=`, `frame=` or `timecode=`.

## State and persistence

Each invocation loads the project, runs, and exits. **The project file is the only state**: pass
`--project p.fcproj` to open it, add `--save` (in place) or `--save-as other.fcproj` to write it back.
Without a save flag, edits are discarded. A new project is made by `--save-as p.fcproj import …`
(`--project` on a missing file fails). **Transient editor state is *not* saved**: the Source monitor
(`source.open`) and the targeted tracks do not survive to the next invocation, so
`source.open` → `source.overwrite` must be steps of one `run` script — separate `exec` calls fail with
"no clip in the Source monitor". Rendering also creates a `FilmCraft Previews/` folder next to the cwd.

## Discovery first

Ids change between releases — never guess them.

```bash
pi-craft filmcraft exec commands razor                    # id, label, shortcut, param schema
pi-craft filmcraft exec describe source.overwrite         # "enabled": false + why, when it cannot run now
pi-craft filmcraft exec inspect project --compact         # item ids (use these for source.open item=…)
pi-craft filmcraft exec export --list-presets h264
```

## Traps

- **`source.overwrite` and `source.insert` place the source clip at the *current playhead*** — not at "the end"
  and not at a time you meant. Always set it explicitly with `playhead.set` (`seconds=`) immediately before each
  placement. Where it sits after `file.newSequence` depends on the steps before (seen at 0 s inside one run, at the sequence end after a reopen); never rely on it.
- **A mistyped id in a script fails only that line.** With `--keep-going` the run continues and exits 1 *after*
  the later steps ran: `source.overwrite` then lands at the wrong time and the export is a **valid but wrong**
  file (observed 3 s instead of 5 s, an `a.mp4` overwritten by `b.mp4`). Without `--keep-going` the run stops at
  the first failure, exits 1 and saves nothing. So: discover ids, avoid `--keep-going` for assembly,
  and always `pi-craft verify` the duration / a frame of the export.
- `source.overwrite` replaces what is under the placed range; `source.insert` ripples later media to the right.
  Use overwrite to extend at the end, insert to splice in the middle.
- `file.newSequence` with `fromItem=<id>` already places that item at 0; `source.open item=<id>` is then needed
  for every *further* clip. Targeting (`timeline.setTargeting`) decides which tracks receive the source's video
  and audio; the default of a fresh sequence takes both.
- `--project` must exist; use `--save-as` for the first save. `export` renders the *active* sequence.
- Exit `1` also means "offline media rendered as placeholders" — fix paths instead of `--allow-offline`.
- Linux needs glibc ≥ 2.35. `.pi/mcp.json` is only written by `pi-craft filmcraft mcp --register` (opt-in).

## MCP route (opt-in)

`pi-craft filmcraft mcp --register` adds a `craft-filmcraft` entry (17 tools: `command_run`, `command_batch`,
`media_import`, `render_frame`, `render_preview`, … plus `ui_*`). **The FilmCraft MCP server is not path-confined**
(it reads and writes any path you can), so `mcp` / `--register` need `--allow-unconfined` — tell the user
first. Prefer the bash route. Bridging to a running GUI (`--bridge`) is out of scope.

## Recipes

```bash recipe: assemble-two-clips
# a.mp4 (3 s) then b.mp4 (2 s) in one sequence; b is placed at an explicit time.
ffmpeg -v error -y -f lavfi -i testsrc=size=640x360:rate=25:duration=3 -f lavfi -i sine=frequency=440:duration=3 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac a.mp4
ffmpeg -v error -y -f lavfi -i smptebars=size=640x360:rate=25:duration=2 -f lavfi -i sine=frequency=880:duration=2 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac b.mp4
pi-craft filmcraft exec --save-as p.fcproj import a.mp4 b.mp4        # items 1 and 2
cat > assemble.jsonl <<'EOF'
{"id":"file.newSequence","params":{"name":"cut","width":640,"height":360,"fps":25,"fromItem":1}}
{"id":"source.open","params":{"item":2}}
{"id":"playhead.set","params":{"seconds":3}}
{"id":"source.overwrite","params":{}}
EOF
pi-craft filmcraft exec --project p.fcproj --save run assemble.jsonl
pi-craft filmcraft exec --project p.fcproj export out.mp4 --format h264
pi-craft verify out.mp4 --duration 5±0.1 --has-video --has-audio --size 640x360 --codec video=h264 --codec audio=aac \
  --frame-diff 4:b.mp4@1\<2
```

```bash recipe: place-at-explicit-time
# Leave a 1 s gap: b is placed at 4 s, so the 3 s clip a ends before it. The explicit playhead.set decides.
ffmpeg -v error -y -f lavfi -i testsrc=size=640x360:rate=25:duration=3 -f lavfi -i sine=frequency=440:duration=3 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac a.mp4
ffmpeg -v error -y -f lavfi -i smptebars=size=640x360:rate=25:duration=2 -f lavfi -i sine=frequency=880:duration=2 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac b.mp4
pi-craft filmcraft exec --save-as p.fcproj import a.mp4 b.mp4
cat > gap.jsonl <<'EOF'
{"id":"file.newSequence","params":{"name":"gap","width":640,"height":360,"fps":25,"fromItem":1}}
{"id":"source.open","params":{"item":2}}
{"id":"playhead.set","params":{"seconds":4}}
{"id":"source.overwrite","params":{}}
EOF
pi-craft filmcraft exec --project p.fcproj --save-as gap.fcproj run gap.jsonl
pi-craft filmcraft exec --project gap.fcproj export gap.mp4 --format h264
pi-craft verify gap.mp4 --duration 6±0.1 --has-audio --frame-diff 4.5:b.mp4@0.5\<2
```

```bash recipe: insert-and-range-export
# source.insert at 1 s splices b into the middle of a (3 s + 2 s = 5 s); then export only 1 s … 3 s.
ffmpeg -v error -y -f lavfi -i testsrc=size=640x360:rate=25:duration=3 -f lavfi -i sine=frequency=440:duration=3 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac a.mp4
ffmpeg -v error -y -f lavfi -i smptebars=size=640x360:rate=25:duration=2 -f lavfi -i sine=frequency=880:duration=2 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac b.mp4
pi-craft filmcraft exec --save-as p.fcproj import a.mp4 b.mp4
cat > ins.jsonl <<'EOF'
{"id":"file.newSequence","params":{"name":"ins","width":640,"height":360,"fps":25,"fromItem":1}}
{"id":"source.open","params":{"item":2}}
{"id":"playhead.set","params":{"seconds":1}}
{"id":"source.insert","params":{}}
EOF
pi-craft filmcraft exec --project p.fcproj --save-as ins.fcproj run ins.jsonl
pi-craft filmcraft exec --project ins.fcproj export full.mp4 --format h264
pi-craft verify full.mp4 --duration 5±0.1 --frame-diff 0.5:a.mp4@0.5\<1 --frame-diff 1.5:a.mp4@1.5\>30
pi-craft filmcraft exec --project ins.fcproj export part.mp4 --format h264 --start 1 --end 3
pi-craft verify part.mp4 --duration 2±0.1 --has-video
```

```bash recipe: typo-fails-loudly
# A mistyped id (plahead.set) aborts the script: exit 1, nothing saved. --keep-going instead yields a wrong file.
ffmpeg -v error -y -f lavfi -i testsrc=size=640x360:rate=25:duration=3 -f lavfi -i sine=frequency=440:duration=3 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac a.mp4
ffmpeg -v error -y -f lavfi -i smptebars=size=640x360:rate=25:duration=2 -f lavfi -i sine=frequency=880:duration=2 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac b.mp4
pi-craft filmcraft exec --save-as p.fcproj import a.mp4 b.mp4
cat > typo.jsonl <<'EOF'
{"id":"file.newSequence","params":{"name":"cut","width":640,"height":360,"fps":25,"fromItem":1}}
{"id":"source.open","params":{"item":2}}
{"id":"plahead.set","params":{"seconds":3}}
{"id":"source.overwrite","params":{}}
EOF
if pi-craft filmcraft exec --project p.fcproj --save-as bad.fcproj run typo.jsonl; then echo "typo went unnoticed"; exit 1; fi
test ! -e bad.fcproj
pi-craft filmcraft exec --project p.fcproj --save-as bad.fcproj run typo.jsonl --keep-going || true
pi-craft filmcraft exec --project bad.fcproj export wrong.mp4 --format h264
# the surviving line placed b at the playhead (0 s), over a: 3 s, not the intended 5 s — only verify catches it
pi-craft verify wrong.mp4 --duration 3±0.1
```
