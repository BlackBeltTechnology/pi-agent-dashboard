---
name: craft-motion-titles
description: Name and title graphics from a transcript with ArtCraft apps - speaker names from an SRT, EffectCraft template alpha renders, FilmCraft overlay, mp4 delivery; verified and resumable. Use for "add lower thirds with the speakers' names", "make animated name titles from the transcript", "put a title card over my interview video".
---

# craft-motion-titles — names from the transcript → alpha lower thirds → overlay on the video

Template-driven motion graphics: EffectCraft renders one transparent ProRes 4444 clip per name, FilmCraft lays them
over the footage on V2. Read `effectcraft` (render flags, alpha trap) and `filmcraft` (playhead and track trap)
first. For free-form titles without a template, use EffectCraft's text layers directly (degraded path below).
Resumable-job rules are in the `craft-studio` router, section **Craft jobs**.

## Step table

| # | Step | Tool | Input → Output | Gate |
|---|---|---|---|---|
| 0 | Preflight + job | agent | request → `job.json` | `check: job` |
| 1 | Names | `speaker-id` / `video-transcription` / the user | named srt → `01-names/names.json` | `check: names` |
| 2 | Template | EffectCraft | `templates.list` → `02-template/choice.json` | `check: template` |
| 3 | Titles | EffectCraft | name + template → `03-titles/<name>.mov` (ProRes 4444 alpha) | `pi-craft verify --alpha` + `check: alpha` |
| 4 | Overlay + delivery | FilmCraft | footage + titles → `04-overlay/final.mp4` | `pi-craft verify` h264 + aac + `--frame-diff` |

Hand-off formats: srt/json in, mov ProRes 4444 with alpha between, mp4 h264 + aac out. Write tolerances as
`${PIC}±0.1` — in bash `$PIC±0.1` swallows the `±` into the variable name.

### Step 0 — Preflight and job

**Output:** `craft-jobs/<slug>/job.json` (created or loaded).
**Gate:** `check: job`.

| Sibling | Package | Check | If missing |
|---|---|---|---|
| `speaker-id` | `video-transcription` | skill in the loaded skill list; `command -v pi-voiceid` | use the anonymous `[Speaker N]` labels, or ask the user for the names |
| `video-transcription` | `video-transcription` | skill in the loaded skill list; `command -v pi-transcribe` | ask the user for the list of names and start times (type `names.json` by hand) or a ready `.srt` |

Package: `pi install npm:@blackbelt-technology/pi-dashboard-video-transcription`. One of the two is enough; with
neither, the user supplies the names. "Loaded skill list" is the available-skills list in your own system prompt; a
loaded skill does not prove its runtime works, so a failed probe counts as absent. Roles/titles are not in an SRT —
ask the user (`ask_user`) for each name's title line.

Set up the job (**Craft jobs** in `craft-studio`: slug rule, `job-helper`) and run **Resume**.

```bash check: job
# run from the directory that contains craft-jobs/ (SLUG set as in step 0)
jq -e '.name and .workflow and (.steps | type == "object")' "craft-jobs/$SLUG/job.json"
```

### Step 1 — Names

**Output:** `01-names/names.json` — `[{"name","title","at"}]`, `at` = seconds into the video.
**Gate:** `check: names`.

From the named SRT (`[Name] text` cues from `speaker-id`): the first turn of each speaker gives the name and the
start time (`awk`, see the recipe); titles come from the user. Titles that overlap in time need separate overlay
tracks (`sequence.addTracks`); this workflow places them sequentially on V2.

```bash check: names
# run inside the step directory: cd "$JOB/01-names" (the file is named as below)
jq -e 'length>0 and all(.[]; .name and .at>=0)' names.json
```

### Step 2 — Template

**Output:** `02-template/choice.json` — the chosen template id and its control names.
**Gate:** `check: template`.

Probed path (EffectCraft 0.10): `templates.list` returns built-in templates with their `controls` — the built-in
`lower-third` has `Name`, `Title`, `Bar Color` at 1920×1080, 30 fps, 6 s; `templates.create {"id":…,"projectPath":…}`
makes a project from it. (`file.newFromTemplate` only opens the GUI's Home tab; `essential.importTemplate` imports a
`.ectemplate` file — use it for a user's own template.) Discover, never guess:

```bash
pi-craft effectcraft exec --empty run templates.list '{}' | jq -c '.[] | {id, controls, width, height, frameRate, duration}'
```

```bash check: template
# run inside the step directory: cd "$JOB/02-template" (the file is named as below)
jq -e '.id and (.controls | index("Name"))' choice.json
```

**Degraded path** — no template with the needed controls: build the title from text layers (`comp.new`,
`layer.newText`, `layer.applyTextPreset`, `prop.addKey` — the `title-alpha` recipe in `effectcraft`), same render
flags, same gates.

### Step 3 — Titles

**Output:** `03-titles/<slug>.mov` per name (ProRes 4444, alpha) and `<slug>.ecproj`.
**Gate:** `pi-craft verify --alpha`, size/duration of the template, **and** `check: alpha` (transparent corner).

Per name: `templates.create` into `03-titles/<slug>.ecproj`; read the layer behind each control with
`essential.list` (the control `Name` is a *property* of a layer, set the layer's `text/sourceText`; `essential.set`
is for precomp layers and fails here); set the text with `set - <layer id> text/sourceText "<value>"`
(`--save`); **delete the template's "Preview Background (delete over footage)" solid** (`project.delete` with its
item id from `info`); render with the alpha flags.

