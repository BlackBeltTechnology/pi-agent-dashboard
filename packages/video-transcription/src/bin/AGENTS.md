# DOX — packages/video-transcription/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `transcribe.ts` | `pi-transcribe` bin entry. Calls `run(process.argv)`. Non-zero exit only on hard config error. Not the npm `bin` target — `../../bin/pi-transcribe.mjs` launches it via tsx. See change: add-video-transcription-package. |
| `voiceid.ts` | `pi-voiceid` bin entry. Calls `runVoiceId(process.argv.slice(2))`; sets the exit code. Not the npm `bin` target — `../../bin/pi-voiceid.mjs` launches it via tsx. See change: add-speaker-id-enrollment. |
