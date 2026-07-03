# DOX — packages/video-transcription/parity

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `parity-check.ts` | Parity script. Tier 1 offline: TS `tokensToSrt` over `fixtures/tokens.json` diffed vs `fixtures/tokens.expected.srt` (Python reference), deterministic, no key. Tier 2 guarded live: `SONIOX_API_KEY`+`PARITY_SAMPLE`→full `run()` pipeline, copies sample to temp dir, asserts well-formed non-empty SRT. Exit 1 on mismatch. See change: add-video-transcription-package. |
