# Bundle grammar-settings-plugin into the Electron installer

## Why

`grammar-settings-plugin` (the Settings ▸ Plugins ▸ "Grammar & Spelling" surface, landed in
`717929eb`) is a non-fixture runtime plugin in `packages/`, but it was never added to the
`BUNDLED_PLUGINS` array in `packages/electron/scripts/bundle-server.mjs`. That array is the
source list `bundle-server.mjs` copies into the packaged app's `resources/plugins/`.

Consequence: every fresh **Electron install would silently ship without the Grammar & Spelling
settings surface** — the exact class of regression the `bundled-plugins-complete` invariant
test was written to catch (it previously caught `kb-plugin`, which had shipped missing the
Knowledge Base surface). The omission currently reds that test:

```
runtime plugins missing from BUNDLED_PLUGINS: grammar-settings-plugin
  (packages/shared/src/__tests__/bundled-plugins-complete.test.ts)
```

The underlying spec (`electron-build-pipeline` ▸ "Bundled dashboard server") documents copying
`server`/`shared`/`extension` + the web client, but is **silent on first-party plugin
bundling** — so the invariant lived only in a test, not the spec. This change both fixes the
omission and closes that spec gap.

## What Changes

- Add `"grammar-settings-plugin"` to `BUNDLED_PLUGINS` in
  `packages/electron/scripts/bundle-server.mjs` so it is copied into `resources/plugins/`.
- Codify the completeness invariant in the `electron-build-pipeline` spec: every non-fixture
  runtime plugin in `packages/*` (not bundled as a workspace package) MUST be in
  `BUNDLED_PLUGINS`, and every entry MUST map to an existing runtime plugin — mirroring what
  `bundled-plugins-complete.test.ts` already enforces.

Out of scope: rebuilding the actual Electron bundle artifact (regenerated on `electron:build`);
any change to the grammar feature behaviour itself.

**Follow-up:** this bundling gap exists because grammar is a core feature with a companion
settings plugin (not a self-contained plugin). The root fix — moving the route, composer surface,
and config into the plugin so core carries zero grammar code — is proposed separately in
`make-grammar-fully-plugin-contained`, which supersedes this `BUNDLED_PLUGINS` entry once the
plugin absorbs the route/UI.

## Deferred / related (found during this work — NOT fixed here)

Captured so they are not re-discovered; each is a separate change:

- **Native Google (Gemini) streaming is broken in the dashboard server.** The
  `@google/genai → google-auth-library → gaxios` chain triggers a `require()` of an
  ESM-with-top-level-await module under the server's loader
  (`require() cannot be used on an ESM graph with top-level await … gaxios`). Not
  version-specific (pinning gaxios 7.1.4 reproduced it). Blocks ALL google-model streaming,
  not just grammar. The OpenAI-compatible endpoint (`…/v1beta/openai`, plain `fetch`) works
  (~0.6 s on `gemini-flash-lite-latest`) and is the practical path if Gemini is wanted.
- **`/api/models` lists unroutable models.** ~5 anthropic ids return an instant `502
  backend_unreachable` for the current credential yet still appear in the selector.
- **Latent `context.system` vs `context.systemPrompt`.** The model-proxy adapter passes
  `context.system` at `server.ts` (two sites); pi-ai reads `context.systemPrompt`, so
  proxy/agent system prompts may be silently dropped.

## Discipline Skills

- `review-code` — non-trivial change; run before commit (a build-script list + spec delta).

(No auth/untrusted-input/latency/observability/migration triggers apply.)
