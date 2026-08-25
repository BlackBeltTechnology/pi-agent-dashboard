# faux-roles.json — index

Faux role-preset (change: add-flow-plugin-e2e-tests). Maps every built-in role (planning/coding/fast/research/compact/vision/architect) -> faux/faux-1 so flow agents using `model: @role` resolve to the key-free faux model + exercise `model:resolve`. Delivery: IMAGE-BAKED — docker/test-entrypoint.sh strips `_comment` and copies to `~/.pi/agent/providers.json` under PI_E2E_SEED.
