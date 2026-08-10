# DOX — packages/video-transcription/parity

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Parity harness overview (task 10.2). Docker check TS port produces SRT byte-identical to original Python `video-transcription` skill. Dev/QA only, `parity/` excluded from package `files` whitelist. Run `./parity/run.sh` (offline, no key) or `npm run parity`. |
| `parity-check.ts` | Parity script. Tier 1 offline: TS `tokensToSrt` over `fixtures/tokens.json` diffed vs `fixtures/tokens.expected.srt` (Python reference), deterministic, no key. Tier 2 guarded live: `SONIOX_API_KEY`+`PARITY_SAMPLE`→full `run()` pipeline, copies sample to temp dir, asserts well-formed non-empty SRT. Exit 1 on mismatch. See change: add-video-transcription-package. |
