# Fix: faux settings-seed must use pi-0.84 split defaultProvider + defaultModel

## Why

`docker/test-entrypoint.sh` seeds pi's own `~/.pi/agent/settings.json` with the combined `defaultModel: "faux/faux-1"` so the faux model is the startup default before the bridge gate runs (test-entrypoint.sh:~299). Under pi-0.84 the settings schema split the single combined field into two keys — `defaultProvider` + `defaultModel` (bare id) — and `findInitialModel` now gates startup selection on **both**:

```
step 3:  if (defaultProvider && defaultModelId)
             modelRuntime.getModel(defaultProvider, defaultModelId)
```

With the combined string in `defaultModel` and no `defaultProvider`, the `defaultProvider` term is `undefined`, so step 3 is skipped entirely — the seed no longer pins faux at startup. It currently "works" only by accident: pi falls through to step 4 ("first available model with valid API key"), and because faux needs no key it is often `availableModels[0]`. That is incidental ordering — exactly the nondeterminism class the harness's own `trustedNetworks` comment warns against — not a deterministic pin.

This is a **generic pi-0.84 config-shape migration** in the test harness, confirmed independent of any plugin: removing the invoice plugin does not revert the drift.

## What Changes

- The settings.json seed step in `docker/test-entrypoint.sh` writes the **split** pi-0.84 shape — `defaultProvider: "faux"` + `defaultModel: "faux-1"` (bare id, matching the fixture's `provider: "faux"` / model `id: "faux-1"`) — instead of the combined `"faux/faux-1"`.
- The seed becomes a **JSON-aware node merge** that is the sole idempotence authority (the brittle `grep '"defaultModel"'` shell guard is dropped). **All mutation is gated on `!cfg.defaultProvider`** — a present `defaultProvider` is a settled choice the seed never touches. Inside that gate it either normalizes a legacy combined `defaultModel` (`"faux/faux-1"` → `defaultProvider:"faux"` + bare `defaultModel:"faux-1"`) or, on a fresh file, pins faux. It writes only when a change occurred and reports "seeded" only then. This makes a settings.json left by the *old* seed genuinely repaired — `getModel("faux","faux-1")` resolves — not merely annotated, while never mangling a legitimate slash-bearing bare id (e.g. openrouter `anthropic/claude-3.5` under an explicit provider) and never clobbering an existing settings file: a present-but-unparseable file is left untouched.
- **Precondition (documented, holds):** pi-0.84's `findInitialModel` step 3 also requires `hasConfiguredAuth(found.provider)`. The faux fixture registers `pi.registerProvider("faux", { apiKey: "faux-no-key", … })`, so `faux` is in `configuredProviders` and this check passes; the split keys are sufficient for deterministic selection.
- **Out of scope — the dashboard `config.json` seed is left unchanged.** Its `defaultModel: "faux/faux-1"` feeds `bridge-default-model-gate`, which splits the combined `provider/model` string itself before calling `pi.setModel("faux","faux-1")`. Combined form is the dashboard's own field contract there and is correct.
- **Out of scope — `qa/fixtures/faux-roles.json` is left unchanged.** Its `"faux/faux-1"` role refs resolve via the `model:resolve` role-preset path, not the settings default-model path.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `faux-model-integration-tests`: new requirement — the docker harness settings-seed SHALL pin faux as the deterministic startup default using pi-0.84's split `defaultProvider` + `defaultModel` keys, and SHALL repair a settings file left by the pre-split seed.

## Impact

- `docker/test-entrypoint.sh` — the settings.json seed node block: gate on `!cfg.defaultProvider`, normalize-or-pin, corrupt-file no-clobber, and move the seed log inside the write branch (the shell `grep`/`echo` guard is removed).
- Regression surface that must stay unchanged: the `config.json` seed (`defaultModel: "faux/faux-1"`) and its bridge-gate consumer; the `providers.json`/`faux-roles.json` role-preset seed.
- No product code ships to users — test-harness seed only. Verified by the docker e2e harness.

## Discipline Skills

- `review-code` — small but load-bearing harness change on the startup-selection path; run before commit.
- No other checkpoints apply: no auth/untrusted-input/secrets (`security-hardening` n/a); no latency/throughput budget (`performance-optimization` n/a); no new endpoint/job/external-call (`observability-instrumentation` n/a).
