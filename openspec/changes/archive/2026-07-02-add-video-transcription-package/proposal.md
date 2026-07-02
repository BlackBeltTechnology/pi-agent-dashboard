# Add a `video-transcription` package (TypeScript port of the standalone skill)

## Why

A standalone pi skill at `~/.pi/agent/skills/video-transcription` transcribes local video/audio to speaker-diarized SRT via the Soniox cloud API. It is useful but lives outside the monorepo: it is Python (bundled venv + `.zip`), ships a committed `.env` secret, and is not published, versioned, or installable by the team.

The skill has **no Python-only dependencies**. Soniox does the transcription in the cloud; the local code is a thin orchestrator over (1) a 5-call REST API and (2) `ffmpeg`/`ffprobe` subprocesses. Every concern maps 1:1 to Node stdlib (`fetch` + `FormData`, `fs.mkdtemp`, regex). This makes it a clean full TypeScript port with **no Python and a single runtime npm dependency** — `@blackbelt-technology/pi-dashboard-shared` for the repo's mandated safe-subprocess wrapper (`platform/exec`, which enforces `windowsHide: true`); everything else rides pi's bundled peers.

Bringing it into `packages/` as a published `@blackbelt-technology/pi-dashboard-*` package gives it versioning, npm distribution, tests, and the same skill+bin surface the team already uses (`document-converter`, `mockup-loop`, `dashboard-plugin-skill`).

## What Changes

Add a new workspace package `packages/video-transcription`, published as `@blackbelt-technology/pi-dashboard-video-transcription`, that is a **full TypeScript port** of the existing skill — dropping Python entirely.

- **TS engine** (`src/`) — port the five Python modules to typed TS:
  - `soniox.ts` — Soniox REST client: upload → create → poll → get transcript → delete. Native `fetch` + `FormData`/`Blob`; no SDK.
  - `srt.ts` — token→segment grouping + `HH:MM:SS,mmm` formatting (pure functions).
  - `chunk.ts` — split recordings over the 5 h Soniox duration limit into `MAX_CHUNK_HOURS` pieces, shift/renumber/merge SRT with absolute timestamps.
  - `ffmpeg.ts` — `execFile` wrappers for audio extraction, `ffprobe` duration, chunk slicing; ffmpeg-availability probe.
  - `discover.ts` — file discovery, `.srt`-sibling idempotency, mtime sort.
- **CLI bin** (`src/bin/transcribe.ts` → `pi-transcribe`) — same argument contract as today: no arg scans `~/Movies`; a directory scans it; file paths transcribe exactly those. Honors `MAX_CHUNK_HOURS` and `MAX_AUDIO_MB` env vars. Prints the found/skipped/transcribed/failed summary. Reused verbatim by the skill.
- **Skill** (`.pi/skills/video-transcription/SKILL.md`) — rewritten to invoke `pi-transcribe` (the bin) instead of the Python script. Same triggers and behavior.
- **Config / secret** — read `SONIOX_API_KEY` from the environment, with an **optional gitignored `.env` fallback** loaded from the working directory or the skill dir. No secret is committed to the package.
- **Package manifest** — `pi.skills` + `bin` + `keywords: [pi-package]`, `peerDependencies` on the pi bundled packages, `files` whitelist. Published under the repo's existing scope alongside the other packages. **Delivery = published, opt-in**: users run `pi install @blackbelt-technology/pi-dashboard-video-transcription`. It is NOT added to the root `package.json` pi manifest and NOT listed in `.pi/settings.json` — it does not auto-load for the repo (matches how `packages/*` are consumed today).
- **Bin runs via jiti, no build step** — `bin: src/bin/transcribe.ts` executes as TypeScript inside pi (jiti loader). Standalone execution in a plain terminal outside pi is out of scope; no compiled JS bin / shebang wrapper is produced.
- **Tests** (`vitest`) — pure-function coverage for SRT formatting, token grouping, chunk shift/renumber/merge; ffmpeg + Soniox calls are mocked (no network, no binaries in CI).

## Capabilities

### Added Capabilities

- `video-transcription` — transcribe local video/audio files in-place to speaker-diarized SRT, with long-recording chunking and idempotent re-runs, exposed as both a pi skill and a `pi-transcribe` CLI.

## Out of Scope

- No change to Soniox model choice, diarization config, or SRT segmentation heuristics — behavior parity with the current skill.
- No new transcription providers, no local/offline ASR.
- Not deleting the existing global skill in `~/.pi/agent/skills/` — migration/decommission is a follow-up once the package is validated.
- No UI/dashboard surface; CLI + skill only.

## Migration, Compatibility, Rollback

- **Migration.** New additive package; nothing in the monorepo depends on it yet. The old global skill keeps working until explicitly removed. Users move by installing the package and (optionally) deleting the global skill.
- **Secret migration.** The committed `.env` is NOT carried over. Users set `SONIOX_API_KEY` in their environment or a local gitignored `.env`.
- **Compatibility.** Output is byte-comparable SRT (same segmentation + timestamp format). Same CLI argument contract, so existing `/transcribe …` invocations behave identically.
- **Rollback.** Remove the package from settings / `packages/`; the global Python skill remains as the fallback. No shared state, no schema, no server changes to revert.
