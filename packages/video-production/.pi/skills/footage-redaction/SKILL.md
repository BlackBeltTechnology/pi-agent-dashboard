---
name: footage-redaction
description: "Bake redaction into screen-recording or camera footage from a JSON spec: fixed crops, time-windowed logo removal, and blurs that switch on only while a detected UI element is on screen, then verify on contact sheets. Use on \"redact this recording\", \"blur the IP / e-mail / URL\", \"remove the watermark\", \"cut clips with redaction baked in\"."
---

# footage-redaction

`scripts/redact.py` cuts one clip and bakes its redaction in a single ffmpeg pass.
It needs only Python 3 (standard library) and ffmpeg/ffprobe — no venv.

## Spec

```json
{
  "trim":  {"from": 47.0, "to": 59.0},
  "speed": 1.0,
  "fps":   30,
  "crop":  {"top": 125, "bottom": 90, "left": 0, "right": 0},
  "delogo": [{"x": 750, "y": 410, "w": 640, "h": 110, "from": 0, "to": 46.9}],
  "blur_when": [{"x": 836, "y": 338, "w": 180, "h": 56, "pad_s": 0.25,
                 "detect": {"x": 820, "y": 300, "w": 220, "h": 30,
                            "rgb": [20, 40, 90], "tol": 30, "min_ratio": 0.6}}]
}
```

- **Coordinate rule** — every box (`delogo`, `blur_when` target and `detect`) is in
  SOURCE-frame pixels, before crop and scale, and every time is on the UNTRIMMED source
  timeline. Measure boxes on a full-resolution source frame; never on a cropped clip.
- Filter order: trim → delogo → blur → crop → speed → fps → encode.
- `blur_when`: the detect box is sampled every 0.25 s; it is active when at least
  `min_ratio` of its pixels are within `tol` of `rgb` (e.g. a popup's navy header).
  Active samples merge into windows padded by `pad_s`; the blur runs only inside them.
  Keep the detect box small (a thin strip of the popup header or status bar): detection
  is pure Python and its cost grows with box area × clip length.
- Validation rejects a bad spec before writing anything, naming the field
  (`blur_when[0].detect.min_ratio`, `delogo[0]` …).

## Run

```bash
python3 scripts/redact.py src.mov clips/c05.mp4 --spec c05.redact.json --dry-run   # windows + filter graph
python3 scripts/redact.py src.mov clips/c05.mp4 --spec c05.redact.json [--crf 16] [--strict]
```

`--dry-run` prints the resolved windows and graph and writes nothing — iterate on the
spec with it. A detector that never fires prints a warning; `--strict` makes it an
error. Output is written to `<out>.partial` and renamed only on success.

## Per-clip caller loop

Keep the project's own shot table (clip id, source, in/out, speed, redaction spec) in
the project, and call `redact.py` once per clip:

```bash
while IFS=, read -r id src from to speed spec; do
  jq --argjson f "$from" --argjson t "$to" --argjson s "$speed" '.trim={from:$f,to:$t} | .speed=$s' "$spec" > "/tmp/$id.json"
  python3 "$SKILL/scripts/redact.py" "$src" "clips/$id.mp4" --spec "/tmp/$id.json" --strict
done < clips.csv
```

## Verification (mandatory)

Before any redacted clip is used, check it on a **contact sheet** at the known
sensitive timecodes (popup open/close, page loads, hover states):

```bash
ffmpeg -v error -i clips/c05.mp4 -vf "fps=4,scale=480:-2,tile=6x5" -frames:v 1 c05_sheet.png
ffmpeg -v error -ss 3.5 -i clips/c05.mp4 -frames:v 1 c05_at_3.5.png   # a specific moment, full size
```

Look at every tile. **OCR is insufficient**: it misses transient text such as a
browser status-bar URL that flashes for a few frames on hover — only the eye on the
contact sheet (and full-size frames at each sensitive moment) catches it. When in doubt,
crop the whole bar rather than chasing it with a timed blur.