The trap that `--alpha` cannot see: with the preview background still in the project the render is *yuva444p12le with
an opaque background* — `--alpha` passes, the overlay hides the footage. `check: alpha` reads one corner pixel:
it must be fully transparent.

```bash
pi-craft effectcraft exec --project "$P" render --out "$JOB/03-titles/$SLUG.mov" --format prores --prores 4444 --channels rgba
pi-craft verify "$JOB/03-titles/$SLUG.mov" --alpha --size 1920x1080 --duration 6±0.1
```

```bash check: alpha
# run inside the step directory: cd "$JOB/03-titles" (the file is named as below)
test "$(ffmpeg -v error -ss 3 -i title.mov -frames:v 1 -vf crop=1:1:0:0,format=rgba -f rawvideo - | od -An -tx1 | tr -d ' \n')" = 00000000
```

### Step 4 — Overlay and delivery

**Output:** `04-overlay/p.fcproj`, `04-overlay/cut.mp4` (reference) and `04-overlay/final.mp4` (h264 + aac).
**Gate:** `pi-craft verify` — `--codec video=h264 --codec audio=aac`, duration ±0.1 s, `--frame-diff` at every title
(visible, but not replacing the picture) and before the first one (untouched).

FilmCraft: footage on V1 (`file.newSequence` with `fromItem`), export the un-overlaid `cut.mp4`, then for each title
`source.open`, `playhead.set` to its `at`, `source.overwrite` **with the source patched to V2**
(`timeline.setTargeting … sourcePatch:true` on V2, V1 untargeted) — without the patch the title overwrites V1 and
**replaces the footage**. Make the sequence the footage's size and rate (a 1080p template over 720p footage is
scaled).

```bash
pi-craft filmcraft exec --project "$JOB/04-overlay/p.fcproj" export "$JOB/04-overlay/final.mp4" --format h264
pi-craft verify "$JOB/04-overlay/final.mp4" --duration "${PIC}±0.1" --size 1920x1080 --has-video --has-audio \
  --codec video=h264 --codec audio=aac \
  --frame-diff "$T_TITLE:$JOB/04-overlay/cut.mp4>0.1" --frame-diff "$T_TITLE:$JOB/04-overlay/cut.mp4<40" \
  --frame-diff "$T_BEFORE:$JOB/04-overlay/cut.mp4<0.1"
```

A lower third is ~0.5–5 % of the frame; a replaced picture is 50 %+ — the `<40` bound catches the missing source
patch. Keep `cut.mp4` for the job's lifetime.

## Resume

Follow the **Craft jobs** convention in `craft-studio`: read `craft-jobs/<slug>/job.json` as data, confirm the job
name, and start at the first step with no passing report **or** whose recorded inputs (path, size, mtime) changed —
an edited SRT, a replaced footage file or a new `names.json`. Re-run every step downstream of it (a new name list
re-renders the titles and the overlay) and reuse the verified outputs before it. Record each step with the
`job-helper` snippet after its gate passed.

## When a gate fails

Stop at the failed gate; never continue past it. Re-discover the commands you used (`pi-craft effectcraft exec
commands --filter <word>` / `pi-craft filmcraft exec describe <id>`), repeat the step and re-run the gate. At most 2
retries per step; after the second failure stop and report the verify output and what was tried.

## Recipes

