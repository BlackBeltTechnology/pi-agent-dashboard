# custom-entry-replay-parity.spec.ts

L3 (change: render-inline-reasoning-and-custom-entries, F2). Live custom rows vs cold-reload replay: same rows, order, truncation form.

Drives the REAL custom surfaces via the `e2e-custom` fixture extension (qa/fixtures/e2e-custom.ext.ts), staged by docker/test-entrypoint.sh under PI_E2E_SEED. Faux scenarios live in qa/fixtures/faux-scenarios.ts.
