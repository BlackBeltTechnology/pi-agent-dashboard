# Tasks — add-folder-action-banner (D4 · D5 · D6 · D7)

## 1. Ground truth

- [ ] 1.1 Enumerate every current call-to-action render site on the directory card: `ProjectInitButton.tsx`, `WorktreeInitButton.tsx`, the `WorktreeInitChip`, and `Clean up broken (N)` in `FolderActionBar.tsx` / `SessionList.tsx`. Record the git-row wrapping exception comment in `SessionList.tsx`.
- [ ] 1.2 Read `useInitStatus.ts` and the server init-status endpoint; record the exact shape of `WorktreeInitStatus` and every consumer of `configured`.
- [ ] 1.3 Read `worktree-init-trust.ts`; confirm `hookDefHash` semantics (TOFU key `repoRoot + hash`, trust revoked on change) so the banner does not conflate trust with staleness.
- [ ] 1.4 Confirm the required set is exactly `.pi/settings.json` (design D-A) and that the artifact list's other entries are all optional. A wrong "required" turns a quiet, working folder into a permanent banner — the failure this decision exists to prevent.
- [ ] 1.5 Confirm `FolderActionBar.tsx` holds nothing else after the init controls leave and cleanup moves to the menu (change 1 already moved the settings cog). Note `useInitStatus` currently lives INSIDE the bar — give the probe a new owner before deleting.
- [ ] 1.6 Read `resolveConfigRoot` (`git-operations.ts:843`): a git repo resolves to its MAIN path, so for a worktree row `configRoot !== cwd`. The checklist stats at `configRoot`, matching today's `configured`.
- [ ] 1.7 Enumerate every importer of `FolderActionBar`: `SessionList.tsx`, `FolderActionBar.test.tsx`, `FolderActionBar-cleanup-broken.test.tsx`, and `packages/client/src/__tests__/state-feedback-adoption.test.tsx` (hardcodes the path string).
- [ ] 1.8 Enumerate the glyphs the RENDERED card shows, and verify `mdiTextBoxCheckOutline` / `mdiScriptTextPlayOutline` / `mdiAlertCircleOutline` / `mdiBroom` collide with none of them. `mdiAlertCircleOutline` is high-collision — do not assume.
- [ ] 1.9 Confirm the client can identify a project-root row (git root, pinned, or workspace-added) from data the folder list already holds — the banner gate is client-side and must not need a new payload field.

## 2. Tests first (red) — folded from test-plan.md

Author these before the implementation in sections 3-5 and verify each fails. Every row below maps to exactly one manifest scenario.

### 2a. Server checklist — L1, extend the init-status route tests (see the existing `init-status` describe block in the git-routes test file for harness glue)