```bash recipe: motion-titles-core
# Names from a hand-made named SRT -> Lower Third template -> alpha renders -> V2 overlays -> verified mp4.
PIC=14
ffmpeg -v error -y -f lavfi -i testsrc2=size=1920x1080:rate=30:duration=$PIC -f lavfi -i sine=frequency=330:duration=$PIC \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac footage.mp4
printf '1\n00:00:00,500 --> 00:00:02,000\n[Ann] Welcome to the show.\n\n2\n00:00:07,000 --> 00:00:09,000\n[Bob] Thanks for having me.\n' > named.srt
mkdir -p 01-names 03-titles 04-overlay

# 01 names: first turn of every speaker -> name + start time (titles/roles come from the user)
LC_ALL=C awk 'BEGIN{RS="";FS="\n"} function sec(x,a){split(x,a,/[:,]/);return a[1]*3600+a[2]*60+a[3]+a[4]/1000}
     {split($2,t," --> "); if (match($3,/^\[[^]]+\]/)) { n=substr($3,RSTART+1,RLENGTH-2); if (!(n in seen)) { seen[n]=1; printf "%s\t%.3f\n", n, sec(t[1]) } } }' named.srt > 01-names/first-turns.tsv
jq -R -s -c 'split("\n")|map(select(length>0)|split("\t"))|map({name:.[0],title:"Guest",at:(.[1]|tonumber)})' 01-names/first-turns.tsv > 01-names/names.json
jq -e 'length>0 and all(.[]; .name and .at>=0)' 01-names/names.json

# 03 titles: one alpha render per name from the built-in Lower Third template
pi-craft effectcraft exec --empty run templates.list '{}' | jq -e '.[]|select(.id=="lower-third")|.controls|index("Name")' >/dev/null
jq -c '.[]' 01-names/names.json | while IFS= read -r row; do
  NAME=$(jq -r .name <<<"$row"); TITLE=$(jq -r .title <<<"$row"); SLUG=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
  P=03-titles/$SLUG.ecproj
  pi-craft effectcraft exec --empty run templates.create "{\"id\":\"lower-third\",\"projectPath\":\"$PWD/$P\"}" >/dev/null
  CTRL=$(pi-craft effectcraft exec --project "$P" run essential.list '{}')
  pi-craft effectcraft exec --project "$P" --save set - "$(jq -r '.controls[]|select(.name=="Name")|.layer' <<<"$CTRL")" text/sourceText "$NAME" >/dev/null
  pi-craft effectcraft exec --project "$P" --save set - "$(jq -r '.controls[]|select(.name=="Title")|.layer' <<<"$CTRL")" text/sourceText "$TITLE" >/dev/null
  BG=$(pi-craft effectcraft exec --project "$P" info | awk '/^ *item [0-9]+ +Solid +Preview Background/{print $2}')
  if [ -n "$BG" ]; then pi-craft effectcraft exec --project "$P" --save run project.delete "{\"items\":[$BG]}" >/dev/null; fi
  pi-craft effectcraft exec --project "$P" render --out "03-titles/$SLUG.mov" --format prores --prores 4444 --channels rgba >/dev/null
  pi-craft verify "03-titles/$SLUG.mov" --alpha --size 1920x1080 --duration 6±0.1
  test "$(ffmpeg -v error -ss 3 -i "03-titles/$SLUG.mov" -frames:v 1 -vf crop=1:1:0:0,format=rgba -f rawvideo - | od -An -tx1 | tr -d ' \n')" = 00000000
done

# 04 overlay: FilmCraft, every title on V2 at its start time; the un-overlaid cut is the reference
pi-craft filmcraft exec --save-as 04-overlay/p.fcproj import footage.mp4 03-titles/ann.mov 03-titles/bob.mov > 04-overlay/items.json
FOOT=$(jq -r '.items[0]' 04-overlay/items.json)
echo "{\"id\":\"file.newSequence\",\"params\":{\"name\":\"titles\",\"width\":1920,\"height\":1080,\"fps\":30,\"fromItem\":$FOOT}}" > 04-overlay/cut.jsonl
pi-craft filmcraft exec --project 04-overlay/p.fcproj --save run 04-overlay/cut.jsonl
pi-craft filmcraft exec --project 04-overlay/p.fcproj export 04-overlay/cut.mp4 --format h264
pi-craft verify 04-overlay/cut.mp4 --duration ${PIC}±0.1 --size 1920x1080 --has-video
{ echo '{"id":"timeline.setTargeting","params":{"track":"V2","sourcePatch":true,"targeted":true}}'
  echo '{"id":"timeline.setTargeting","params":{"track":"V1","targeted":false}}'
  jq -c --argjson ids "$(jq -c '.items[1:]' 04-overlay/items.json)" 'to_entries[] | {id:"source.open",params:{item:$ids[.key]}}, {id:"playhead.set",params:{seconds:.value.at}}, {id:"source.overwrite",params:{}}' 01-names/names.json; } > 04-overlay/overlay.jsonl
pi-craft filmcraft exec --project 04-overlay/p.fcproj --save run 04-overlay/overlay.jsonl
pi-craft filmcraft exec --project 04-overlay/p.fcproj export 04-overlay/final.mp4 --format h264
pi-craft verify 04-overlay/final.mp4 --duration ${PIC}±0.1 --size 1920x1080 --has-video --has-audio --codec video=h264 --codec audio=aac \
  --frame-diff 3.5:04-overlay/cut.mp4\>0.1 --frame-diff 3.5:04-overlay/cut.mp4\<40 --frame-diff 10:04-overlay/cut.mp4\>0.1 --frame-diff 0.2:04-overlay/cut.mp4\<0.1
```
