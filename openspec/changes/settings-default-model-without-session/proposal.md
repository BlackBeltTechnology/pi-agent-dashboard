# Make the Settings default-model picker usable with no live session

## Why

Settings → **Default model** decides what every *brand-new* session is started with
(`packages/client/src/components/settings/SettingsPanel.tsx:1192-1206`). It is a machine-wide
setting. But its option list is a union over per-session `models_list` pushes:

```
packages/client/src/App.tsx:2350
  for (const list of modelsMap.values()) { ... }   // modelsMap: Map<sessionId, ModelInfo[]>
```

`modelsMap` is filled only by bridge `models_list` messages. With **zero live sessions** the
union is empty and the setting cannot be set at all — the exact state a fresh dashboard is in,
and the exact moment an operator wants to choose a default before spawning anything.

That is the whole bug. (An earlier draft also claimed the list goes stale while sessions are
live; that is mostly false — `credentials_updated` is broadcast to every bridge on provider and
API-key saves, so live sessions do catch up after dashboard-driven writes. The zero-session case
stands on its own and does not need the embellishment.)

A session-independent catalogue already exists:

- `GET /api/models` (`packages/server/src/routes/models-introspection-routes.ts`) is registered
  unconditionally (`server.ts:1540`) and carries no per-route auth of its own — it is subject
  only to the dashboard's global auth plugins, so in a default auth-off local install it is
  reachable anonymously, same posture as `/api/provider-auth/status`.
- It is backed by `InternalRegistry` (`packages/server/src/model-proxy/registry-singleton.ts`),
  which resolves `pi-ai` directly and reads `providers.json` + `models.json` + `auth.json`. It
  needs no pi session.
- `refreshModelRegistry()` is already invoked on every Settings write that could change the
  catalogue — `provider-auth-routes.ts:100`, `provider-routes.ts:160`, `config-api.ts:259`.

No client file references `/api/models` today.

**Critical constraint discovered in review — the catalogue alone is not sufficient.**
`InternalRegistry.getAvailable()` filters on `hasAuth`/`canRouteModel`
(`internal-registry.ts:265-285`), which read only `readAugmentedAuth()` = `auth.json` plus
synthetic custom-provider keys. Nothing in `packages/server/src/model-proxy/` consults
`process.env` or pi-ai's exported `getEnvApiKey`. So `getAvailable()` answers *"what can the
model **proxy** route with stored credentials"* — **not** *"what can pi run"*. On a machine where
pi runs off an exported `ANTHROPIC_API_KEY` with no `auth.json` entry, the catalogue is empty
while pi itself works fine. Sourcing the picker from the catalogue alone would therefore produce
the very empty-picker state this change exists to remove, for a common pi setup.

pi offers no headless catalogue to fall back on: pi 0.84.1 exports `ModelRegistry`, but its
`.d.ts` shows `constructor(runtime: ModelRuntime)` — the in-session `pi.models` facade.

## What Changes

- **The Default Model picker SHALL be sourced from the union of the `GET /api/models` catalogue
  and every per-session `models_list`**, deduplicated by `"provider/id"`. With zero sessions the
  union is the catalogue (bug fixed); with sessions live the union is a superset of today's list
  (no regression); env-credentialed models remain visible via the session side.
- **On collision the session row wins.** Session rows carry `name`, accurate `metadataSource`,
  and `supportedThinkingLevels`; catalogue rows are thinner. Preferring the session row also
  avoids losing model display names, which `ModelSelector` renders as `m.name ?? label`.
- **`ModelProxySection` SHALL be sourced from the catalogue alone**, via a separate prop. Its
  preferred-models list, aliases, and availability pills configure the model **proxy**, and
  `getAvailable()` is precisely the proxy's routable set — the union would be wrong there,
  because the proxy genuinely cannot route an env-credentialed model.
