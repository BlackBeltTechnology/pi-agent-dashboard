## 1. Server: project quick-create

- [ ] 1.1 Write failing tests in `packages/server/src/__tests__/browse-endpoint.test.ts` for `createProjectDirectory(name, homeDir)`: fresh home (creates `Projects` + child, `existed:false`); root present; existing dir (`existed:true`, contents untouched); file at target throws `already exists`; invalid names (`../x`, `a/b`, `""`, `" x"`, `.`, `..`) throw `invalid name`. Verify they fail.
- [ ] 1.2 Implement `createProjectDirectory` in `packages/server/src/browse.ts` (reuse `validateMkdirName`, `fs.mkdir(..., { recursive: true })`, stat to distinguish dir/file) and verify 1.1 passes.
- [ ] 1.3 Add route tests (fastify inject) for `POST /api/browse/create-project`: 200 `{path, existed}`, 400 invalid/missing/non-string name, 409 file collision, and a guard-rejected request creates nothing. Verify they fail, then register the route in `packages/server/src/routes/file-routes.ts` behind `networkGuard`. It resolves the home dir via `os.homedir()`, logs the outcome as `[create-project] <created|reused|rejected> <reason>`, and must make the tests pass.

## 2. Client: Landing Step ② inline create

- [ ] 2.1 Extend `packages/client/src/components/__tests__/LandingPage.test.tsx`:
  - Stepper structure: one `<ol>`, exactly one primary button, "n of 3 done" text, locked steps show their "Needs …" reason, existing `onboarding-step-N-*` testids preserved.
  - New Step ② cases: default name rendered, Create (`onboarding-step-2-create`) calls `onCreateProject("my-first-project")`, in-flight disables Create, error renders between label and input with input preserved, the preview never shows a nested path for an invalid name, `existed:true` notice, `onboarding-step-2-cta` ("Use an existing folder…") calls `onOpenPinDialog`, locked state disables field, button and link.
  - Update the first-run title assertion.
  - Verify the new cases fail.
- [ ] 2.2 Re-lay out `LandingPage.tsx` as the vertical stepper from `mockups/index.html` (design D6) and implement the Step ② pending body (labelled input, Create, link-style secondary action, inline error and notice). Add the new `onCreateProject: (name) => Promise<{ path: string; existed: boolean }>` prop. Use ui-contract recipes and theme tokens only, and add i18n keys (`landing.createProject*`, `landing.useExistingFolder`, `landing.progress`). Verify 2.1 passes and `node scripts/theme-token-guard.mjs` reports no new violation.
- [ ] 2.3 Wire `onCreateProject` in `App.tsx` `renderLanding`: POST the endpoint, then do the same optimistic `setPinnedDirectories` + `send({ type: "pin_directory", path })` that `AddFoldersDialog.onPin` does. Verify with a test that the pin message is sent with the returned path and that a failure sends nothing.

## 3. Client: Anthropic peer auto-install

- [ ] 3.1 Write a failing truth-table test for a pure `decidePeerAutoInstall({ probe, installed })` covering all spec rows: probe ok, probe missing, import-failure reason, no probe + absent, no probe + either name present, list fetch failed. The function lives next to the existing probe helper used by `AnthropicPeerHint`.
- [ ] 3.2 Implement `decidePeerAutoInstall` and verify 3.1 passes.
- [ ] 3.2a Write failing tests for `peerAutoInstallStore` covering the `attempted` guard, `running → installed|failed` latching off queue status (surviving the 3 s success clear), retry resetting to `running`, and subscribe/notify. Implement it in `packages/client/src/lib/package/` (D3) and verify the tests pass.
- [ ] 3.3 Write failing tests for `useAnthropicPeerAutoInstall` in `packages/client/src/__tests__/ProviderAuthSection.peer-autoinstall.test.tsx`:
  - An `anthropic` subscription sign-in completion enqueues exactly one global install of the constant source.
  - Other providers, API-key saves and page load with an already-connected row enqueue nothing.
  - The row shows the in-progress message, then the persistent installed message (past the queue's 3 s clear) or the error with the manual affordance, all with no probe present.
  - Sign Out stays enabled throughout.
- [ ] 3.4 Implement the hook and its trigger at the `anthropic` OAuth completion point in `ProviderAuthSection.tsx`: the same success branch that dispatches `provider-auth-event`, including completion after the dialog has closed. It uses `usePackageOperations().install` with a module-constant source and `scope: "global"`, reuses the hint latch copy and styling, and leaves the hint's `peerMissing` derivation unchanged. Add a `console.info("[peer-autoinstall] <enqueued|skipped> <reason>")`. Verify 3.3 passes and the existing `ProviderAuthSection.peer-hint.test.tsx` still passes unchanged.

- [ ] 3.5 Write failing tests for the Landing Step ① done-row status: it renders nothing when the store has no `attempted`; shows in-progress with `role="status"` while `running`; shows nothing after `installed`; on `failed` shows the D7 warning (plain sentence first, raw text only inside a closed `<details>`); Retry re-enqueues; Step ② stays usable throughout. Implement it by reading `peerAutoInstallStore` in `LandingPage` (prop-free via the store hook) and verify the tests pass.

## 4. Verification and docs

- [ ] 4.1 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and `npm run quality:changed`, and verify both are green.
- [ ] 4.1a Visual parity: in an isolated env (non-8000 ports, temp HOME), compare the promoted Landing and provider row against `mockups/index.html` scenarios S1–S7 in base dark, base light and nord. Run `mockups/audit.js`-equivalent contrast (or axe) on the real page and verify there are 0 AA failures.
- [ ] 4.2 Manual first-run check against an empty fixture HOME (docker test harness or a temp `HOME`):
  - Landing shows ① pending and ② locked.
  - Anthropic sign-in auto-installs the peer with visible progress.
  - Create pins `~/Projects/my-first-project`.
  - ③ spawns a session there.
  - The first Claude tool call works.
- [ ] 4.3 Update DOX rows for each touched file: `browse.ts`, `file-routes.ts`, `LandingPage.tsx.AGENTS.md`, `ProviderAuthSection.tsx.AGENTS.md` (AnthropicPeerHint section), and the new hook's directory `AGENTS.md`. Delegate the `docs/` prose (the first-run flow in `docs/user-features.md` and the `docs/faq.md` peer entry) to DocScribe.
- [ ] 4.4 Update `openspec/changes/add-persistent-onboarding-card/proposal.md` (and its design and tasks where they reference Step ②'s CTA) so the card's Step ② uses the inline create form or deep-links to it. Also update the `add-welcome-tutorial` "Start your first project" chapter description. Verify with `openspec validate add-persistent-onboarding-card` and `openspec validate add-welcome-tutorial`.
