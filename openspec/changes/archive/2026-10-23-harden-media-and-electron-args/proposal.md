## Why

Split out of `close-residual-audit-findings`, which closes
`security-boundary-audit`. This change owns the argument-injection and renderer
residuals in the media plugins and Electron: findings **B23** (media tool
argument safety) and **B24** (Electron residuals). Both are small, local
hardening items on exec and renderer boundaries, so they ship and archive
independently of the auth, CORS/CSP, git/terminal and bridge items.

Planned with `plan-proposal`. Mechanical split; no re-planning. Citations are
pre-move and `design.md` is authoritative where the two differ.

## What Changes

- **B23 · Media tool argument safety.** Enforce `maxAudioMb`
  (`packages/video-transcription/src/config.ts:184`, parsed but never read)
  on the extracted audio, before upload, with a `video-transcription` spec delta (the spec
  covers it as config only). In `nano-banana/src/nano-banana.ts:93` `buildArgs`,
  `opts.prompt` is the first positional argument, so a prompt that starts with
  `-` parses as a flag. Pass it via `--prompt` (supported by the pinned
  `@the-focus-ai/nano-banana@1.0.10`). On Windows no arg ever reaches
  `cmd.exe`: npx's JS entry runs under node directly, else the run is refused.
  `video-transcription/src/ffmpeg.ts:82`
  (`args.push("-y", output)`) and its `ffprobe` call (`:98+`) take positional
  media paths, as do `audio-decode.ts` and the `voiceid.ts` runner. Every
  spawn site resolves them to absolute (design D21). `video-production/src/render.ts:127`
  (`extractLastFrame`): no confirmed gap, since the input sits behind `-i`.
  Verify the output-path position and record the result.
- **B24 · Electron residuals.** The `doctor.html` link replacer already allows
  only `http`/`https` (`packages/electron/src/renderer/doctor.html:101-105`,
  harden-client-sinks); keep it under a regression test. Residual: the doctor
  window gets `sandbox`, a window-open handler and a `will-navigate` guard
  (`lib/doctor-window.ts`). Replace the interpolated `execSync(\`"${base.path}" --version\`)`
  (`packages/electron/src/lib/dependency-detector.ts:91`) with an argv call.
  Decided at planning: node is never a `.cmd` shim, so the node version probe
  calls `execFileSync(path, ["--version"])` directly (no shell, no
  `buildSafeArgv`); see design D22. A node override pointing at a `.cmd` /
  `.ps1` shim is then reported not usable (accepted).

## Capabilities

### Modified Capabilities

- `video-transcription` (B23)
- `nano-banana-image-generation-client` (B23)
- `electron-shell` (B24)

## Impact

- Plugins: `packages/video-transcription/src/{config,ffmpeg,discover,audio-decode,voiceid}.ts`,
  `packages/nano-banana/src/nano-banana.ts`; `video-production/src/render.ts:127`
  is recorded as no-gap (no change).
- Electron: `packages/electron/src/lib/doctor-window.ts`,
  `lib/dependency-detector.ts`, `renderer/doctor.html:101-105` (regression test only).
- **Overlaps with active changes.**
  - `add-srt-translation-pass` refactors `video-transcription/src/config.ts` (B23). Rebase whichever lands second.
  - `raise-node-floor-to-26` touches `dependency-detector.ts` (B24). Rebase whichever lands second.
- **Compatibility:**
  - B23: a prompt starting with `-` now works; `maxAudioMb` now refuses oversized extracted audio (default 200, `0` disables).
  - B23 win32: nano-banana refuses with a clear error when npm's `npx-cli.js` is not resolvable next to node.
  - B24: a node override pointing at a `.cmd`/`.ps1` shim is reported not usable (accepted).
- **Rollback:** each item is an independent local revert. B23: unpin / revert the `npx` version pin. B24: revert; no data or config migration.
- **Closes (security-boundary-audit):** B23, B24.

## Discipline Skills

- `security-hardening` — both items harden exec-argument and renderer-navigation boundaries.
