# Design — harden-media-and-electron-args

## Context

Split out of `close-residual-audit-findings` (B23, B24). See proposal.md (Why / What Changes). This doc fixes the *how* for the two items. The decisions below are copied verbatim from the umbrella design (D21–D22, numbers kept).

Constraints: the Fastify no-logger and `trustProxy` notes do not apply here. Both items sit on exec / renderer boundaries; requirement wording lives in `specs/` and is referenced here, not restated.

## Goals / Non-Goals

**Goals**
- Close B23 and B24 with test-backed changes, or a "no gap" record with evidence (B23 `render.ts`).
- Sequence against overlapping changes (`add-srt-translation-pass`, `raise-node-floor-to-26`) so no change is clobbered.

**Non-Goals**
- The other residual audit findings (auth, CORS/CSP, git/terminal, bridge); owned by sibling split changes.
- Dependency bumps (`bump-runtime-security-advisories`).

## Decisions

### Media / Electron

**D21 · B23 — media argument safety.**
- *Audio size:* `maxAudioMb` (`video-transcription/src/config.ts:184`, default 200 at `:15`) limits the **extracted** audio: its total size is checked via `stat` after extraction, before upload/transcription. The error names the limit and the size. `0` disables the check (scenario).
- *Media paths:* every positional ffmpeg/ffprobe media path is resolved to absolute against the spawn cwd at **every** site — `ffmpeg.ts:82` (output), `:108-116` (ffprobe input), `:149` (chunk dest), `discover.ts:51` (`path.join(dir, name)`), `audio-decode.ts:74-90` (positional `out`), and the `voiceid.ts` runner (`:179-192`, feeding `decodeAudio` / `getDurationSeconds`). An absolute path never starts with `-`.
- *nano-banana prompt:* `buildArgs` emits `["--prompt", prompt, …]` (`nano-banana.ts:94`); `npx` is pinned to `@the-focus-ai/nano-banana@1.0.10`, whose parser takes `--prompt` (verified: package `cli.ts:275`).
- *nano-banana on win32:* `npxRunner` uses `buildSafeArgv("npx", …)` (`nano-banana.ts:79`), which wraps `npx.cmd` in `cmd.exe /d /s /c` without escaping args (`shared/src/platform/exec.ts:89-95`). On win32 there is **no** `cmd.exe` path at all, for every arg (prompt, `--model`, `--file`, `--output`): the runner invokes npx's JS entry with node directly (`process.execPath` + npm's `npx-cli.js`, resolved next to the node binary). If that entry is not resolvable, the run is refused with a clear error. Pin string `@the-focus-ai/nano-banana@1.0.10` appears verbatim in the spec.
- *render.ts:* no gap. The input sits behind `-i`, and `outPng` is absolute (`render.ts:183,337`). Recorded.

ADDS video-transcription "Extracted audio size limit enforced before upload", "Media paths are absolute and never parsed as options". MODIFIES nano-banana-image-generation-client "Single Image Generation and Editing"; ADDS "Prompt is never parsed as a CLI flag", "Prompt never passes through cmd.exe on Windows".

**D22 · B24 — Electron residuals.**
- *doctor.html:* already fixed. The link replacer allows only `http(s)` and renders anything else as text (`renderer/doctor.html:101-105`, commit `433993088` harden-client-sinks). Kept as a requirement with a regression test.
- *Residual — doctor-window.ts:* its `webPreferences` lack `sandbox` (`lib/doctor-window.ts:141-145`) and it has no navigation guards. It gains `sandbox: true`, `setWindowOpenHandler` (deny, plus `shell.openExternal` for http(s)) and a `will-navigate` guard, mirroring `lib/connecting-window.ts:35-45`.
- *dependency-detector.ts:91:* the node version probe becomes `execFileSync(base.path, ["--version"])` directly. Node is never a `.cmd` shim, so no `buildSafeArgv` and no shell.

ADDS electron-shell "Doctor window links are scheme-restricted", "Doctor window navigation is guarded", "Node version probe never uses a shell string" (narrowed to the node probe).

## Sequencing

```mermaid
flowchart TD
  SRT["add-srt-translation-pass<br/>(video-transcription config.ts)"] -. rebase config.ts .- THIS
  N26["raise-node-floor-to-26<br/>(dependency-detector.ts)"] -. rebase dependency-detector.ts .- THIS
  THIS["harden-media-and-electron-args<br/>one ship-it pass → archive"]
  THIS --> UMB["close-residual-audit-findings<br/>closes when all five split changes are archived"]
```

- No `blocked_by` dependency. Textual rebase only; whichever lands second re-applies its edit.
- Archive is the last task.

## Risks / Trade-offs

- **[Trade-off] B24 node override shim.** A node override path pointing at a `.cmd`/`.ps1` shim makes the argv probe fail → reported not usable. Accepted.
- **[Risk]** B23 on win32: npm's `npx-cli.js` not resolvable next to node → nano-banana refuses with a clear error instead of falling back to `cmd.exe`.
- **[Risk]** D22 `sandbox: true` breaks the doctor preload. → a task checks the preload uses only sandbox-safe APIs (`contextBridge`, `ipcRenderer`).
- **[Risk]** Overlapping changes conflict. → Sequencing above.

## Migration Plan

One landing; then the change archives. No data migration.

| Item | Data / config migration | Rollback |
|---|---|---|
| B23 | `npx` version pin. | Unpin / revert. |
| B24 | None. | Revert. |
