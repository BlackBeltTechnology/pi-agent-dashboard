# Tasks

> Full TypeScript port of the standalone video-transcription skill into `packages/video-transcription`, published as `@blackbelt-technology/pi-dashboard-video-transcription`. Behavior parity with the Python original. TDD: golden-output tests for pure logic first.

## 1. Package scaffold

- [x] 1.1 Create `packages/video-transcription/` with `package.json` (`name: @blackbelt-technology/pi-dashboard-video-transcription`, `type: module`, `keywords: [pi-package]`, `peerDependencies: { @earendil-works/pi-coding-agent: "*", typebox: "*" }`, `bin: { "pi-transcribe": "src/bin/transcribe.ts" }`, `pi: { skills: [".pi/skills/video-transcription"] }`, `files: ["src/", "!src/__tests__", ".pi/skills/", "README.md"]`).
- [x] 1.2 Add `tsconfig.json` + `vitest.config.ts` matching sibling packages (`mockup-loop`, `document-converter`).
- [x] 1.3 Add `.gitignore` entry for `.env` inside the package; add `README.md` (usage, prereqs: ffmpeg, SONIOX_API_KEY).
- [x] 1.4 Verify `npm install` at repo root picks up the new workspace (`packages/*`).
- [x] 1.5 Do NOT register in root `package.json` pi manifest or `.pi/settings.json` — delivery is published + opt-in (`pi install`). Confirm the bin runs via jiti with no build step (inside pi only).

## 2. Config / secret resolution (`src/config.ts`)

- [x] 2.1 Resolve `SONIOX_API_KEY` from `process.env` first; fall back to parsing a gitignored `.env` (cwd, then skill dir). No committed secret.
- [x] 2.2 Resolve `MAX_CHUNK_HOURS` (default 4.5) and `MAX_AUDIO_MB` (default 200, `0` disables) from env.
- [x] 2.3 Fail fast with an actionable message when the API key is unresolved.
- [x] 2.4 Tests: env wins over `.env`; missing key throws; env var parsing/defaults.

## 3. SRT builder (`src/srt.ts`) — pure logic, TDD

- [x] 3.1 Port `_format_timestamp` → `formatTimestamp(ms): HH:MM:SS,mmm`.
- [x] 3.2 Port `_group_tokens_into_segments` (speaker-change + `maxSegmentMs=5000` boundary) → `groupTokens`.
- [x] 3.3 Port `_convert_to_srt` (segment → `[Speaker] text` cue) → `tokensToSrt`.
- [x] 3.4 Golden tests: fixed token arrays produce byte-identical SRT to the Python output.

## 4. Soniox client (`src/soniox.ts`)

- [x] 4.1 `uploadFile` — multipart POST `/v1/files` via `fetch` + `FormData`; return file id.
- [x] 4.2 `createTranscription` — POST `/v1/transcriptions` with `{ model: "stt-async-v3", enable_speaker_diarization: true, enable_language_identification: true, file_id }`.
- [x] 4.3 `waitForCompletion` — poll `GET /v1/transcriptions/:id` until `completed`; throw structured error on `failed`/`error`.
- [x] 4.4 `getTranscript` + `deleteFile` (best-effort cleanup, incl. on error path).
- [x] 4.5 `transcribeFile(path): Promise<string>` — orchestrates upload→create→wait→get→toSrt→delete, mirroring the Python flow.
- [x] 4.6 Tests: mock `fetch`; assert request shapes, poll loop, cleanup-on-error, no key leakage in errors.

## 5. ffmpeg wrappers (`src/ffmpeg.ts`)

- [x] 5.1 `isFfmpegAvailable()` via `which`/`execFile`.
- [x] 5.2 `extractAudio(src, {maxDurationSeconds?, output?})` → mp3 (`-vn -acodec libmp3lame -q:a 2`), cleanup partial output on failure.
- [x] 5.3 `getDurationSeconds(path)` via `ffprobe` (0 on parse failure).
- [x] 5.4 `extractChunk(src, startS, lengthS, dest)` (`-ss -t` re-encode).
- [x] 5.5 Tests: mock `execFile`; assert exact arg vectors; failure cleans up.

## 6. Chunking (`src/chunk.ts`)

- [x] 6.1 Port `shift_and_renumber_srt` (regex timestamp shift + cue renumber) → `shiftAndRenumberSrt`.
- [x] 6.2 Port `transcribe_chunked` — single request when under limit; else split into `chunkSeconds` pieces, transcribe each, merge with absolute offsets. Uses `fs.mkdtemp` + guaranteed cleanup.
- [x] 6.3 Tests: sub-limit path calls `transcribeFile` once; over-limit path splits, merges, and produces monotonic timestamps + sequential indices.

## 7. Discovery + idempotency (`src/discover.ts`)

- [x] 7.1 `resolveInputs(args)` — no arg → `~/Movies`; single dir → scan; else treat args as explicit files (validate existence + extension).
- [x] 7.2 Extensions: video `{.mkv,.mp4}`, audio `{.m4a,.mp3}`; mtime sort oldest-first.
- [x] 7.3 `.srt`-sibling idempotency (skip already-transcribed); SRT path derived from original stem.
- [x] 7.4 Tests: dir scan, explicit-file mode, unsupported-type rejection, skip-transcribed.

## 8. CLI bin (`src/bin/transcribe.ts` → pi-transcribe)

- [x] 8.1 Wire config → discover → (extract if video) → `transcribeChunked` → `saveSrt`; per-file try/catch.
- [x] 8.2 ffmpeg-absent handling: warn, skip video files, still process audio-only.
- [x] 8.3 Print summary (total / already / newly / failed); non-zero exit only on hard config errors, matching current behavior.
- [x] 8.4 Smoke test the bin with mocked ffmpeg + Soniox over a temp dir of fixture files.

## 9. Skill

- [x] 9.1 Write `.pi/skills/video-transcription/SKILL.md` — same triggers/description, invoking `pi-transcribe` instead of the Python script.
- [x] 9.2 Document prerequisites (ffmpeg/ffprobe, `SONIOX_API_KEY`) and env overrides in the skill.

## 10. Verification & docs

- [x] 10.1 `npm test` green (all pure logic + mocked I/O; no network, no binaries).
- [x] 10.2 Manual parity check: run `pi-transcribe` on a short sample; diff SRT against Python output. (Docker harness `parity/`: offline tier diffs TS `tokensToSrt` vs real Python `_convert_to_srt` over `fixtures/tokens.json` — byte-identical, deterministic, no key; guarded live tier runs full `pi-transcribe` when `SONIOX_API_KEY`+`PARITY_SAMPLE` set. `./parity/run.sh` / `npm run parity`.)
- [x] 10.3 Add per-file rows to the matching `docs/file-index-<area>.md` split (delegate per Documentation Update Protocol).
- [x] 10.4 README + package published-metadata review (scope, `files`, `peerDependencies`).
