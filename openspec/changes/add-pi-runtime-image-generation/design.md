## Context

- See proposal.md (Why).
- `packages/nano-banana/src/nano-banana.ts`:
  - `generateImage(opts)` resolves the Gemini key (`env.ts` `resolveGeminiKey`, honouring the caller-supplied `opts.env`), spawns `npx -y @the-focus-ai/nano-banana` through `buildSafeArgv` + `execFileAsync`, and returns `{ ok, output?, error? }`; it never throws for generation failures.
  - `batchGenerate` fans out with bounded concurrency; a skipped job never calls `generateImage`. `BatchOptions` carries one shared `file`.
  - The runner is injectable (`NanoBananaRunner`). The existing test `nano-banana.test.ts` calls `generateImage({ env: {} })` with nothing injected and expects the no-key error.
- Consumers:
  - the `pi-nano-banana` bin (`void main()`);
  - `video-production/src/storyboard.ts`, which resolves the Veo key and passes it as `cliKey`.
- pi 1.0.0 facts, verified in the unpacked package:
  - `ModelRuntime` and `VERSION` are exported from `@earendil-works/pi-coding-agent` (exports map `"."` is import-only, so `require.resolve` fails while `import()` works).
  - `ModelRuntime.create(options)` runs `refresh()` (every provider, `models.json`, an availability sweep reading `auth.json`) unless `refreshOnCreate === false`. The repo comment at `provider-auth-registry.ts:59` claims the opposite and is wrong.
  - With `refreshOnCreate: false`, static models remain available: `getModelOfType` and `getModelsOfType` are synchronous and do no I/O.
  - `generateImages(model, { input }, options)` never rejects. Its typed options include `signal`, `timeoutMs`, `maxRetries` (default 0) and `env`. `env` is an overlay (`env[name] || process.env[name]`) applied after a stored `auth.json` credential, so it cannot isolate credentials. `openrouter-images` honours `signal`.
  - It does not normalise input images: bytes go verbatim as a `data:` URL. `inputLimits.images.resize` (`maxBytes 4718592` on the Gemini models) is pi's client-side downscale policy, not a provider limit.
  - `usage.cost` is computed from token counts at catalogue rates, so it is an estimate, and present only when OpenRouter returns usage.
  - `await import("@earendil-works/pi-coding-agent")` loads the whole SDK barrel (about 330 ms, per `provider-auth-registry.ts:13-15`).
  - With `modelsPath: null` (in-memory store) and `refreshOnCreate: false`, remote-catalogue image models (`withRemoteCatalog` covers the `image` type) are not loaded: only the installed build's static catalogue is visible.
  - `modelsPath: null` skips the user's `models.json` and forces an in-memory models store (so no cached remote catalogue), as `provider-auth-registry.ts:204` does. Network catalogue refresh is already off by default (`allowModelNetwork` defaults to false).

## Goals / Non-Goals

**Goals:**
- An opt-in pi backend behind the existing contract.
- Unchanged generation behaviour on the default path, including tests and storyboard. Accepted visible deltas: the additive result fields (`backend`) and the CLI usage line gaining `--backend`.

**Non-Goals:**
- Automatic fallback.
- Image resizing (no image dependency).
- Runtime caching across calls.
- Changing the `pi.tools` probe.
- Dashboard UI.

## Decisions

### D1 — Opt-in backend selection
- The library only takes `opts.backend` (default `"gemini"`). Only the CLI reads `NANO_BANANA_BACKEND` (trimmed, lower-cased) and passes the result explicitly. An exported shell variable therefore cannot move library callers such as storyboard onto OpenRouter, and an invalid value can only fail the CLI.
- An invalid `backend` is checked before `mkdir` or generation.
- Rejected:
  - `auto` (Gemini, else pi): it silently bills OpenRouter for callers that fail today, loads pi in the existing no-key test, and makes test results depend on the dev machine.
  - Prefer-pi: it moves existing users onto OpenRouter.
- The pi path ignores `apiKey`/`cliKey`; they are Gemini credentials.

### D2 — Guarded lazy import, per-call runtime
- New `src/pi-backend.ts`: `loadPi()` does `await import("@earendil-works/pi-coding-agent")` only when the pi backend is selected.
- The guard runs, in order, with everything inside one try/catch so a throw or rejection at any step becomes a result:
  1. the import succeeds;
  2. `VERSION`'s numeric `major.minor.patch` is ≥ `1.0.0`; a prerelease of `1.0.0` and a non-numeric `VERSION` count as below, with no `semver` dependency;
  3. `typeof ModelRuntime.create === "function"`;
  4. `create()` resolves;
  5. the runtime has `generateImages`, `getModelOfType` and `getModelsOfType`.
