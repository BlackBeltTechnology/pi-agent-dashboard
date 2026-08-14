# Align the faux harness pi-settings seed with the split default-model schema

## Why

When `PI_E2E_SEED=1`, `docker/test-entrypoint.sh` seeds pi's own
`~/.pi/agent/settings.json` so the faux model is selected the moment pi starts —
before the bridge's default-model gate runs. It writes the legacy **combined**
form `defaultModel: "faux/faux-1"`.

Current pi resolves the startup default model from the **split** pair
`defaultProvider` + `defaultModel`, not from a combined `"provider/model"`
string. With only the combined value seeded, the faux model does not resolve at
pi startup and the harness relies on the bridge to correct the model afterwards.

Seeding the split pair makes the faux model resolve deterministically at pi
startup, matching the schema pi actually reads. This is strictly faux-harness
seed correctness; no runtime spawn plane changes.

## What Changes

- `docker/test-entrypoint.sh` (`PI_E2E_SEED` path): the `settings.json` seed
  writer emits the split pair `defaultProvider: "faux"` + `defaultModel: "faux-1"`
  instead of the combined `defaultModel: "faux/faux-1"`. The merge stays
  non-clobbering (each key is only written when absent) and the guard is
  unchanged.

No dashboard runtime code, no spawn plane, and no other seed block (the
`config.json` model-proxy seed keeps its own combined value) is touched.

## Discipline Skills

None apply. This is a one-block schema alignment in a test-only harness seed
script; it touches no auth/untrusted-input/secrets/PII path, no latency budget,
and adds no new endpoint or external call.
