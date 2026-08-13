# __tests__/smoke-node-matrix.test.ts — index

Repo-lint (#E8): `_smoke.yml` `standalone-install-smoke-linux` matrix majors equal the SUPPORTED set `{22,24,25,26}`, which must sit inside `package.json#engines.node` (supported ≠ admitted — EOL 23 unlisted). Uses the job-body line-slicing helper, not a YAML lib (no `yaml` dep here).
