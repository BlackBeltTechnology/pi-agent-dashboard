# DOX — packages/video-transcription

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `.pi/skills/video-transcription/SKILL.md` | NL-triggered skill (/transcribe): video/audio → speaker-diarized SRT via Soniox async API. Backs pi-transcribe CLI (TS port, no Python). In-place sibling .mp3 + .srt. Args: none → ~/Movies, dir, or file paths. Pool TRANSCRIBE_CONCURRENCY (default 8, clamp 1-100). >5h duration cap → split MAX_CHUNK_HOURS (default 4.5h) chunks, merge with absolute timestamps (ffprobe probes duration, not MB). Needs ffmpeg/ffprobe; SONIOX_API_KEY env → gitignored .env. |
| `README.md` | Package overview. Transcribe local video/audio in-place to speaker-diarized SRT via Soniox async API. Full TS port of standalone `video-transcription` pi skill, no Python. Only runtime dep `@blackbelt-technology/pi-dashboard-shared`. Exposed as pi skill (`.pi/skills/video-transcription`, `/transcribe`) + CLI bin `pi-transcribe`. Needs `ffmpeg`/`ffprobe` on PATH. |
| `vitest.config.ts` | Vitest config for video-transcription package. `include` `src/**/__tests__/**/*.test.ts`, `environment` node, `pool` forks, `maxWorkers` 1, `testTimeout` 30000. |
