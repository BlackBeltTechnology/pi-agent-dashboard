# explicit-model-preserved.spec.ts — index

L3 for `fix-default-model-clobbers-explicit-model` (test-plan #I1, #I2): launches a detached child pi process in-container with `--model faux/faux-2` (dedicated cwd, `PI_DASHBOARD_URL` to the running gateway), polls `/api/sessions` across the ≥8s deferred-apply window asserting the model never flips to the seeded default `faux/faux-1`; REST-spawned no-flag session still converges to the default. Cleans up its child.
