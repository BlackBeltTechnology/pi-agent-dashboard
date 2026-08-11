# Design — pin-invoicebot-spawn-model

## Context

`PluginSpawnOptions` (dashboard-plugin-runtime `server-context.ts:91-95`) already
carries the option:

```ts
/** Optional model id (resolved provider/model) passed as `--model`. */
model?: string;
```

`SessionLinkDeps.spawnSession` (session-link.ts:35-37) already declares
`model?: string` too — it is simply never passed. So this is a wiring defect, not
a missing capability, and the fix needs no host or protocol change.

## Decision 1 — the accepted shape is a single resolved `provider/modelId` string

The host option is one string forwarded as `--model`, so that is what is passed.
`provider` and `modelId` are parsed and validated **separately** for correctness,
then re-joined; they are not invented as two separate spawn fields.

Parsing rule: split on the FIRST `/`. `provider` is the part before it, `modelId`
everything after. Both must be non-empty and free of whitespace and control
characters. Splitting on the first separator (rather than requiring exactly one)
keeps nested ids such as `openrouter/anthropic/claude-x` valid.

## Decision 2 — precedence with skip-on-invalid, not fail-on-invalid

```
plugin config (model | defaultModel)
        │ invalid → warn, continue
        ▼
dashboard config.json#defaultModel
        │ invalid → warn, continue
        ▼
IB_MODEL env
        │ invalid → warn, continue
        ▼
undefined  ⇒  omit `model`  ⇒  host default (unchanged behaviour)
```

A malformed value must never break spawning: an invoice failing to process
because someone typo'd a config string would be a worse failure than the one
being fixed. Each rejection is logged once with the offending value so the
misconfiguration is visible.

## Decision 3 — resolution is a function called per spawn, not a boot snapshot

`SessionLinkDeps` gains `resolveSpawnModel?: () => string | undefined`. Called at
spawn time so a config edit takes effect on the next spawn without a restart.
Optional, so existing unit fakes keep working and the no-config path is provably
unchanged.

## Decision 4 — one helper, both paths

`dispatchFlow`'s spawn (processing/automation run) and `spawnScopedAndBind`'s
spawn (scoped detail session) both spread the same resolved value:

```ts
...(model ? { model } : {})
```

Spreading rather than assigning `model: undefined` keeps the "no configured
model" case byte-identical to today's options object.

## Decision 5 — the resolver takes values, not sources

`resolveSpawnModel(sources, logger?)` receives already-read candidate values
(`pluginConfigModel`, `dashboardDefaultModel`, `envModel`). Reading plugin
config / dashboard config / env stays in `index.ts`. This keeps the precedence
logic pure and unit-testable without touching `HOME`, and keeps I/O at the edge.

## Security

The resolver reads model identifiers only. It never reads `auth.json`, tokens,
refresh tokens or any credential, and never forwards them into spawn env. The
logged value on rejection is a model id, not a secret.

## Risks

- A deployment relying on the built-in default while ALSO setting
  `defaultModel`/`IB_MODEL` now follows the configured model. That is the
  intended correction, and it is exactly what the failing deployment asked for.
- `loadConfig()` resolves `~/.pi/dashboard/config.json` via `os.homedir()`, so a
  server running under a different HOME than the configured one sees no
  `defaultModel` and falls through to `IB_MODEL`. Acceptable: the env layer is
  precisely the backstop for that case.
