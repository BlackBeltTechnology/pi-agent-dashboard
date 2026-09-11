# DOX — packages/video-transcription/.pi/skills/speaker-id

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `BENCHMARK.md` | Six-model speaker-embedding comparison on real Hungarian meeting audio + the end-to-end cross-recording validation. Justifies the default model (28 MB campplus zh_en beat the 114 MB VoxCeleb leader) and the centering/threshold defaults. Referenced from `SKILL.md`. See change: add-speaker-id-enrollment. |
| `SKILL.md` | NL-triggered skill for `pi-voiceid`. Put real names on anonymous diarized labels using a persistent local voiceprint library, and detect/repair speaker drift. Procedure for analyze/enroll/label; cohort-centering pitfalls; biometric-store + enrolls-other-speakers erasure notes; limitations (no overlapping speech, no TS-VAD). See change: add-speaker-id-enrollment. |
