# @blackbelt-technology/pi-dashboard-video-production

TypeScript port of the standalone `veo-generator` + `veo-showreel-production-kit`
pi skills — no Python. Parses a scripted shot package (`shots/*.md`) and renders
one mp4 clip per camera cut with the Google **Veo 3.1** API, reusing the prompt,
negative prompt, seed, aspect/resolution, reference image and first-frame sketch
written in each shot file. Storyboard first-frames are generated via nano-banana.

Exposed as:

- **pi skills** — `veo-showreel-production-kit` (prompting) + `veo-generator` (render).
- **CLI bin** — `pi-veo` (`parse` / `plan` / `render` / `storyboard`).

## Usage

```bash
pi-veo parse <Project>                       # dry-run: validate the shot package
pi-veo plan <Project>                        # resolve key/model/outputs, no API call
pi-veo render <Project> --shots 01           # render one shot
pi-veo render <Project> --model fast --resolution 720p   # cheap preview pass
pi-veo render <Project> --parallel 4         # independent shots, N concurrent
pi-veo render <Project> --chain              # seamless A→B (ffmpeg last-frame handoff)
pi-veo storyboard <Project>                  # (re)generate first-frame sketches
```

`<Project>` may be a project dir, a `video_production` dir, or a `shots` dir.
Rendered clips land in `<package>/renders/`; already-rendered shots are skipped
unless `--force`.

## API key

`VEO_API_KEY` (or `GEMINI_API_KEY` / `GOOGLE_API_KEY`) resolves from, in order:
`--api-key`, the environment, a project-local `.env` (project + up to two parents),
then this package's `.env`. Copy [`.env.example`](.env.example). Nothing committed.

## Prerequisites

- Node (runs as TypeScript via pi's jiti loader — no build step).
- `@google/genai` (bundled dependency) + a Veo-enabled Gemini API key.
- `ffmpeg` on PATH — only for `--chain`.
- Network access for `npx` (storyboard step fetches the nano-banana CLI).

## Programmatic API

```ts
import { renderShots, planRender } from "@blackbelt-technology/pi-dashboard-video-production/render.js";
import { inspectPackage } from "@blackbelt-technology/pi-dashboard-video-production/inspect.js";
import { generateStoryboard } from "@blackbelt-technology/pi-dashboard-video-production/storyboard.js";
```

The Veo client is injectable (`clientFactory`) so rendering logic is testable
without the SDK or network.
