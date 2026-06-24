# Tasks

## 1. Rename package identity
- [x] 1.1 `packages/image-fit-extension/package.json` — set `"name"` to `@blackbelt-technology/pi-image-fit-extension`. → verify: `grep '"name"' packages/image-fit-extension/package.json` shows new name.
- [x] 1.2 `packages/shared/src/recommended-extensions.ts` (~L211-213) — update `id` and `source` (`npm:@blackbelt-technology/pi-image-fit-extension`); leave `displayName: "pi-image-fit"`. → verify: grep shows new id/source, old `displayName` intact.
- [x] 1.3 `packages/image-fit-extension/README.md` — update H1 title + `pi install …` line to new name. Leave log-prefix/env-var examples untouched.

## 2. Update test fixtures
- [x] 2.1 `packages/shared/src/__tests__/recommended-extensions.test.ts` — replace 3 occurrences of the old id with the new one.
- [x] 2.2 `packages/shared/src/__tests__/source-matching.test.ts` (L164) — replace `npm:@blackbelt-technology/pi-image-fit` with `…/pi-image-fit-extension`.
- [x] 2.3 → verify: `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` is clean.

## 3. Update docs (delegate to subagent, caveman style)
- [x] 3.1 `docs/faq.md` (~L697) — new name.
- [x] 3.2 `docs/file-index-shared.md` — recommended-extensions row: new id/source; add `See change: rename-image-fit-package-suffix`.
- [x] 3.3 `docs/file-index-extension.md` — package.json row: new name; add `See change: rename-image-fit-package-suffix`.

## 4. Deprecate old npm name (release step)
- [x] 4.1 After publishing the renamed package: `npm deprecate @blackbelt-technology/pi-image-fit "renamed to @blackbelt-technology/pi-image-fit-extension"`. No `unpublish`.

## 5. Validate
- [x] 5.1 `openspec validate rename-image-fit-package-suffix` passes.
- [x] 5.2 Repo-wide grep: no stray `@blackbelt-technology/pi-image-fit"` (package id) remains outside the runtime-brand allowlist (`[pi-image-fit]`, tmpdir, env vars). → `grep -rn '@blackbelt-technology/pi-image-fit\b' packages src docs | grep -v 'pi-image-fit-extension'` returns nothing.
