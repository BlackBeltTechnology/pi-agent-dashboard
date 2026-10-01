# __tests__/select-affected-tests-graph.test.mjs — index

First vitest-Node-API test: builds the REAL index in a child process. `monaco-setup.ts` is a leaf error while `SettingsPanel.test.tsx` still reaches `SettingsPanel.tsx` (X1); `keeper.test.ts` phase `real-process`; `check-conventions.test.mjs` names `openspec`; setupFiles/globalSetup are global inputs (2.5); build < 60 s (P1). See change: speed-up-ci-affected-tests.
