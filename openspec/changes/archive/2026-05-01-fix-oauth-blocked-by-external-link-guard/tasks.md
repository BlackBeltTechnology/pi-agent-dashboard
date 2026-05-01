## 1. Lock the failure mode with a red test

- [x] 1.1 Add a unit test in `packages/electron/src/__tests__/link-handling.test.ts` that imports `decideWillNavigate` (not yet exported) and asserts:
  - On dashboard, same-origin target → `"allow"`.
  - On dashboard, external target → `"open-external"`.
  - On `accounts.google.com`, target is also under `accounts.google.com` → `"allow"` (the OIDC fix).
  - On `accounts.google.com`, target is back to dashboard origin → `"allow"`.
  - On `accounts.google.com`, target is `login.microsoftonline.com` → `"allow"`.
  - Empty / unparseable current URL → falls back to leaving-dashboard rules.
  - Unparseable server origin → `"cancel"` (fail closed).
  Run; confirm it FAILS (helper does not exist).

## 2. Implement the helper

- [x] 2.1 In `packages/electron/src/lib/link-handling.ts` add `export type WillNavigateDecision = "allow" | "open-external" | "cancel"` and `export function decideWillNavigate(serverOrigin: string, currentUrl: string, targetUrl: string): WillNavigateDecision`. The implementation MUST:
  - Parse `serverOrigin`; on failure or `"null"` origin, return `"cancel"`.
  - Parse `currentUrl`; if it succeeds and the resulting origin is NOT the dashboard origin, return `"allow"`.
  - Otherwise call the existing `isSameOriginUrl(targetUrl, dashboardOrigin)` and return `"allow"` (true) / `"open-external"` (false).
- [x] 2.2 Re-run §1.1; confirm all 8 assertions PASS.

## 3. Wire the helper into the Electron shell

- [x] 3.1 In `packages/electron/src/main.ts` change the import from `import { isSameOriginUrl } from "./lib/link-handling.js"` to `import { decideWillNavigate } from "./lib/link-handling.js"`.
- [x] 3.2 Replace the `will-navigate` callback body with:
  ```ts
  const currentUrl = mainWindow?.webContents.getURL() ?? "";
  const decision = decideWillNavigate(serverUrl, currentUrl, url);
  if (decision === "open-external") {
    event.preventDefault();
    void shell.openExternal(url);
  } else if (decision === "cancel") {
    event.preventDefault();
  }
  ```
  Add an inline comment cross-referencing this change name and the OAuth/OIDC rationale.
- [x] 3.3 Leave `setWindowOpenHandler` untouched.
- [x] 3.4 Verify no other callsite in `packages/electron/src/main.ts` still uses `isSameOriginUrl` (the import should be cleanly replaced, not left as a dead import).

## 4. Spec updates

- [x] 4.1 In `openspec/changes/fix-oauth-blocked-by-external-link-guard/specs/electron-shell/spec.md` add:
  - `## MODIFIED Requirements` for the existing "External links open in the OS default browser" capability — refine the `will-navigate` arm to be current-origin-aware. The `setWindowOpenHandler` arm is preserved verbatim.
  - New scenario: "Mid-flight OAuth / OIDC navigation is not intercepted."
  - Refined scenario: "Top-level navigation pinned to dashboard origin (when on the dashboard)" — explicitly scoped to dashboard-as-current-origin.
  - New scenario: "Decision helper exists and is unit-tested."

## 5. Test hygiene

- [x] 5.1 Run `npm test -- link-handling` in `packages/electron`; expect all old `isSameOriginUrl` cases plus the 8 new `decideWillNavigate` cases to pass (23 total).
- [x] 5.2 Run the full electron suite (`HOME=$(mktemp -d) npx vitest run --root packages/electron`); confirm no new failures vs the pre-existing baseline. (Pre-existing failures unrelated to this change are documented in the apply session.)

## 6. Documentation

- [x] 6.1 Update `AGENTS.md`'s `packages/electron/src/main.ts` entry to mention the OAuth-aware `will-navigate` and reference this change name.
- [x] 6.2 Update `AGENTS.md`'s `packages/electron/src/lib/link-handling.ts` entry (or add one if missing) to describe both helpers (`isSameOriginUrl` + `decideWillNavigate`).
- [x] 6.3 Add a `### Fixed` entry to `CHANGELOG.md` under `## [Unreleased]` describing the OIDC regression and the fix, citing this change name.
