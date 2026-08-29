# helpers/__tests__/evidence-path.test.ts — index

Unit tests (vitest `tests` project, NOT Playwright) for `helpers/evidence-path.ts`. 30 cases: active-dir preference, newest-archive pick, prefix-collision rejection, single-component `changeName` guard (`../..` must not resolve to repo root), evidence preserved on malformed/non-object JSON, reserved keys (`__proto__`) persisted as own properties, and the fail-loud path. Runs in normal CI because both consuming specs are opt-in. See issue #549.
