# __tests__/test-selection-data.test.mjs — index

Data contract for `test-selection/*.json` (E29): slow-tier entries are existing test files; every trigger glob matches a tracked file and every trigger test glob a test; covered-elsewhere entries are existing TOP-LEVEL locations (never `packages`/`scripts`); `timings.json` is a flat number map. See change: speed-up-ci-affected-tests.
