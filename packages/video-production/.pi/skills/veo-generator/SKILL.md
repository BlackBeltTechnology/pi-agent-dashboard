---
name: veo-generator
description: >
  Render a scripted video project into mp4 clips with the Google Veo 3.1 API.
  Reads a project's shot package (the shots/*.md format produced by the
  veo-showreel-production-kit) and generates one clip per camera cut — reusing
  the Full Veo prompt, negative prompt, seed, aspect/resolution, world-anchor
  reference and first-frame storyboard sketch already written in each shot file.
  Backed by the `pi-veo` CLI (a TypeScript port — no Python). API key is
  configurable per project via a .env.
  Use when: "render the Veo video for <project>", "generate the videos from the
  shot scripts", "make the clips with Veo", "re-render shot 03B".
---

# Veo Generator

Turns an already-scripted shot package into actual video. The **prompting** is done
by the `veo-showreel-production-kit` skill (STYLE BIBLE → per-shot `shots/*.md`);
this skill is the **render step** that calls the Veo 3.1 API and downloads mp4s.

It expects the layout the production kit emits:

```
<Project>/
  .env                      <- (optional) per-project API key lives here
  video_production/
    shots/shot_*.md         <- source of truth: prompt, negative, seed, aspect, refs
    storyboard/*.png        <- first-frame sketches + 00_world_anchor.png
    renders/                <- mp4 output (created here)
```

Each `shots/shot_NN.md` already contains everything the renderer needs: the
**▶ Full Veo prompt** block, the **⛔ Negative prompt** block, and a
**Reproduction & consistency** line with the seed, aspect ratio, resolution,
reference image(s) and first-frame image. The renderer parses those — it never
re-invents the prompt.

## Prerequisites

- The `pi-veo` CLI (this package). Runs as TypeScript via pi's jiti loader — no build step.
- **ffmpeg** — only needed for `--chain` (seamless A→B last-frame handoff).
- An API key (see below). Get one at <https://aistudio.google.com/apikey>.

## API key — per project or global

Resolution order, **first non-empty wins**:

| # | Source | Use |
|---|--------|-----|
| 1 | `--api-key <KEY>` flag | one-off |
| 2 | `VEO_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY` env var | machine-wide |
| 3 | **`<Project>/.env`** or `…/video_production/.env` | **per-project key** |
| 4 | this package's `.env` | global fallback |

Copy [`.env.example`](.env.example) and set `VEO_API_KEY=…`. Never commit real keys.

## Procedure

1. **Dry-run / validate the package** (no key spent):
   ```bash
   pi-veo parse <Project>
   ```
   Confirms every shot has a parseable prompt, shows seed/aspect/resolution, the
   first-frame sketch, the reference image and seamless→next chaining. Add
   `--json` for machine output, `--shots 01 03A` for a subset.

2. **Plan the render** (resolves key + model + outputs, still no API call):
   ```bash
   pi-veo plan <Project>
   ```

3. **Render** (calls Veo, polls, downloads to `video_production/renders/`):
   ```bash
   pi-veo render <Project>
   ```
   - Test a single shot first: `--shots 01`
   - Cheaper/faster preview pass: `--model fast --resolution 720p`
   - Seamless A→B handoff (sequential, uses ffmpeg last frame): `--chain`
   - Render several independent shots at once: `--parallel 4`
   - Also attach the world-anchor as a reference image: `--with-reference`
   - Re-render existing clips: `--force`
   Already-rendered `shot_NN.mp4` files are **skipped** unless `--force`, so the
   command is safe to re-run / resume.

4. **(Optional) regenerate storyboard sketches** (the first-frame images) via
   nano-banana, if they're missing or you changed `sketch_prompts.json`:
   ```bash
   pi-veo storyboard <Project>
   ```

5. **Assemble in post** — cut the `renders/*.mp4` in timecode order, lay the
   official voiceover + music, bake captions, drop the logo into the reserved
   space of the final shot. (Veo only makes ambient SFX — speech is forbidden in
   the AUDIO LOCK on purpose.)

## Notes & pitfalls

- **Veo clips are ≤8s.** The shot package is already split into ≤8s units; don't
  merge them. Long beats are A/B pairs.
- **Model IDs:** `standard` → `veo-3.1-generate-preview`, `fast` →
  `veo-3.1-fast-generate-preview`. Pass a full id to `--model` to use another.
- **Resolution `4k`** is Veo 3.1 preview only and is slower + pricier; use
  `--resolution 1080p` (or `720p` for cheap previews) to override the shot files.
- **Parallel rendering:** by default shots render one-at-a-time. `--parallel N`
  keeps up to N Veo operations in flight; the real ceiling is your **Veo API
  quota**. `--chain` **forces sequential** (B needs A's rendered last frame).
- **first-frame vs reference:** by default the shot's own storyboard sketch is the
  image-to-video first frame. `--with-reference` *additionally* sends the
  world-anchor as an `asset` reference; if the model rejects that combo the
  renderer automatically retries without it.
- **Cost:** every render call spends credits. Always `parse` → `plan` → render one
  shot → then the batch.
- **Gemini Developer API quirks (AI Studio key):** the Developer API rejects `seed`
  and `enhance_prompt`. Use **`--no-seed`** (and leave enhance_prompt off — it's
  opt-in via `--enhance-prompt`, Vertex only). Reproducibility then relies on the
  first-frame sketches + STYLE LOCK, not the seed.
- **Vertex env trap:** if `GOOGLE_GENAI_USE_VERTEXAI=true` / `GOOGLE_CLOUD_PROJECT`
  are exported, the client routes to Vertex and fails. Unset them to force the
  Developer API.
- **Logs:** each run appends to `renders/render_log.jsonl` (status, seed, model,
  resolution, output path, seconds) for auditing.
