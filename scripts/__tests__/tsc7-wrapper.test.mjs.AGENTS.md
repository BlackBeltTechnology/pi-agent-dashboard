# __tests__/tsc7-wrapper.test.mjs — index

E1–E6, E8, E9, E11, X4: wrapper runs TS 7 from any cwd, forwards exit code, alias-missing message, no bare `tsc` in scripts/shell/send-types, `require("typescript")` stays 5.x, 4-package emit identical 5.9 vs TS 7, codegen on 5.x API, docs name wrapper, team-app ≤ 8 errors. See change: migrate-typecheck-to-ts7.