- Each failure becomes an `ok: false` result naming the package, `>= 1.0.0`, and the found version. Same precedent as `provider-auth-registry.ts:196-201`.
- `ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })`, default auth path (`$PI_AGENT_DIR` or `~/.pi/agent/auth.json`):
  - `refreshOnCreate: false` skips the all-provider refresh and availability sweep (reads of every provider's credentials);
  - `modelsPath: null` keeps the user's `models.json` from changing base URLs or the cost rates behind the estimate, and keeps cached remote catalogues out.
- Created per `generateImage` call, and once per `batchGenerate`: the batch resolves backend + runtime once and hands them to an internal per-job generator, not to the public `generateImage`. There is no module cache, so a long-lived host picks up a later `/login`.
- Injectable `createPiRuntime` (returns the `PiImageRuntime` subset: `getModelOfType`, `getModelsOfType`, `generateImages`) for tests, mirroring `NanoBananaRunner`.
- In `batchGenerate`, the skip check runs first; the guard and the runtime are created lazily on the first job that needs generation (single shared promise). A guard failure fails every non-skipped job; a fully skipped batch never imports pi.
- Types: nano-banana does not depend on `@earendil-works/pi-ai`. `PiImageRuntime`, the image block, and `PiImageUsage` (`{ input, output, totalTokens?, cost: { total: number } }`) are local structural types; pi's values satisfy them at runtime. The result's `usage` uses `PiImageUsage`.

### D3 — Request
- `input`: the optional edit image block, then the prompt text block.
- options: `{ signal: AbortSignal.timeout(timeoutMs ?? 180_000), maxRetries: 0 }`, with the signal created per generation, so a batch never shares one budget.
- `signal` over pi's `timeoutMs`: the client owns the signal, so it knows whether its own deadline fired. `openrouter-images` labels any post-deadline error `aborted`; the client therefore checks `signal.aborted` and reports `timed out after <ms> ms`, appending pi's `errorMessage` when there is one, so a late provider error is not hidden. `maxRetries: 0` pins the default, so wall-clock time stays bounded.
- A "Provider is not configured" error gets a hint to run `/login openrouter` or set `OPENROUTER_API_KEY`.
- `timeoutMs` is a library option only; the CLI keeps the 180 s default (no `--timeout` flag), which is accepted.
- `env` is not passed. It is an overlay after the stored credential, so it would only look like isolation. Tests inject the runtime instead and never touch real credentials.

### D4 — Edit input validation
- Lower-cased extension → mime table (`png`, `jpg`/`jpeg`, `webp`, `gif`).
- `fs.promises.stat` + `readFile` inside try/catch, so missing or unreadable files are results.
- No size limit and no resizing. `inputLimits.images.resize` is pi's downscale policy, not a provider limit, and resizing would need an image library. An oversized input surfaces as the provider's error.

### D5 — Model mapping
- An id containing `/` is used as is. A bare id gets `google/` in front.
- Default `google/gemini-2.5-flash-image`. `flash` selects `google/gemini-3.1-flash-lite-image`.
- An unknown id gives an error listing ids from `getModelsOfType("image", "openrouter")` (static, credential-free): `google/` ids for a bare input, all image ids for a slash input.
- Divergence from the Gemini CLI's `--flash` (gemini-2.0-flash) is accepted. The backend is explicit, and the result and CLI report the model.

### D6 — Outputs
- The first image block goes to the requested `output` verbatim; the caller owns the extension, as on the Gemini path.
- The requested path is overwritten, as on the Gemini path. Generated names (the unnamed first output `nano-banana-<YYYYMMDD-HHmmss-SSS>`, and extra blocks) use the block's mime extension and are written with `fs.writeFile(..., { flag: "wx" })`, taking the lowest free `-<n>` (n ≥ 2) on `EEXIST`. This makes them collision-free under batch concurrency.
- `mkdir` and write errors (`EACCES`, `ENOSPC`, …) become `ok: false` results that keep any already-written files in `outputs`, because the generation may already be billed.
- A response with no image block fails with its joined text, or `no image returned`.
- `outputs` lists `{ path, mimeType }` so a mime/extension mismatch on the requested path is visible.

### D7 — Result shape is additive
- `GenerateImageResult` gains optional `backend`, `outputs`, `model`, `usage`.
- `BatchResult` gains `backend`, absent on skipped jobs.
- The CLI appends ` (pi · <model>)` and ` · ~$<cost> est.` (2 significant digits; omitted when `usage` is absent) only on the pi path, and prints `✗ generation failed (pi): …` on pi failures.
- On the pi path only, the CLI exits explicitly in the stdout/stderr write callback, so output is flushed before `process.exit(code)`. The Gemini path keeps today's exit behaviour (`process.exit(1)` on failure, natural exit on success).

## Risks / Trade-offs

- [Resolution skew: the import resolves the copy next to nano-banana (workspace/hoisted), not the pi running the skill, so a stale tree reports "found 0.86.1" under a 1.0.0 host; a standalone install may not resolve it at all] → the guard names the found version, and the README says to install or update `@earendil-works/pi-coding-agent >= 1.0.0` next to the package. Accepted.
- [Static catalogue only: newer image models pi lists via its remote catalogue are invisible] → the unknown-id error lists what the build knows; upgrading pi refreshes it. Accepted in exchange for no network or availability sweep per run.
- [`pi.tools` probe still names only `GEMINI_API_KEY`, so a pi-only user sees the package as unsatisfied] → the probe describes the default backend; the README and skill doc explain the opt-in. Accepted.
- [The ~330 ms SDK import on each pi CLI run] → opt-in path only; the Gemini path never imports it. Accepted.
- [The pi runtime may write `auth.json` concurrently with other pi processes] → `refreshOnCreate: false` avoids the sweep. OpenRouter keys do not refresh, and `DefaultAuthStorage` uses pi's standard lock. Accepted.
- [Cost shown is an estimate] → labelled `est.` in the CLI and documented.
- [The catalogue renames the defaults] → the unknown-id error lists replacements; defaults sit in one constant.
- [The CLI process could hang on a retained handle after the SDK import] → pi path: explicit exit after flushed output; the request is bounded by the per-generation timeout.
- [A vendor-less non-Google id (`flux.2-pro`) is rewritten to `google/flux.2-pro` and fails] → the error lists `google/` ids; the docs say to use full `vendor/model` ids for non-Gemini models. Accepted to keep bare Gemini ids working.
- [The skill doc's `--model gemini-2.0-flash-exp` / `--flash` advice does not carry over to `--backend pi`] → the docs task adds a pi-backend model section. Accepted.

## Migration Plan

Additive; no data migration. Rollback = revert. The Gemini path, the existing tests and storyboard are untouched.
