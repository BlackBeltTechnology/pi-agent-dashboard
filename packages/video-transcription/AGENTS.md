# DOX — packages/video-transcription

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Transcribe local video/audio in-place to speaker-diarized SRT via Soniox async API. Full TS port of standalone `video-transcription` pi skill, no Python. Only runtime dep `@blackbelt-technology/pi-dashboard-shared`. Exposed as pi skill (`.pi/skills/video-transcription`, `/transcribe`) + CLI bin `pi-transcribe`. Needs `ffmpeg`/`ffprobe` on PATH. |
| `vitest.config.ts` | Vitest config for video-transcription package. `include` `src/**/__tests__/**/*.test.ts`, `environment` node, `pool` forks, `maxWorkers` 1, `testTimeout` 30000. |
