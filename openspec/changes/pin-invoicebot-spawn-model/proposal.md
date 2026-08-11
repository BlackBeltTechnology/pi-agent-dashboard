# pin-invoicebot-spawn-model

## Why

Every InvoiceBot-owned spawn omits `model`, so the host falls back to pi's
built-in default instead of the configured InvoiceBot model. Measured on a
correctly-configured deployment (`IB_MODEL=openai-codex/gpt-5.4`, dashboard
`config.json#defaultModel=openai-codex/gpt-5.4`, every role also
`openai-codex/gpt-5.4`), the spawned scoped session records:

```json
{"source":"dashboard","name":"invoicebot-scoped:<id>",
 "model":"anthropic/claude-opus-4-8","lifecyclePolicy":"ephemeral"}
```

and dies immediately:

```
OAuth refresh failed for anthropic: invalid_grant — Refresh token not found or invalid
```

Both spawn sites in `session-link.ts` pass `cwd`/`guard`/`env`/`automationRun`
but never `model`, even though the host option exists. Result: invoices park,
and one was left stuck at `received`.

## What Changes

- Add a single shared resolver used by **every** InvoiceBot spawn path (scoped
  detail session AND processing/automation run session). No spawn site resolves
  a model on its own.
- Resolution precedence, first valid wins:
  1. the InvoiceBot plugin's own trusted config (`model`, or `defaultModel`),
  2. dashboard `config.json#defaultModel`,
  3. the `IB_MODEL` environment variable,
  4. otherwise omit `model` entirely and keep the existing host default.
- Validate each candidate as `provider/modelId`. A malformed candidate is
  logged and **skipped** so resolution continues down the precedence chain;
  it never throws and never blocks a spawn.
- Pass the resolved value through the host's existing typed spawn option
  (`PluginSpawnOptions.model`, a resolved `provider/model` string forwarded as
  `--model`). No new option shape is invented.
- Resolution reads configuration only. No credential, token or auth material is
  read, logged or forwarded.

## Impact

- Affected specs: `invoicebot-session-profile`
- Affected code: `packages/invoicebot-plugin/src/server/spawn-model.ts` (new
  resolver), `packages/invoicebot-plugin/src/server/session-link.ts` (both spawn
  calls), `packages/invoicebot-plugin/src/server/index.ts` (wires the resolver
  from plugin config + dashboard config + env)
- No REST, protocol or client change. Behaviour with no configured model is
  unchanged, so nothing else in the host shifts.

## Discipline Skills

- `systematic-debugging` — the defect is already root-caused to the two spawn
  sites; the change is verified against that evidence rather than guessed.
- `security-hardening` — the resolver sits next to spawn/credential
  machinery; it must read config only and never touch auth material.
