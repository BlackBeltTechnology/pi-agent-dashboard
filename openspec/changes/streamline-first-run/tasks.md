## 1. Server: project quick-create

- [ ] 1.1 Test E1, fresh home creates root and child (test-plan #E1). Exemplar `packages/server/src/__tests__/browse-endpoint.test.ts` (`describe("createDirectory")`, temp dir lifecycle). Input: temp HOME with no `Projects`. Trigger: `createProjectDirectory("my-first-project", home)`. Observable: both dirs exist; returns `{ path: realpath(child), existed: false }`.
- [ ] 1.2 Test E2, root present (test-plan #E2). Exemplar `browse-endpoint.test.ts`. Input: `<home>/Projects/` exists without `demo`. Trigger: create `"demo"`. Observable: dir created, `existed: false`.
- [ ] 1.3 Test E3, reuse keeps contents (test-plan #E3). Exemplar `browse-endpoint.test.ts`. Input: `<home>/Projects/demo/a.txt`. Trigger: create `"demo"`. Observable: `existed: true`; `a.txt` content and mtime unchanged.
- [ ] 1.4 Test E4, file at target (test-plan #E4). Exemplar `browse-endpoint.test.ts`. Input: `<home>/Projects/demo` is a file. Trigger: create `"demo"`. Observable: `reason: "not_a_directory"`; file bytes unchanged.
- [ ] 1.5 Test E5, file at root (test-plan #E5). Exemplar `browse-endpoint.test.ts`. Input: `<home>/Projects` is a file. Trigger: create `"demo"`. Observable: `reason: "root_not_a_directory"`; nothing created under home.
- [ ] 1.6 Test E6, portable-name decision table (test-plan #E6). Exemplar `browse-endpoint.test.ts` (`validateMkdirName` cases). Input: the 25 names listed in E6. Trigger: create each. Observable: `reason` is `invalid_name` or `reserved_name`; `readdir(home)` is identical before and after.
- [ ] 1.7 Test E7, 255-byte boundary (test-plan #E7). Exemplar `browse-endpoint.test.ts`. Input: 254/255/256-byte ASCII names, `"é"×127`, `"é"×128`. Trigger: create each. Observable: ≤255 B created; 256 B → `reason: "too_long"` and nothing created.
- [ ] 1.8 Test E9, symlink child escaping the root (test-plan #E9). Exemplar `browse-endpoint.test.ts`. Input: `<home>/Projects/demo → <tmp>/outside/`. Trigger: create `"demo"`. Observable: `reason: "outside_root"`; the link and its target are unchanged.
- [ ] 1.9 Test E10, symlink child equal to the root (test-plan #E10). Exemplar `browse-endpoint.test.ts`. Input: `demo → <home>/Projects`. Trigger: create `"demo"`. Observable: `reason: "outside_root"`.
- [ ] 1.10 Test E11, symlink child inside the root is reused (test-plan #E11). Exemplar `browse-endpoint.test.ts`. Input: `demo → <home>/Projects/real-demo/`. Trigger: create `"demo"`. Observable: `{ path: realpath(real-demo), existed: true }`.
- [ ] 1.11 Test E12, symlinked root (test-plan #E12). Exemplar `browse-endpoint.test.ts`. Input: `<home>/Projects → <tmp>/data/`. Trigger: create `"demo"`. Observable: `<tmp>/data/demo` exists and `path` is its realpath.
- [ ] 1.12 Test E13, dangling child link (test-plan #E13). Exemplar `browse-endpoint.test.ts`. Input: `demo → <tmp>/missing`. Trigger: create `"demo"`. Observable: `reason: "not_a_directory"`; `<tmp>/missing` is still absent.
- [ ] 1.13 Test E14, dangling root link (test-plan #E14). Exemplar `browse-endpoint.test.ts`. Input: `<home>/Projects → <tmp>/missing`. Trigger: create `"demo"`. Observable: `reason: "root_not_a_directory"`; nothing created.
- [ ] 1.14 Test E15, home missing (test-plan #E15). Exemplar `browse-endpoint.test.ts`. Input: `homeDir` points to a non-existent path. Trigger: create `"demo"`. Observable: `reason: "home_missing"`; `homeDir` is still absent.
- [ ] 1.15 Test X3, unexpected fs error (test-plan #X3). Exemplar `browse-endpoint.test.ts`. Input: POSIX root with mode `0500`. Trigger: create `"demo"`. Observable: `reason: "fs_error"`, no `demo` entry, `{success:false,error,reason}` envelope. Skip on win32.
- [ ] 1.16 Test X4, escape detected after creation (test-plan #X4). Exemplar `browse-endpoint.test.ts`. Input: `fs.promises.realpath` stubbed to return `/elsewhere/demo` for the target after a real `mkdir`. Trigger: create `"demo"`. Observable: `reason: "outside_root"`; the created dir is removed; a pre-existing link at that name is never removed.
- [ ] 1.17 Verify 1.1–1.16 fail. Then implement `createProjectDirectory` in `packages/server/src/browse.ts` per design D4 (gate, portable validator, home check, non-recursive root mkdir, realpath containment with lstat-guarded cleanup, reason codes). Verify 1.1–1.16 pass.
- [ ] 1.18 Test E8, non-string name through the route (test-plan #E8). Exemplar: fastify inject as in `packages/server/src/__tests__/route-tier-gate.test.ts`, temp HOME as in `browse-endpoint.test.ts`. Input: bodies `{}`, `{name:42}`, `{name:null}`. Trigger: POST `/api/browse/create-project`. Observable: 400 `{success:false, reason:"invalid_name"}`; zero fs calls; log contains `name=<non-string>`, no throw.
- [ ] 1.19 Test E16, tier and MCP completeness (test-plan #E16). Exemplars `packages/server/src/__tests__/route-tier-gate.test.ts` and `packages/server/src/__tests__/mcp-manifest-completeness.test.ts`. Input: `ROUTE_TIERS`, manifest and denylist. Trigger: run both. Observable: the route resolves to `control`, is denylisted, and no generated tool name contains `create_project`.
- [ ] 1.20 Test E17, insufficient tier (test-plan #E17). Exemplar `route-tier-gate.test.ts`. Input: a credential below `control`. Trigger: POST create-project. Observable: rejected by the tier gate; temp HOME `readdir` unchanged.
- [ ] 1.21 Test E18, network guard (test-plan #E18). Exemplar `route-tier-gate.test.ts` (guarded inject). Input: a request the guard rejects. Trigger: POST create-project. Observable: rejected; no dir created.
- [ ] 1.22 Verify 1.18–1.21 fail. Then:
  - add `CreateProjectRequest`, `CreateProjectResult` and `CreateProjectErrorReason` to `packages/shared/src/rest-api.ts`;
  - add the `ROUTE_TIERS` row (`control`) to `packages/shared/src/route-tiers.ts`;
  - add the `tools.denylist.ts` entry;
  - register the route in `packages/server/src/routes/file-routes.ts` behind `networkGuard`, with the reason→status map and the D4 log line.

  Verify 1.18–1.21 pass.

## 2. Client: queue accessor, probe derivation, auto-install store

- [ ] 2.1 Test E19, probe vetoes (test-plan #E19). Exemplar `packages/client/src/lib/__tests__/package-queue.test.ts` (`__resetForTests`, mocked fetch). Input: health peer `{ok:false, reason:"import failed: x"}`, then `{ok:true}`; recommended `activeInPi:false`. Trigger: `ensureInstall("sign-in")`. Observable: zero enqueues; store `null`.
- [ ] 2.2 Test E20, fail-open (test-plan #E20). Exemplar `package-queue.test.ts`. Input: recommended 500, network error, or no entry. Trigger: `ensureInstall`. Observable: zero enqueues; store `null`; no escaping throw.
- [ ] 2.3 Test E21, already active (test-plan #E21). Exemplar `package-queue.test.ts`. Input: `activeInPi:true` (with no probe, and with a stale `ok:false` probe). Trigger: `ensureInstall`. Observable: zero enqueues; store `null`.
- [ ] 2.4 Test E22, follow a pending install (test-plan #E22). Exemplar `package-queue.test.ts`. Input: another caller's `install` of the peer source running. Trigger: `ensureInstall`. Observable: enqueue count stays 1; store `running`, then `installed` on that op's success.
- [ ] 2.5 Test E23, pending remove not followed (test-plan #E23). Exemplar `package-queue.test.ts`. Input: `remove` of the peer source pending, `activeInPi:false`. Trigger: `ensureInstall`. Observable: one install op `{constant source, "install", "global"}` queued; the remove's success does not latch.
- [ ] 2.6 Test E24, constants only (test-plan #E24). Exemplar `package-queue.test.ts`. Input: no `lastProbe`; `activeInPi:false`; bodies with `source:"npm:evil"` and `installed.scope:"local"`. Trigger: `ensureInstall`. Observable: exactly one enqueue with the constant source, `install`, `global`.
- [ ] 2.7 Test E27, a newer decision is not clobbered (test-plan #E27). Exemplar `package-queue.test.ts`. Input: decision #1 pending; reset; decision #2 started. Trigger: #1's fetch rejects. Observable: #2 issues its own fetches, and its state is untouched by #1's rejection.
- [ ] 2.8 Test F1, outcome survives unmount (test-plan #F1). Exemplar `package-queue.test.ts` (fake timers). Input: store `running` on its own install, no subscriber mounted. Trigger: op succeeds; advance 3 500 ms. Observable: store `installed`.
- [ ] 2.9 Test F2, failed latch (test-plan #F2). Exemplar `package-queue.test.ts`. Input: store `running`. Trigger: op errors with `"npm ERR! ENOTFOUND"`. Observable: store `failed` carrying that message.
- [ ] 2.10 Test F3, recovery vs remove (test-plan #F3). Exemplar `package-queue.test.ts`. Input: store `failed`. Trigger: (a) another surface's install succeeds; (b) a remove succeeds instead. Observable: (a) `installed`; (b) stays `failed`.
- [ ] 2.11 Test X1, bounded decision (test-plan #X1). Exemplar `package-queue.test.ts` (fake timers). Input: recommended never responds. Trigger: `ensureInstall`; advance 20 001 ms. Observable: store `null`, zero enqueues, no unhandled rejection.
- [ ] 2.12 Test X2, retry (test-plan #X2). Exemplar `package-queue.test.ts`. Input: the install failed. Trigger: `retry()`, then `retry()` again while that install is pending. Observable: `running` → `installed`; the second retry enqueues nothing.
- [ ] 2.13 Verify 2.1–2.12 fail. Then implement, per design D2/D3:
  - `packageQueue.getSourceOp(source)` plus the action of the last terminal op per source (`packages/client/src/lib/package/package-queue.ts`);
  - shared `derivePeerState` (legacy key only), extracted from `useAnthropicPeerProbe.ts`, with additive `peerResolving` and `importFailed` on the hook;
  - `packages/client/src/lib/package/peer-auto-install-store.ts` (`ensureInstall`, `retry`, `reset`, module-level queue subscription, seq guard, 20 s `AbortSignal.timeout`).

  Verify 2.1–2.12 pass and the existing `package-queue.test.ts` / probe tests stay green.
- [ ] 2.14 Test F4, tri-state reset (test-plan #F4). Exemplar `packages/client/src/hooks/__tests__/useProvidersReady.test.ts`. Input: store `running`; `anthropicAuthenticated` goes `true → unknown (status 500) → true`, then `true → false`. Trigger: the App-level reset effect runs; then the op succeeds. Observable: unchanged after `unknown`; `null` after `false`; the late success leaves it `null`.
- [ ] 2.15 Verify 2.14 fails. Then add the additive tri-state `anthropicAuthenticated` to `packages/client/src/hooks/useProvidersReady.ts` and the App-level reset effect (`packages/client/src/App.tsx`). Verify 2.14 passes and the existing `useProvidersReady.test.ts` stays green.

## 3. Client: Anthropic provider row

- [ ] 3.1 Test E25, trigger scope (test-plan #E25). Exemplar `packages/client/src/__tests__/ProviderAuthSection.peer-hint.test.tsx`. Input: section mounted. Trigger: complete flows `anthropic`, `openai-codex`, `github-copilot`; save an `anthropic-api` key; save a custom endpoint; mount with `anthropic` connected. Observable: `ensureInstall` called exactly once, for the `anthropic` flow.
- [ ] 3.2 Test E26, sign-in is never blocked (test-plan #E26). Exemplar `ProviderAuthSection.peer-hint.test.tsx`. Input: recommended never resolves. Trigger: complete the `anthropic` flow. Observable: in the same tick the store is `deciding`, the dialog is closed and `provider-auth-event` is dispatched.
- [ ] 3.3 Test F5, clears on a resolving probe (test-plan #F5). Exemplar `ProviderAuthSection.peer-hint.test.tsx`. Input: store `installed`, then separately `failed`. Trigger: the probe poll returns `ok:true`. Observable: no `anthropic-peer-autoinstall`, no retry button.
- [ ] 3.4 Test F6, precedence decision table (test-plan #F6). Exemplar `ProviderAuthSection.peer-hint.test.tsx`. Input: probe {none, missing, import-failure} × store {null, running, installed, failed}. Trigger: render. Observable: exactly one surface per the D3b order; at most one install button.
- [ ] 3.5 Test F7, failed rendering (test-plan #F7). Exemplar `ProviderAuthSection.peer-hint.test.tsx`. Input: store `failed` with `"npm ERR! code E404"`. Trigger: render. Observable:
  - the first sentence is the generic retry copy;
  - the raw text is visible only after the `LogBlock` toggle;
  - Retry uses the secondary recipe and Sign Out is enabled;
  - the wrapper has `role="status"` and `aria-live="polite"`.
- [ ] 3.6 Test X7, row Retry (test-plan #X7). Exemplar `ProviderAuthSection.peer-hint.test.tsx`. Input: store `failed`. Trigger: click the row's Retry. Observable: row in-progress, then installed on op success.
- [ ] 3.7 Verify 3.1–3.6 fail. Then, in `packages/client/src/components/settings/ProviderAuthSection.tsx`:
  - add the one-line fire-and-forget `ensureInstall("sign-in")` in `finishFlow` for `id === "anthropic"` (design D1);
  - add the auto-install surface (`InlineMessage` + `LogBlock collapsible defaultOpen={false}`, secondary Retry, `role="status"` wrapper);
  - apply the D3b precedence over `AnthropicPeerHint`;
  - add i18n keys `providers.peerAutoInstall*`.

  Verify 3.1–3.6 pass and `ProviderAuthSection.peer-hint.test.tsx` stays green.

## 4. Client: Landing stepper, Step ② create, Step ① peer status

- [ ] 4.1 Test F8, stepper structure decision table (test-plan #F8). Exemplar `packages/client/src/components/__tests__/LandingPage.test.tsx`. Input: 8 combinations of creds × pinned × sessions. Trigger: render. Observable:
  - one `<ol>`;
  - `onboarding-progress` text reads "n of 3";
  - at most one primary button;
  - only the first pending step is expanded;
  - locked and later-pending rows contain no button or input;
  - when a folder is pinned before credentials, the Step ③ row names Step ①.

  Rewrite the existing disabled-locked-CTA assertions (`:69-70, 92-93`) as lock-text assertions.
- [ ] 4.2 Test F9, create success (test-plan #F9). Exemplar `LandingPage.test.tsx`. Input: step 2 pending; `onCreateProject` resolves `{path, existed:false}`. Trigger: click `onboarding-step-2-create`. Observable: called once with `"my-first-project"`. Separately, `onboarding-step-2-cta` calls `onOpenPinDialog`.
- [ ] 4.3 Test F10, in-flight (test-plan #F10). Exemplar `LandingPage.test.tsx`. Input: pending promise. Trigger: click Create twice. Observable: called once; field, Create and link disabled; Create has `aria-busy="true"` and reads "Creating…".
- [ ] 4.4 Test F11, error mapping (test-plan #F11). Exemplar `LandingPage.test.tsx`. Input: each reason code, `"xyz"`, and a Fastify 404 body. Trigger: submit `"my/project"`. Observable:
  - `onboarding-step-2-error` sits between the label and the input in DOM order;
  - per-reason copy, with generic copy for an unknown reason or the 404 body;
  - the input has `aria-invalid="true"` and keeps its value;
  - nothing is pinned.
- [ ] 4.5 Test F12, existed-note lifetime (test-plan #F12). Exemplar `LandingPage.test.tsx`. Input: create resolves `existed:true`. Trigger: render, unmount, remount. Observable: `onboarding-step-2-existed` is present after create and absent after remount.
- [ ] 4.6 Test F13, Step ① peer status decision table (test-plan #F13). Exemplar `LandingPage.test.tsx` plus `ProviderAuthSection.peer-hint.test.tsx` (health mocking). Input: probe × store × entry combinations. Trigger: render `Step1PeerStatus`. Observable: first-match content per spec rules 1–7, the `onboarding-step-1-peer-*` testids, and the secondary recipe on actions.
- [ ] 4.7 Test F14, manual Install path (test-plan #F14). Exemplar `LandingPage.test.tsx`. Input: manual Install shown; the next probe read reports an import failure (then, separately, a clean probe). Trigger: click `onboarding-step-1-peer-install`. Observable: no enqueue and the failed-to-load warning; with the clean probe, one global enqueue and the in-progress status.
- [ ] 4.8 Test X8, Landing Retry (test-plan #X8). Exemplar `LandingPage.test.tsx`. Input: store `failed`. Trigger: click `onboarding-step-1-peer-retry`. Observable: in-progress status, then no peer status after the install succeeds.
- [ ] 4.9 Test P1, request gating (test-plan #P1). Exemplar `LandingPage.test.tsx` (fetch spy). Input: step 1 pending; step 1 done with `anthropicAuthenticated` false, unknown and true. Trigger: render plus 1 s of fake timers. Observable: Landing fetches `/api/packages/recommended` and `/api/health` 0, 0, 0 and ≥1 times respectively.
- [ ] 4.10 Verify 4.1–4.9 fail. Then implement in `packages/client/src/components/shell/LandingPage.tsx`, per design D3c/D5/D6 and `mockups/index.html`:
  - the vertical stepper with first-pending expansion and the D6 marker tokens (removing the raw Tailwind colours);
  - the Step ② form with the reason→i18n map;
  - the `Step1PeerStatus` child, mounted only when Step ① is done and `anthropicAuthenticated === true`;
  - new props `onCreateProject`, `anthropicAuthenticated` and the store snapshot;
  - new i18n keys `landing.createProject*`, `landing.useExistingFolder`, `landing.progress`, `landing.peer*`.

  Verify 4.1–4.9 pass and `node scripts/theme-token-guard.mjs` reports no new violation.
- [ ] 4.11 Test F15, App wiring for `onCreateProject` (test-plan #F15). Exemplar `packages/client/src/hooks/__tests__/useProvidersReady.test.ts` (fetch mocking). Input: create-project returns `{path:"/real/x"}`, then separately a 409. Trigger: call the extracted `createProjectAndPin("x", { send, setPinned })` helper (`packages/client/src/lib/create-project.ts`). Observable: on success, `pin_directory` is sent once with `"/real/x"` and the pinned list is updated optimistically; on the 409, nothing is sent.
- [ ] 4.12 Verify 4.11 fails. Then implement `createProjectAndPin` and wire it into `renderLanding` in `packages/client/src/App.tsx`, along with `anthropicAuthenticated` and the store props. Verify 4.11 passes.

## 5. End-to-end (docker harness)

- [ ] 5.1 Test F16, create → pin → start against the real server (test-plan #F16). Exemplar `tests/e2e/directory-home.spec.ts` (harness port from `.pi-test-harness.json`, `tests/e2e/helpers/index.ts` testid map; add `onboardingStep2Create`). Input: fresh harness with credentials seeded and no pins. Trigger: fill `e2e-first`, click `onboarding-step-2-create`, then `onboarding-step-3-cta`. Observable: the sidebar shows `e2e-first`, Step ② is done, and a session's cwd ends with `/Projects/e2e-first`.
- [ ] 5.2 Test F17, server rejection rendered (test-plan #F17). Exemplar `tests/e2e/directory-home.spec.ts`. Input: fresh harness. Trigger: submit `a/b`. Observable: `onboarding-step-2-error` shows invalid-name guidance; the sidebar folder count is unchanged; `onboarding-step-2-cta` still opens `add-folders-dialog`.

## 6. Manual verification (post-merge)

- [ ] 6.1 Visual parity of the promoted Landing and provider row against `mockups/index.html` S1–S8, in base dark, base light and nord, in an isolated environment (non-8000 ports, temp HOME) (test-plan: manual-only, #F18).
- [ ] 6.2 VoiceOver announces "Installing…" and then the failure warning, once each and politely (test-plan: manual-only, #F19).
- [ ] 6.3 Real first run on a clean `~/.pi` with a Claude Pro/Max account, desktop and Electron: sign in, return to Landing, create a project, start a session, and confirm the first Claude tool call works with no manual install (test-plan: manual-only, #X5).
- [ ] 6.4 Windows 11: create `my-first-project`, then try `con` and a 250-character name; confirm the guidance appears and no stray folders are left (test-plan: manual-only, #X6).

## 7. Verification, docs, follow-ups

- [ ] 7.1 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary) and `npm run quality:changed`; verify both are green.
- [ ] 7.2 Update the DOX rows for every touched source file:
  - `browse.ts`, `file-routes.ts`, `route-tiers.ts`, `rest-api.ts`, `tools.denylist.ts`;
  - `package-queue.ts`, the new `peer-auto-install-store.ts`, `useAnthropicPeerProbe.ts`, `useProvidersReady.ts`;
  - `ProviderAuthSection.tsx`, `LandingPage.tsx`, the new `create-project.ts`, `App.tsx`.

  Delegate the `docs/` prose (first-run flow in `docs/user-features.md`, the peer FAQ entry in `docs/faq.md`) to DocScribe. Verify `git diff --stat` lists the AGENTS.md updates.
- [ ] 7.3 After merge, record follow-ups, without editing those changes from here: `add-persistent-onboarding-card` should render the stepper and the Step ② form; the `add-welcome-tutorial` chapter "Start your first project" should follow the new flow. Verify a note appears in each change's `README.md` or in the PR description.
