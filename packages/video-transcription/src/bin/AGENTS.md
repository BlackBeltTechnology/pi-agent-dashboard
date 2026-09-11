# DOX — packages/video-transcription/src/bin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `transcribe.ts` | `pi-transcribe` bin entry. Calls `run(process.argv)`. Non-zero exit only on hard config error. jiti, no build. See change: add-video-transcription-package. |
| `voiceid.ts` | `pi-voiceid` bin entry. Calls `runVoiceId(process.argv.slice(2))`; sets the exit code. jiti, no build. See change: add-speaker-id-enrollment. |
