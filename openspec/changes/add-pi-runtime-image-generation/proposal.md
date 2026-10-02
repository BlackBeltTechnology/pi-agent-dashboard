## Why

The dashboard generates images through `packages/nano-banana`: `pi-nano-banana` CLI + `generateImage`/`batchGenerate`, reused by the video-production storyboard step. It shells out to `@the-focus-ai/nano-banana` and needs its own `GEMINI_API_KEY`, separate from pi's credentials.

pi 1.0.0 adds image generation to its model runtime:
- `ModelRuntime.generateImages(model, context, options)`, `ctx.modelRegistry.generateImages()` for extensions, `models.generateImages()` in codemode;
- `getModelOfType("image", …)` / `getModelsOfType("image", …)` over a static catalogue.

pi-ai 1.0.0's only image API is `openrouter-images`. Its catalogue has 57 OpenRouter image models, including the Gemini image models nano-banana targets (`google/gemini-2.5-flash-image`, `google/gemini-3-pro-image`, `google/gemini-3.1-flash-image`, …). A user signed in to OpenRouter in pi (`/login openrouter` or `OPENROUTER_API_KEY`) could therefore generate images with no extra key.

## What Changes

- Add an **opt-in** pi-runtime backend to `packages/nano-banana`:
  - Library: `backend: "pi"`. CLI: `--backend pi` or `NANO_BANANA_BACKEND=pi`; only the CLI reads the variable.
  - The default stays `gemini`. A missing Gemini key never falls back to pi, and an exported variable cannot move library callers (storyboard), so no caller silently starts paying for OpenRouter.
- The pi path:
  - dynamic `import()` of `@earendil-works/pi-coding-agent`, guarded on `VERSION >= 1.0.0` and on the runtime methods existing;
  - `ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })` per call/batch (static catalogue, no `models.json`, no availability sweep);
  - `generateImages()` with a per-generation abort timeout (`timeoutMs`, default 180 s) and `maxRetries: 0`.
  It returns the same `{ ok, output, error }` contract plus additive `backend`, `outputs`, `model`, `usage`.
- Model mapping:
  - bare Gemini ids get `google/` in front;
  - `flash` selects `google/gemini-3.1-flash-lite-image`; the default is `google/gemini-2.5-flash-image`;
  - an unknown id fails with a list of catalogue ids.
- Edit inputs are validated before the call: extension (case-insensitive) and a readable file. They are never resized or size-capped.
- The CLI prints backend, model and an estimated cost on the pi path.
- Out of scope:
  - the video-production storyboard step, which stays on Gemini (it needs the Gemini key for Veo anyway);
  - a dashboard image-generation UI;
  - non-OpenRouter image APIs (none in pi-ai 1.0.0).

## Capabilities

### New Capabilities
- `nano-banana-pi-backend`: opt-in selection, availability/version guard, runtime generation, edit-input validation, model mapping, output files + usage, batch semantics.

### Modified Capabilities
- `nano-banana-image-generation-client`: key resolution, CLI invocation and CLI result handling are scoped to the Gemini backend; the no-key error names the pi opt-in; results carry `backend`.
- `nano-banana-cli-entrypoint`: `--backend` flag, usage line, dispatch of `backend`, pi result line with the estimated cost.

## Impact

- Code:
  - `packages/nano-banana/src/pi-backend.ts` (new);
  - `nano-banana.ts` (selection, result fields);
  - `bin/nano-banana.ts` (flag, output);
  - skill doc + README.
- Dependency: `@earendil-works/pi-coding-agent` optional peer `>=1.0.0`. The raise itself lands with `update-pi-core-1-0-adopt-apis` (all workspace peers move together; one hoisted copy). This change only verifies it.
- `pi.tools` probe unchanged. The pi backend is opt-in, and its credential may live in `auth.json` (`/login`) where an env probe cannot see it.
- **Depends on** `update-pi-core-1-0-adopt-apis` (installed pi 1.0.0, peer floor).
- Risk: OpenRouter pricing and quality differ from direct Gemini. The pi backend is explicit opt-in, and the printed cost is labelled an estimate (it is computed from token usage).
- Rollback: revert; the Gemini path is untouched.

## Discipline Skills

`observability-instrumentation` (new external call path; result and CLI report backend + model + estimated usage) · `security-hardening` (the package now reads pi's `auth.json` through `ModelRuntime` and can trigger paid calls; the opt-in-only selection is the control) · `review-code`.
