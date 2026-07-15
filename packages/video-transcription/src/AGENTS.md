# DOX — packages/video-transcription/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `chunk.ts` | Long-recording chunking. `shiftAndRenumberSrt` (regex timestamp shift + renumber). `transcribeChunked` (single request under limit; else split into `chunkSeconds` pieces via `fs.mkdtemp`, merge with absolute offsets). `DEFAULT_CHUNK_SECONDS`=16200. See change: add-video-transcription-package. |
| `config.ts` | Resolves `SONIOX_API_KEY` (env first, then gitignored `.env` cwd/skillDir). Parses `MAX_CHUNK_HOURS` (default 4.5) + `MAX_AUDIO_MB` (default 200, 0 disables). Fails fast on missing key. Exports `loadConfig`, `parseEnvFile`. See change: add-video-transcription-package. |
| `discover.ts` | File discovery + idempotency. `resolveInputs` (no arg→`~/Movies`, dir→scan, else explicit files). video {.mkv,.mp4,.mov} audio {.m4a,.mp3}. mtime sort oldest-first. `srtPath`/`isTranscribed` skip already-transcribed. `saveSrt`. See change: add-video-transcription-package. |
| `ffmpeg.ts` | ffmpeg/ffprobe wrappers. Uses `execFileAsync` from `@blackbelt-technology/pi-dashboard-shared/platform/exec.js` (repo child_process invariant `no-direct-child-process`), NOT raw `node:child_process`. Wrapper applies `windowsHide:true`. `isFfmpegAvailable`, `extractAudio` (`-vn -acodec libmp3lame -q:a 2`, cleanup partial), `getDurationSeconds` (ffprobe, 0 on fail), `extractChunk` (`-ss -t`). Runner injectable for tests. See change: add-video-transcription-package. |
| `run.ts` | Orchestration core. `run(args, deps)`. config→discover→extract audio if video→`transcribeChunked`→`saveSrt`. Per-file try/catch. ffmpeg-absent skips video, processes audio. Prints summary. deps injectable for tests. See change: add-video-transcription-package. |
| `soniox.ts` | Soniox REST client. `SonioxClient`. upload→create (stt-async-v3, diarization)→poll→`getTranscript`→`deleteFile`→`transcribeFile`. Native fetch+FormData, no SDK. api key never in errors. See change: add-video-transcription-package. |
| `srt.ts` | Pure SRT builder. `formatTimestamp(ms)`→HH:MM:SS,mmm. `groupTokens` (speaker-change + `maxSegmentMs`=5000 boundary). `tokensToSrt`→`[Speaker]` cue. Byte-parity with Python. See change: add-video-transcription-package. |
