# Presets

Canvas 1920×1080; PIP box 480×270 at bottom-right with a 20 px margin (ported from OBS-Transcribe
`setup-scenes.ts`). All presets: current scene collection only, idempotent by name, never change an existing
input's settings, never switch collections.

| Preset | Creates |
|---|---|
| `webcam` | scene `Webcam` + input `Webcam Full` (camera, full canvas) |
| `desktop` | scene `Desktop` + input `Desktop Full` (screen capture, full canvas) |
| `desktop-webcam-pip` | scene `Desktop + Webcam`: `Desktop Combined` (full) + `Webcam Box` (PIP) + green chroma-key filter on `Webcam Box` |
| `pip-bgremoval` | same scene, AI `background_removal` filter on `Webcam Box` (`plugin-missing` when the plugin is absent) |
| `subtitles` | shared text input `Subtitles` (48 pt bold white, outlined, 1600 px wide) bottom-centre in `Webcam`, `Desktop`, `Desktop + Webcam` |

Item status: `created` · `existing` · `incomplete` (an existing scene lacks an expected item; nothing is added) ·
`skipped` · `plugin-missing`. Devices are bound only for inputs the run created.