- [ ] 2.1 Checklist replaces the boolean: directory with `openspec/` present and `AGENTS.md` absent · init-status probed · checklist reports `openspec` present and `agents` absent, not collapsed to `configured:false` (test-plan #E1)
- [ ] 2.2 Exactly one required artifact: the five-entry artifact set · checklist built · exactly one entry, `settings`, carries `required:true` (test-plan #E2)
- [ ] 2.3 Config-root resolution: git worktree whose own dir lacks `.pi/settings.json` while the main checkout has it · init-status probed for the worktree · `settings` reported present (test-plan #E3)
- [ ] 2.4 Hook-declaring repo still reports setup: directory whose config root declares a `worktreeInit` hook · init-status probed · response carries the checklist alongside the hook fields (test-plan #E4)
- [ ] 2.5 Probe failure fails open: the artifact probe throws · init-status returned · the checklist field is omitted; no artifact reported absent (test-plan #X1)
- [ ] 2.6 Cache invalidation after a scaffold: cached checklist reporting `.pi/settings.json` absent · a project-init session completes in that directory · next probe reports it present and does not serve the stale entry (test-plan #X4)

### 2b. Banner logic — L1, new `packages/client/src/components/folder/__tests__/FolderActionBanner.test.tsx`

- [ ] 2.7 Required-only gating: `.pi/settings.json` present with `AGENTS.md` and `openspec/` absent · card renders · no banner; menu tally reports `3/5` (test-plan #E5)
- [ ] 2.8 Not-a-pi-project state: `.pi/settings.json` absent · card renders · banner reads "Not a pi project yet" at info severity with a `Set up →` action (test-plan #E6)
- [ ] 2.9 Fully configured is quiet: every artifact present · card renders · no setup banner (test-plan #E7)
- [ ] 2.10 One banner max by ladder: directory with BOTH a failed init run and a revoked hook trust · card renders · exactly one banner, the init-failure one (test-plan #E8)
- [ ] 2.11 Project-root gate: row for a non-git directory never pinned or workspace-added · card renders · no "not a pi project" banner (test-plan #E11)
- [ ] 2.12 Drift never banners: payload with `setupOutdated:true` and all artifacts present · card renders · no banner (test-plan #E15)
- [ ] 2.13 Severity tokens only: banner rendered at info, warning and error · card renders · every colour resolves from an existing `--severity-*` triple and this change adds no custom property (test-plan #E16)
- [ ] 2.14 Glyph distinctness: a card rendering the folder glyph, the menu trigger and a setup banner · card renders · no two rendered glyphs are identical (test-plan #E17)
- [ ] 2.15 Absent checklist is not an absent project: response whose checklist field is absent — the client's own fail-open shape · card renders · no banner, and absence is not read as zero-present (test-plan #X2)
- [ ] 2.16 Checklist outranks the legacy boolean: transitional payload where `configured` and the checklist disagree · banner state derived · the checklist wins (test-plan #X3)
- [ ] 2.17 Stale client degrades to silence: payload the client cannot interpret · card renders · no banner (test-plan #X5)

### 2c. Menu items — L1, extend the folder-actions-menu tests

- [ ] 2.18 Cleanup lives in the menu: 3 broken sessions and no blocking init state · card renders · no banner, and the `DIRECTORY` group offers `folder-menu-cleanup-broken-<cwd>` naming 3 (test-plan #E9)
- [ ] 2.19 Cleanup hidden at zero: folder with 0 broken sessions · menu opens · no cleanup item (test-plan #E10)
- [ ] 2.20 Permanent setup item: directory whose checklist reports every artifact present · menu opens · `DIRECTORY` group contains `Project setup… 5/5` (test-plan #E12)
- [ ] 2.21 Update badge on the flag: synthetic payload with `setupOutdated:true` · menu opens · item carries a `● update` badge (test-plan #E13)
- [ ] 2.22 No badge by default: payload omitting `setupOutdated` · menu opens · no badge (test-plan #E14)

### 2d. Rendered behaviour — L3, extend the Playwright suite (copy harness glue from `tests/e2e/folder-membership-drag.spec.ts`; read the port from `.pi-test-harness.json` `dashboardPort`, never hardcode)

- [ ] 2.23 Placement with a git row: git-backed directory qualifying for a banner · card renders · banner sits below the git row and above the slot-pill grid (test-plan #F1)
- [ ] 2.24 Placement without a git row: non-git pinned directory qualifying for a banner · card renders · banner sits directly below the header row and above the slot pills (test-plan #F2)
- [ ] 2.25 Git row is facts-only: directory with a pending initialization · card renders · git row carries only branch/dirty affordances and the init control is inside the banner (test-plan #F3)
- [ ] 2.26 Banner clears after its own action: directory showing the setup banner · spawned project-init session reaches status `ended` having written `.pi/settings.json` · init-status re-probed and the banner converges to absent with no other user action (test-plan #F4)
- [ ] 2.27 Abandoned setup leaves the banner: directory showing the setup banner · spawned session reaches `ended` WITHOUT writing `.pi/settings.json` · re-probe fires and the banner remains (test-plan #F5)
- [ ] 2.28 Running swaps content in place: directory whose banner offers an init action · user starts the run from the banner · running state renders inside the same banner element and its position does not change (test-plan #F6)
- [ ] 2.29 Progress and failure live in the banner: init run in flight, then failing · run progresses then fails · progress and failure summary render inside `folder-banner-*-<cwd>`, a Retry action is present, the stderr tail stays behind an opt-in disclosure, and nothing auto-dismisses (test-plan #F7)
- [ ] 2.30 Trust revocation banners at warning: directory whose hook definition changed since last trusted · card renders · warning-severity banner with a `Review…` action opening the trust-confirm dialog (test-plan #F8)
- [ ] 2.31 Banner action neither collapses nor navigates: expanded folder header whose row navigates to the directory home · user activates the banner action · the action fires, the folder does not collapse, no navigation occurs (test-plan #F9)
- [ ] 2.32 Keyboard reachable: card rendering a banner · user tabs through the card · the banner action receives focus with a visible focus ring (test-plan #F10)
- [ ] 2.33 Polite, non-repeating announcement: card rendering an unchanged failure banner · the card re-renders and init-status is refetched · the live region announces once on appearance and not again while identity and message are unchanged (test-plan #F11)

- [ ] 2.34 Verify every test in section 2 fails before implementation begins.

## 3. Server: per-artifact checklist (D5)

- [ ] 3.1 Implement the `stat`-based checklist over the five pinned entries, resolved at `configRoot`, computed on every response. No hashing, no content inspection.
- [ ] 3.2 Give the checklist its own cache key (config root) and its own invalidation, NOT the gate's: `gateCache` is written only on the trusted-hook branch and invalidated only by `POST /api/git/worktree/init`, so a no-hook directory — the only kind that banners — would never be cached or invalidated. Invalidate after a project-init session completes in the directory.
- [ ] 3.3 Fail-open by **omitting** the checklist field; do not introduce a second null/sentinel encoding of "unknown".
- [ ] 3.4 Declare `setupOutdated?: boolean` in the shared type. Emit nothing (D7) — detection is a follow-up.
- [ ] 3.5 Keep emitting `configured?: boolean` (deprecated) alongside the checklist for the whole of this change, and migrate every consumer found in 1.2 to read the checklist first. Dropping the field is a FOLLOW-UP change — removing it here would make the transitional-precedence requirement describe a state that never ships.

## 4. Client: the banner (D4)

- [ ] 4.1 Implement `FolderActionBanner.tsx` with per-rung test ids `folder-banner-{setup,init-needed,retrust,failed,running}-<cwd>` and the action id `folder-banner-setup-action-<cwd>`.
- [ ] 4.2 Colours strictly from `--severity-{info,warning,error}-*`; glyphs per 1.8.
- [ ] 4.3 Move init progress/failure feedback into the banner, preserving elapsed time, muted last-log preview, opt-in disclosure, retry, and no auto-dismiss. Running swaps the banner's content in place rather than adding a rung.
- [ ] 4.4 Retain the spawned project-init session id and re-probe init-status when that session reaches `ended`, unconditional on its outcome.
- [ ] 4.5 Move `Clean up broken (N)` into the folder actions menu's existing `DIRECTORY` group — NOT the banner. Hidden when the count is zero.
- [ ] 4.6 Delete `FolderActionBar.tsx` and `ProjectInitButton.tsx` plus `FolderActionBar.test.tsx` and `FolderActionBar-cleanup-broken.test.tsx`; update `state-feedback-adoption.test.tsx`'s hardcoded path; re-host `WorktreeInitButton` inside the banner (it is NOT deleted — it owns the trust dialog and the run call); drop the git-row wrapping exception in `SessionList.tsx`.
- [ ] 4.7 Implement the permanent `Project setup…` menu item with its `n/N` tally and `● update` badge.

## 5. A11y + responsive

- [ ] 5.1 Banner is a named region; action is a real button with a visible focus ring and a 44px mobile target.
- [ ] 5.2 Failure announces via a **polite** live region, and announces on a change of banner identity/message only — not on every re-render or refetch.
- [ ] 5.3 Check vertical cost: render several unconfigured pinned folders and confirm the sidebar stays usable. If not, implement the `one banner + "+N more"` cap and record the decision.

## 6. Docs + verify

- [ ] 6.1 Update `packages/client/src/components/folder/AGENTS.md` (add banner row, remove `FolderActionBar.tsx` row + sidecar) and `packages/client/src/components/packages/AGENTS.md` (remove `ProjectInitButton.tsx` row + sidecar). Delegate any `docs/` prose to DocScribe.
- [ ] 6.2 Update `shouldShowWorktreeInitButton`'s doc comment — it states the export exists "so `FolderActionBar` can decide", a component this change deletes.
- [ ] 6.3 CHANGELOG: note the init-status payload change (`configured` → checklist) and the deprecation of `configured`.
- [ ] 6.4 `npm run quality:changed`; `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`; diff failures against the pre-change baseline — zero new.
- [ ] 6.5 `npx openspec validate --changes add-folder-action-banner --strict`.
- [ ] 6.6 Banner visual weight at tier 0: look at a sidebar with several directories, one unconfigured, and confirm the banner reads as urgent without swamping the card and that many banners do not make the sidebar unusable (test-plan: manual-only)
- [ ] 6.7 Run `doubt-driven-review` on the payload change before it stands, then `review-code` on the diff before commit.