- **A client fetch helper + shared row mapper.** `/api/models` rows are projected to `ModelInfo`:
  `provider` is taken from the row's own `provider` field (not by splitting), `id` is the row id
  with the `"<provider>/"` prefix stripped, `vision` is `input?.includes("image") ?? undefined`
  (preserving *unknown*, since the route omits `input` when falsy), `reasoning` and
  `contextWindow` pass through, and `metadataSource` is **omitted**. `thinkingLevelMap`,
  `maxTokens`, and `cost` are dropped; no `supportedThinkingLevels` is derived.
- **Refetch after any catalogue-changing credential event.** An explicit `refetchCatalogue`
  callback is threaded from the panel into `ProviderAuthSection` and the provider card, fired on
  API-key save, custom-provider save, **and OAuth / device-code completion**.
- **Registry-unavailable state renders as a sibling callout above the picker** in
  `SettingsPanel`, not inside `ModelSelector` — the selector is `disabled={!hasModels}`
  (`ModelSelector.tsx:310-316`) so an in-picker state is unreachable while the list is empty. An
  in-picker error row is a follow-up once `open-empty-model-selector` lands.

**Explicitly NOT changed:**

- Session-scoped pickers (StatusBar, `CommandInput`) keep reading `modelsMap` per session.
- No `supportedThinkingLevels` is derived anywhere new; the mapper drops `thinkingLevelMap`. The
  guard `packages/extension/src/__tests__/single-derivation-guard.test.ts` scans the extension
  and server only, so it will not catch a shared-package copy — constraint held by discipline
  and by the mapper's spec, not by the guard.
- No server change. The env-credential gap in `InternalRegistry` is left as-is and worked around
  by the union.

**Out of scope (follow-ups):**

- **Making `InternalRegistry` env-credential aware** (merging pi-ai `getEnvApiKey` into
  `readAugmentedAuth`). This is the principled fix — it would also correct `/v1/models`, proxy
  routing, and the `list_models` agent tool, and would let the picker drop the union. Deliberately
  deferred: it is a server behaviour change with its own blast radius.
- `OpenSpecRunConfigContext` and the folder-home spawn composer, which read `modelsMap`.
- `?annotated=1` rendering of excluded models.
- The in-picker (as opposed to sibling) registry-unavailable row.

## Capabilities

### Modified Capabilities

- `settings-panel`: the Default Model selector is sourced from the catalogue ∪ session-models
  union rather than the session union alone, and is usable with zero live sessions; the model
  proxy editors are sourced from the catalogue alone; credential writes refetch the catalogue;
  a registry-unavailable response renders an explicit callout.

## Impact

- `packages/shared/src/` — **new**: pure `catalogueRowToModelInfo` mapper beside `ModelInfo`.
- `packages/client/src/lib/api/models-api.ts` — **new**: `fetchModelCatalogue()` returning a
  discriminated result (`ok` | `unavailable` | `error`) so non-2xx and network failures are
  distinguishable from a successful empty list.
- `packages/client/src/App.tsx:2350` — build and pass **two** props: the union for the default
  model picker, the catalogue for the proxy section.
- `packages/client/src/components/settings/SettingsPanel.tsx` — accept both props; thread
  `refetchCatalogue` into `ProviderAuthSection` (currently rendered with no props, `:1472`) and
  the provider card; render the unavailable callout; pass the catalogue prop to
  `ModelProxySection` (`:1503`).
- `packages/client/src/components/settings/ModelProxySection.tsx` — consume the catalogue prop
  (`:133`, `:203`, `:403`).
- Tests: mapper unit tests; `SettingsPanel.test.tsx` for zero-session population, union
  precedence, refetch triggers incl. OAuth, and the unavailable callout.
- No server, extension, protocol, or persistence change. Additive and reversible.
- `ModelSelector.tsx` is **not** modified — avoiding a merge collision with the concurrent
  `open-empty-model-selector` change, which owns that file.

## Discipline Skills

- `review-code` — non-trivial client change, before commit.
- `doubt-driven-review` — already applied (single-model + cross-model on `@propose-review-1`);
  re-apply if the union rule or the two-prop split is revised.
