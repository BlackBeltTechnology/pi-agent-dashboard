## 1. Sink core (PR #784 + review fixes)

- [x] 1.1 `src/log.ts` sink: `info`/`warn`, `PI_IMAGE_FIT_QUIET`, console fallback (PR #784, 14cc321)
- [x] 1.2 Adopt UI only when `ctx.hasUI === true`; latest ctx wins; stale ctx ignored (7b40451)
- [x] 1.3 `log.lifecycle.test.ts` regressions for 1.2

## 2. Tighten logging

- [x] 2.1 Tests: info → `ui.setStatus("pi-image-fit", …)`; `notify(…, "info")` fallback without setStatus; warn → `notify(…, "warning")`
- [x] 2.2 Tests: `deferUntilContext()` buffers load-time messages (bounded 50, oldest dropped) and flushes in order on first ctx (UI or console)
- [x] 2.3 Tests: disabled extension registers only `session_start`, which delivers the disabled notice
- [x] 2.4 Move `parseBool` to `src/env.ts`; `log.ts` + `policy.ts` share it (`on` accepted for QUIET)
- [x] 2.5 Implement 2.1–2.3 in `log.ts` / `extension.ts`
- [x] 2.6 Update `src/AGENTS.md`, package README diagnostics note, CHANGELOG `[Unreleased]`

## 3. Verify

- [x] 3.1 Package tests + Biome clean
- [ ] 3.2 Manual: interactive pi, read a large screenshot → footer status, no prompt-line output; `pi -p` → console line
