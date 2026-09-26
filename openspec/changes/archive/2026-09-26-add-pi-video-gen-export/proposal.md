## Why

Our video-production kit renders only through Google Veo (Gemini Developer API), and its final step — cutting clips, laying the official voiceover + music, captions, logo end-card — is prose-only ("assemble in post"). The published pi extension `@amaster.ai/pi-video-gen` (Apache-2.0) adds multi-provider AI rendering (Seedance 2.0, Kling 3.0, MiniMax-H3, …) with resume/no-double-billing, plus a local picture-edit timeline (`video_compose`). A sandboxed spike (0.1.18) confirmed a shot book shaped like ours passes its render preflight on Seedance/Kling/MiniMax/OpenRouter-Veo — but it ships **no importable library API** and its timeline **cannot carry a pre-recorded voiceover, music level, or SRT captions**. We want to reuse our shot books on those providers and automate post-production without coupling to the package's internals.

## What Changes

- **Shot-book sidecars (kit output).** The `veo-showreel-production-kit` skill additionally emits machine-readable JSON next to the existing markdown: `video_production/film.json` (film-level style / consistency / negative / characters / aspect), `shots/shot_NN.json` (per-shot structured prompt fields `visuals` / `action` / `scene` / `effects` / `audio` / `visibleCharacters` plus `durationSec` — only what the markdown lacks; first frame, seamless flag, seed stay in the markdown), and `video_production/timeline.json` (shot order, trims, transitions, text overlays, end-card image, voiceover + music files and levels, captions SRT). `shots/*.md` stays the Veo render source; the sidecars are emitted from the same data.
- **`pi-veo export render <target>`** — new subcommand. Reads the sidecars and writes `<cwd>/.video-gen/<jobId>/render-input.json` in pi-video-gen's documented render-spec format. SEAMLESS → `lastFramePath` = next shot's first-frame sketch. Runs its own preflight (integer durations, frames inside cwd, optional capability flags `--durations`, `--aspect`, `--no-last-frame`) because pi-video-gen has no dry-run. Never reuses an existing job dir, and refuses to mint a second render job for the same package while a previously exported spec still exists (package-local registry `.pi-veo/exports.json`) unless `--new-job` (re-exporting after an interrupted render would re-bill every shot — resume is re-calling `video_render` on the existing spec). Warns on dropped fields (seed, per-shot resolution, reference images).
- **`pi-veo export timeline <target> --clips <dir>`** — new subcommand. Writes `<cwd>/.video-gen/<jobId>/timeline-input.json` for `video_compose`: picture edit only (clip order, trims, transitions, text overlays, end-card image segment, ambient source-audio level). No narration, no BGM, no subtitles in the spec (no Edge TTS network use).
- **`pi-veo mux <target> --picture <mp4>`** — new subcommand. Local ffmpeg final mix: picture's ambient audio + official voiceover + music at `timeline.json` levels, plus captions from an SRT (soft `mov_text` by default; `--burn` when ffmpeg has the `subtitles` filter). Writes `video_production/master/master.mp4`.
- `pi-veo parse` reports sidecar state and validation problems for sidecar-enabled packages; its output for packages without `film.json` is unchanged.
- `veo-generator` skill documents the optional pi-video-gen path (user-level `pi install npm:@amaster.ai/pi-video-gen`, never a dependency of this package), including the provider trade-offs found in the spike.

Non-goals: replacing `pi-veo render` (Veo direct stays the 4K/seed path); importing pi-video-gen code; upstream PRs to pi-video-gen; generating the markdown shots from JSON.

## Capabilities

### New Capabilities
- `video-production-sidecars`: film/shot/timeline JSON sidecar schema, loading and validation.
- `video-production-export`: `export render` / `export timeline` spec generation for pi-video-gen, with local preflight and job-dir rules.
- `video-production-mux`: final local audio/caption mux over a picture-edit mp4.

### Modified Capabilities
- `video-production-cli`: subcommand dispatch gains `export` (with `render` / `timeline` sub-modes) and `mux`; new flags (`--capabilities`-style flags, `--clips`, `--picture`, `--job`, `--burn`).
- `video-production-inspect`: `parse` report includes sidecar presence and sidecar validation problems.

## Impact

- `packages/video-production/src/` — new `sidecars.ts`, `export.ts`, `mux.ts`; `bin/veo.ts` dispatch; `inspect.ts` report fields. Tests under `src/__tests__/`.
- `packages/video-production/.pi/skills/veo-showreel-production-kit/SKILL.md` + `veo-generator/SKILL.md` — sidecar emission + pi-video-gen path.
- `packages/video-production/package.json` — optional `ffprobe` entry in `pi.tools` (for `mux`).
- `packages/video-production/README.md`, `AGENTS.md` rows.
- External runtime (optional, user-installed): `@amaster.ai/pi-video-gen`, verified against **0.1.18** (0.1.x formats may change; later versions unverified) — file-format coupling only (render-input.json / timeline-input.json, documented in its skill). `ffmpeg` (already an optional `pi.tools` entry) required for `mux`.
- No new npm dependencies. No persistence/migration. Existing `parse` / `plan` / `render` / `storyboard` behavior unchanged for packages without sidecars. Rollback = revert; sidecars are additive files.

## Discipline Skills

- `security-hardening`: `export` writes paths into specs consumed by a third-party extension and `mux` shells out to ffmpeg with sidecar-supplied paths — validate containment under cwd, reject symlink escapes, pass args as an argv array (no shell).
- `doubt-driven-review`: coupling to a 0.1.x third-party file format is a public-contract bet; review before it stands (planning step).
- `review-code`: before commit, per project doctrine.
- Not triggered: `performance-optimization` (no latency budget; local CLI), `observability-instrumentation` (no endpoint/job/external call added — the paid call is made by pi-video-gen, not us).
