## 1. Fix (TDD)

- [x] 1.1 Self-test `8.3` in `selftest-workflow.mjs`: relative package dir → read entry `.bpmn` + `package.yaml` through render root — verify: fails before fix (ELOOP)
- [x] 1.2 `render.mjs` `assembleRenderRoot`: `pkgDir = resolve(pkgDirIn)` before linking — verify: `node selftest.mjs` 84 passed, `node fixtures.mjs` 24/24 match
- [x] 1.3 Update `packages/pi-forms-bpmn/AGENTS.md` render.mjs/selftest-workflow rows — verify: rows mention the change
