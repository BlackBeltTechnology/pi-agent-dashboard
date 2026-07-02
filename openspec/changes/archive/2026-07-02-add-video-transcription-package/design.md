# Design — video-transcription package

## Context

Port of the standalone Python skill `~/.pi/agent/skills/video-transcription` into a first-class monorepo package. Source is ~600 LOC across five Python files whose only external dependencies are the Soniox REST API and `ffmpeg`/`ffprobe`. No local ML, no Python-only libraries.

## Goals

- Full TypeScript, no Python. One runtime npm dep: `@blackbelt-technology/pi-dashboard-shared` (repo-mandated safe-subprocess wrapper); otherwise pi peers only.
- Behavior parity: same SRT output, same CLI contract, same chunking semantics.
- Skill + `pi-transcribe` bin, mirroring `document-converter` / `dashboard-plugin-skill` conventions.
- No committed secret.

## Package layout

```
packages/video-transcription/
  package.json            # name @blackbelt-technology/pi-dashboard-video-transcription
  tsconfig.json
  vitest.config.ts
  README.md
  .pi/skills/video-transcription/SKILL.md
  src/
    bin/transcribe.ts     # -> bin: pi-transcribe
    soniox.ts             # REST client (upload/create/poll/get/delete)
    srt.ts                # segment grouping + timestamp formatting
    chunk.ts              # duration split + SRT shift/renumber/merge
    ffmpeg.ts             # execFile wrappers + availability probe
    discover.ts           # file discovery + .srt idempotency
    config.ts             # env + optional .env resolution
    __tests__/*.test.ts
```

## Python → TypeScript mapping

| Concern | Python | TypeScript |
|---|---|---|
| HTTP upload | `requests` multipart POST `/files` | `fetch` + `FormData` with `Blob`/file stream |
| Poll status | `requests.get` loop + `time.sleep` | `fetch` loop + `await setTimeout` |
| SRT build | token grouping, `%02d:%02d` fmt | pure fns, `String.padStart` |
| ffmpeg extract | `subprocess.run([...])` | `execFile('ffmpeg', [...])` (promisified) |
| ffprobe duration | `subprocess.run` + parse float | `execFile('ffprobe', [...])` |
| chunk temp dir | `tempfile.TemporaryDirectory` | `fs.mkdtemp` + `rm(recursive)` in `finally` |
| SRT shift regex | `re.compile(...)` | same regex, `RegExp` |
| env / secret | `dotenv.load_dotenv(skill/.env)` | `config.ts` reads `process.env`, optional `.env` parse |

## Key decisions

### D1 — Full TS port, no Python (chosen)
The tool is I/O orchestration only. Keeping a Python engine (the `document-converter` pattern) would be pure overhead here since nothing needs Python. Full port removes the bundled venv + `.zip` and lets it run on pi's jiti TS loader directly.

### D2 — Native fetch/FormData, no Soniox SDK
Five endpoints. A dependency-free client is smaller and avoids version churn. Node 20+ ships global `fetch`, `FormData`, `Blob`.

### D7 — Subprocess via shared `platform/exec`, not raw `node:child_process`
The repo enforces a CI invariant (`no-direct-child-process`): all subprocess execution goes through `@blackbelt-technology/pi-dashboard-shared/platform/exec` so `windowsHide: true` and other defaults stay uniform. `ffmpeg.ts` therefore imports `execFileAsync` from that wrapper instead of `node:child_process`. This adds one runtime dependency (`pi-dashboard-shared`, already a sibling published package used by `document-converter`) and supersedes the original "zero runtime deps" goal — the tradeoff is correct Windows console-hiding for spawned `ffmpeg`/`ffprobe` and consistency with the rest of the monorepo.

### D3 — Secret from env, optional gitignored `.env`
`config.ts` resolves `SONIOX_API_KEY` from `process.env` first; if absent, parse a local `.env` (cwd, then skill dir) that is gitignored. No secret in the published tarball. Fail fast with a clear message if unresolved.

### D4 — Behavior parity guardrail
SRT segmentation (`max_segment_ms = 5000`, speaker-change boundaries) and timestamp format are ported verbatim and covered by golden-output tests so the port is byte-comparable to the Python version.

### D5 — bin points at `.ts`, jiti only (no build step)
Following `dashboard-plugin-skill` (`bin: src/bin/scaffold.ts`), the bin references the TS entry directly; pi runs it via jiti. **Confirmed scope: inside pi only** — no build step, no compiled JS bin, no shebang wrapper. Running `pi-transcribe` in a plain terminal outside pi is explicitly not supported in this change (upgrade path: add a `tsup`/`tsc` build + `#!/usr/bin/env node` bin later).

### D6 — Published opt-in delivery
Shipped as a normal `packages/*` workspace package, published to npm under the existing scope. Consumers install with `pi install @blackbelt-technology/pi-dashboard-video-transcription`. It is NOT registered in the root `package.json` pi manifest and NOT auto-installed via `.pi/settings.json` — no repo-wide auto-load. This matches how every other `packages/*` (except the bridge) is consumed.

## ffmpeg dependency

`ffmpeg`/`ffprobe` remain runtime prerequisites (external binaries, not npm). `ffmpeg.ts` probes availability via `which`/`execFile`; video files are skipped with a warning when absent, audio-only files still process — matching current behavior.

## Risks

- **ffmpeg absent in CI** → all ffmpeg/ffprobe calls are mocked in tests; no binary needed for `npm test`.
- **Soniox API drift** → client isolated in `soniox.ts`; parity tests mock responses.
- **`FormData` large-file memory** → stream the file via `Blob`/`fs` handle rather than buffering whole file where the runtime allows.

## Open questions

- Should `pi-transcribe` gain a `--dry-run` / `--json` output mode? (Deferred — not in the current skill.)
- Decommission timing for the old global skill (follow-up, not this change).
