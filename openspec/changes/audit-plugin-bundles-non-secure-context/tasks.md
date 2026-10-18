## 1. Scan test first (red)

- [ ] 1.1 Rework `packages/client/src/components/connectivity/__tests__/secure-context-scan.test.ts` per design D3 + D4:
  - Manifest-derived client roots: each `pi-dashboard-plugin.client` entry dir minus that manifest's `server`/`bridge` entry dirs, deduplicated by realpath.
  - Also scan existing `packages/*/src/client`, `client/src`, `client-utils/src`, and `dashboard-plugin-runtime/src` minus `server/ bridge/ vite-plugin/ test-support/`.
  - Widened `SECURE_API`: member, quoted-global, destructuring and bare-method arms over four APIs.
  - TypeScript-parser comment stripping, not raw `createScanner`; see D4.
  - Header comment updated: four APIs, the mediaDevices allowlist rule, `See change: audit-plugin-bundles-non-secure-context`.
  - Add `client-utils/src/identity/login-flow.ts` (guarded `crypto?.subtle`) to the allowlist with a justifying comment.

  Verify `typescript` resolves from the test. Harness exemplar: the existing scan test itself.
- [ ] 1.2 Fixture self-test of the matcher, in the same file (test-plan #E9).
  - Input: one in-memory fixture per form: `navigator.clipboard.writeText(s)`, `navigator?.clipboard`, `navigator["clipboard"]`, `navigator?.["clipboard"]`, `crypto.randomUUID()`, `crypto?.subtle`, `globalThis.crypto.subtle`, `window["navigator"]`, `const { clipboard } = navigator;`, `const { randomUUID } = globalThis.crypto;`, `navigator.mediaDevices`, `m.getUserMedia(x)`, `m?.getUserMedia?.(x)`, `x.getDisplayMedia()`.
  - Trigger: run the matcher on each fixture.
  - Observable: every fixture reports ≥ 1 hit.

  Exemplar: `secure-context-scan.test.ts`. Verify: `npx vitest run packages/client/src/components/connectivity/__tests__/secure-context-scan.test.ts -t matcher` green.
- [ ] 1.3 Fixture self-test of non-code forms (test-plan #E10).
  - Input: `// navigator.clipboard.writeText(s)`, `/* crypto.randomUUID() */`, ``const u = `${p}//${h}`;``, `const r = /\/\//;`, `const s = "/*";`.
  - Trigger: matcher with parser-based comment stripping.
  - Observable: the comment fixtures give 0 hits. The template, regex and string fixtures give 0 hits, and exactly 1 hit once a real `navigator.clipboard` call is appended after each.

  Exemplar: `secure-context-scan.test.ts`. Verify with the same command.
- [ ] 1.4 Root derivation, manifest outside `src/client` (test-plan #E11).
  - Input: repo at HEAD.
  - Trigger: compute scan roots.
  - Observable: roots include `quota-plugin/src`, `demo-plugin/src`, `flows-anthropic-bridge-plugin/src`, `grammar-plugin/src`, `roles-plugin/src` and every existing `packages/*/src/client`. They exclude each manifest's `server`/`bridge` dirs and `dashboard-plugin-runtime/src/{server,bridge,vite-plugin,test-support}`. No root appears twice.

  Exemplar: `secure-context-scan.test.ts`. Verify with the same command.
- [ ] 1.5 Root derivation, package without a client (test-plan #E12).
  - Input: `fixture-policy-plugin`, `keycloak-resolver-plugin`, `mcp-server-plugin`.
  - Trigger: compute scan roots.
  - Observable: no ENOENT, and none of the three is in the roots.

  Exemplar: `secure-context-scan.test.ts`. Verify with the same command.
- [ ] 1.6 mediaDevices is enforced by the scan only (test-plan #E15).
  - Input: in-memory fixture path `packages/<fixture>/src/client/Mic.tsx` containing `navigator.mediaDevices.getUserMedia({audio:true})`.
  - Trigger: matcher plus root-membership check.
  - Observable: flagged as an offender unless allowlisted.

  Exemplar: `secure-context-scan.test.ts`. Verify with the same command.
- [ ] 1.7 Red on the real tree (test-plan #E13).
  - Input: repo after 1.1–1.6.
  - Trigger: run the scan.
  - Observable: FAILS with exactly 2 offenders, `gmail-plugin/src/client/GmailSettings.tsx` and `kb-plugin/src/client/KbTestSearch.tsx`.

  Exemplar: `secure-context-scan.test.ts`. Verify: the scan run output lists only those two.

## 2. Hoist helpers into the plugin runtime (D1)

- [ ] 2.1 Runtime helper tests, red first. Create `packages/dashboard-plugin-runtime/src/__tests__/secure-context.test.ts`. Harness exemplar: `packages/dashboard-plugin-runtime/src/__tests__/oauth-flow-client.test.ts`; for the copy fallback, `packages/client/src/components/__tests__/CopyButton.test.tsx`. Stub `document.execCommand` explicitly. Cases:
  - (test-plan #E1)
    - Input: `crypto.randomUUID` deleted, `getRandomValues` present.
    - Trigger: `randomUuid()` called 1000×.
    - Observable: all values match the v4 regex, all are distinct, no throw.
  - (test-plan #E2)
    - Input: `crypto.randomUUID` stubbed to `"11111111-1111-4111-8111-111111111111"`.
    - Trigger: `randomUuid()`.
    - Observable: returns the stub, stub called once, `getRandomValues` not called.
  - (test-plan #E3)
    - Input: `writeText` resolves.
    - Trigger: `copyText("x")`.
    - Observable: `true`, `writeText("x")` called, `execCommand` not called, 0 `<textarea>` left.
  - (test-plan #E4)
    - Input: clipboard undefined, `execCommand` → `true`.
    - Trigger: `copyText("x")`.
    - Observable: `true`, `execCommand("copy")` called once, 0 `<textarea>` left.
  - (test-plan #E5)
    - Input: `writeText` rejects `NotAllowedError`, `execCommand` → `true`.
    - Trigger: `copyText("x")`.
    - Observable: `true`, no unhandled rejection.
  - (test-plan #E6)
    - Input: clipboard undefined, `execCommand` → `false`.
    - Trigger: `copyText("x")`.
    - Observable: `false`, 0 `<textarea>` left.
  - (test-plan #E7)
    - Input: clipboard undefined, `execCommand` throws.
    - Trigger: `copyText("x")`.
    - Observable: `false`, no throw, 0 `<textarea>` left.

  Verify the file fails before 2.2: module missing.
- [ ] 2.2 Add `packages/dashboard-plugin-runtime/src/secure-context.ts` with `randomUuid()` and `copyText()`, bodies moved verbatim from `packages/client/src/lib/util/{random-uuid,clipboard}.ts`. Re-export both from `packages/dashboard-plugin-runtime/src/index.ts`. Verify `npx vitest run packages/dashboard-plugin-runtime/src/__tests__/secure-context.test.ts` is green and `npm run lint` passes.
- [ ] 2.3 Re-export equivalence (test-plan #E8).
  - Input: `packages/client/src/lib/util/random-uuid.ts` and `clipboard.ts` turned into re-exports from `@blackbelt-technology/dashboard-plugin-runtime`.
  - Trigger: import `randomUuid` and `copyText` from the client paths and from the runtime barrel.
  - Observable: the client exports are `===` the runtime exports.

  Add the case to `packages/client/src/lib/util/__tests__/random-uuid.test.ts` (exemplar: that file). Leave its existing E29 spawn-dispatch cases in place. Verify `npm run lint` passes and `npx vitest run packages/client/src/lib/util packages/client/src/components/__tests__/ToolsSection.install-dropdown.test.tsx packages/client/src/components/Gateway/__tests__/GatewayPairQR.test.tsx` is green.
- [ ] 2.4 Allowlist integrity (test-plan #E14).
  - Input: the allowlist adds `dashboard-plugin-runtime/src/secure-context.ts` and removes the two client util entries.
  - Trigger: run the scan.
  - Observable: every entry exists on disk, and the two client util paths give 0 hits.

  Exemplar: `secure-context-scan.test.ts`. Verify `npx vitest run packages/client/src/components/connectivity/__tests__/secure-context-scan.test.ts` reports only the gmail and kb offenders.

## 3. Fix plugin Copy actions (D2)

- [ ] 3.1 kb copy tests, red first, in `packages/kb-plugin/src/client/__tests__/KbSourcesSearch.test.tsx` (exemplar: its `describe("KbTestSearch")` block, `:344`). Cases:
  - (test-plan #F1)
    - Input: one hit `docs/a.md`, clipboard undefined, `execCommand` → `false`.
    - Trigger: click Copy.
    - Observable: `kb-search-copy-failed` with `aria-live="polite"` shown, `kb-search-copied` absent, no throw.
  - (test-plan #F2)
    - Input: same hit, clipboard undefined, `execCommand` → `true`.
    - Trigger: click Copy.
    - Observable: after `await waitFor`, `kb-search-copied` shown and failure indicator absent.
  - (test-plan #F3)
    - Input: the existing F9 setup (`:412-421`), with `writeText` resolving.
    - Trigger: click Copy.
    - Observable: `writeText(path)` called, then `kb-search-copied` appears via `await waitFor` (converts F9's sync assert) and clears after 1500 ms with fake timers.
  - (test-plan #F4)
    - Input: hits A and B, each `copyText` call deferred; A resolves `false` after B resolves `true`.
    - Trigger: click A, click B, resolve B, then resolve A.
    - Observable: the indicator shows B copied, and A's late result is ignored.
  - (test-plan #X1)
    - Input: `writeText` rejects `NotAllowedError` and `execCommand` throws.
    - Trigger: click Copy.
    - Observable: no unhandled rejection, and `kb-search-copy-failed` shown.

  Verify the new cases fail before 3.2.
- [ ] 3.2 `packages/kb-plugin/src/client/KbTestSearch.tsx`:
  - `copy` awaits `copyText(path)`, with a latest-click-wins request counter.
  - `copied` is set only on `true`; otherwise show `data-testid="kb-search-copy-failed"` with `aria-live="polite"` and key `copyFailed`.
  - Add `copyFailed` to the `zh-CN` and `hu` maps in `packages/kb-plugin/src/i18n.ts` (English via the `t()` default arg).

  Verify `npx vitest run packages/kb-plugin` is green.
- [ ] 3.3 Gmail copy tests, red first, in `packages/gmail-plugin/src/client/__tests__/panel.test.tsx` (exemplar: that file's existing `GmailSettings` renders). Cases:
  - (test-plan #F5)
    - Input: `Copyable` value `gcloud ...`, clipboard undefined, `execCommand` → `false`.
    - Trigger: click Copy.
    - Observable: label "Copy failed" in a `role="status"` region, never "Copied", reverts to "Copy" after 1500 ms with fake timers.
  - (test-plan #F6)
    - Input: same `Copyable`, `execCommand` → `true`.
    - Trigger: click Copy.
    - Observable: label "Copied" in `role="status"`, reverts after 1500 ms.
  - (test-plan #F7)
    - Input: each `copyText` call deferred; the 1st resolves `false` after the 2nd resolves `true`.
    - Trigger: click twice, resolve the 2nd, then the 1st.
    - Observable: final label "Copied", never "Copy failed" after the 2nd settled.

  Verify the new cases fail before 3.4.
- [ ] 3.4 `packages/gmail-plugin/src/client/GmailSettings.tsx`, `Copyable` only:
  - Use `copyText(value)` with a latest-click-wins counter.
  - Transient label Copied / Copy failed for 1500 ms in a `role="status"` region.
  - Add `copied` and `copyFailed` to the `zh-CN` and `hu` maps in `packages/gmail-plugin/src/i18n.ts` (English via the `t()` default arg).
  - If `improve-gmail-plugin-setup-ux` or `add-gmail-auto-setup` lands first, rebase over it. Do not reformat.

  Verify `npx vitest run packages/gmail-plugin` is green.
- [ ] 3.5 i18n parity (test-plan #F8).
  - Input: the new `copyFailed` (kb, gmail) and `copied` (gmail) keys in `zh-CN` and `hu`.
  - Trigger: run `packages/kb-plugin/src/__tests__/i18n.test.ts` and `packages/gmail-plugin/src/client/__tests__/client-entry.test.tsx`.
  - Observable: both green, and every new zh-CN/hu string non-empty.

  Exemplar: those two parity tests; extend them only if they don't already assert the new keys. Verify both files pass.
- [ ] 3.6 Green on the real tree: re-run the 1.7 check, which turns from red to green.
  - Input: repo after 3.2 and 3.4.
  - Trigger: run the scan.
  - Observable: 0 offenders.

  Exemplar: `secure-context-scan.test.ts`. Verify `npx vitest run packages/client/src/components/connectivity/__tests__/secure-context-scan.test.ts` is green.

## 4. Docs + closeout

- [ ] 4.1 Update DOX rows with `See change: audit-plugin-bundles-non-secure-context`:
  - `packages/dashboard-plugin-runtime/src/AGENTS.md` (`secure-context.ts` and its test);
  - `packages/client/src/lib/util/AGENTS.md` (`random-uuid.ts` and `clipboard.ts` are now re-exports);
  - `packages/kb-plugin/src/client/AGENTS.md` (KbTestSearch);
  - `packages/gmail-plugin/src/client/AGENTS.md` (GmailSettings);
  - `packages/client/src/components/connectivity/AGENTS.md` (scan-test row: manifest-derived roots, four APIs).

  Also add the helpers, with the runtime version that first carries them, under a new subsection of `## Import paths` in `packages/dashboard-plugin-runtime/README.md`. Verify `grep -rln audit-plugin-bundles-non-secure-context packages --include=AGENTS.md` lists all five (existence only; `review-code` checks row content).
- [ ] 4.2 Run the full suite, `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, and confirm it is green. Then run a `review-code` pass on the diff before commit.
- [ ] 4.3 Post-merge handoff, deferred (test-plan: manual-only, #X2). Add a line to `openspec/changes/add-voice-assistant-dashboard-plugin/tasks.md` (or to the first change that adds a `navigator.mediaDevices` caller) requiring a capability check, an allowlist entry and a "reports unavailable, no throw" test. Verify: that tasks.md line exists.
