## 1. Implementation

- [ ] 1.1 In `packages/server/src/routes/recommended-routes.ts`, add a `localNameMatches(row, entry)` helper: parse `entry.source` via `parseSourceKey` (npm kind → `name`); read `<row.installedPath>/package.json` `name`; return `name === parsedNpmName`. Fail closed (false) on missing `installedPath`, missing/unreadable file, invalid JSON, or non-string `name`.
- [ ] 1.2 Share one `package.json` parse per `installedPath` within `enrichEntry` so the match (1.1) and the existing `version`/`pi.skills` reads use a single parse (no extra IO).
- [ ] 1.3 Update `inGlobal`/`inLocal` and the `activeInPi` computation in `enrichEntry` to use `sourcesMatch(...) || localNameMatches(...)` (either-match semantics).
- [ ] 1.4 Update `recommended-routes.ts` doc comment to describe the fs-aware name fallback; keep `sourcesMatch` / `source-matching.ts` untouched.

## 2. Tests

- [ ] 2.1 Unit test (server): decoration-mismatched local checkout (`packages/image-fit-extension`, `package.json` name `@blackbelt-technology/pi-image-fit-extension`) enriches to `activeInPi: true` / correct `installed.scope`.
- [ ] 2.2 Unit test: `package.json` absent/unreadable → falls back to string `sourcesMatch` (still matches basename case).
- [ ] 2.3 Unit test: unrelated local package (different `name`, non-matching basename) → not installed.
- [ ] 2.4 Unit test: name mismatch does not override a valid string match (either-match).
- [ ] 2.5 Assert no extra file read vs baseline (single parse per `installedPath`).

## 3. Validate

- [ ] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log` green (see AGENTS "Running Tests").
- [ ] 3.2 `openspec validate match-local-installs-by-package-name --strict`.
- [ ] 3.3 Manual/QA: restart server, open Packages tab, confirm all 7 locally-installed recommended packages show Active/Remove and the "suggested missing" count drops accordingly.

## 4. Docs

- [ ] 4.1 Update `packages/server/src/routes/AGENTS.md` row for `recommended-routes.ts` with the local-name fallback + `See change:`.
