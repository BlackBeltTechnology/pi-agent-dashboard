## 1. Complete planning (blocked gates from plan-proposal)

- [ ] 1.1 Diagnose the subagent spawn path — `@propose-review-1` and `@propose-review-2` both returned empty on a two-word probe while the default model answered it; run the doctor skill before trusting any reviewer result
- [ ] 1.2 Run doubt-driven-review on proposal.md + design.md (ARTIFACT + CONTRACT only, no CLAIM); reconcile actionable findings before any code is written
- [ ] 1.3 Run scenario-design for this change to produce test-plan.md with a level + disposition per scenario
- [ ] 1.4 Fold every automated test-plan.md row into a task in section 11 and tag every manual-only row; the test tasks in section 11 are provisional until this fold happens

## 2. Server — init-status reports a per-artifact setup tally

- [ ] 2.1 Define the recommended-artifact list for project setup (AGENTS.md, .pi/settings.json, prompt files, openspec/, KB) in one shared constant
- [ ] 2.2 Replace `WorktreeInitStatus.configured?: boolean` with a per-artifact tally (present/total plus the missing names) in `packages/client/src/lib/git/git-api.ts`
- [ ] 2.3 Implement the tally in `GET /api/git/worktree/init-status` (`packages/server/src/routes/git-routes.ts`) as a stat of the known file list — no hashing infrastructure
- [ ] 2.4 Report whether the trusted hook hash still matches, reusing `hookDefHash` + `worktree-init-trust.ts`; do not conflate it with the setup tally
- [ ] 2.5 Reserve a `setupOutdated?: boolean` field that nothing emits yet (the follow-up drift-detection change fills it)
- [ ] 2.6 Keep the fail-open contract — an error still yields `hasHook: false` and must not fabricate a tally
- [ ] 2.7 Update `packages/server/src/__tests__/routes-git-worktree-init.test.ts` for the new response shape

## 3. Folder actions menu — host component and contribution API

- [ ] 3.1 Create the `FolderActionsMenu` component with the fixed host-owned group taxonomy: workspace, directory, create, open, maintenance
- [ ] 3.2 Render a group only when it holds at least one item, with a stable group order independent of contributor registration order
- [ ] 3.3 Implement the trigger with `aria-haspopup="menu"`, `aria-expanded` bound to open state, and items with `role="menuitem"`
- [ ] 3.4 Key open state per folder scope so one folder's menu never opens another's; stop click propagation so opening neither navigates nor toggles collapse
- [ ] 3.5 Add keyboard support — open, arrow navigation, Escape to close, focus return to the trigger
- [ ] 3.6 Render as a bottom sheet below the mobile breakpoint; a 13-item popover at 375px is unusable
- [ ] 3.7 Define the declarative contribution type `{ id, group, label, icon, badge, disabled, onSelect }` and register a `folder-actions-menu` slot in `packages/dashboard-plugin-runtime`
- [ ] 3.8 Expose the test id `folder-actions-menu-<cwd>` on the trigger

## 4. Status capsule

- [ ] 4.1 Create `FolderStatusCapsule` replacing the session-count label, `FolderNeedsYouPill`, and `FolderStatusRollup`
- [ ] 4.2 Implement severity ordering needs-you, error, working, idle, tinting only the leading segment and never the idle count
- [ ] 4.3 Make each non-idle segment a button with a distinct accessible label; keep the idle segment inert
- [ ] 4.4 Preserve the widget-bar exclusion from the needs-you count (carry over the `WidgetBarProbe` behaviour)
- [ ] 4.5 Render the capsule in both collapsed and expanded states — today's rollup is collapsed-only
- [ ] 4.6 Drop the idle segment first under horizontal pressure; never drop the leading alert segment
- [ ] 4.7 Expose test ids `folder-status-capsule-<cwd>` and `folder-capsule-seg-<kind>-<cwd>`
- [ ] 4.8 Delete `FolderStatusRollup` and `FolderNeedsYouPill` once nothing references them

## 5. Tier-0 call-to-action banner

- [ ] 5.1 Create the banner component with info, warning and error variants bound to `--severity-{info,warning,error}-{bg,fg,border}`; add no new colour tokens
- [ ] 5.2 Implement the truncation contract — flex row, `min-width:0` plus `overflow:hidden` on the text column, `display:block` with ellipsis on both headline and subline, `flex:none` on the action; the subline is unbounded and must never overlap the action
- [ ] 5.3 Render below the git-facts row and above the slot pill grid, consuming zero height when absent
- [ ] 5.4 Implement banner states: setup absent, setup incomplete with the tally and missing names, init hook available, init running, init failed, broken-session cleanup, and init-hook re-trust
- [ ] 5.5 Stack banners blocking-first (error before warning before info)
- [ ] 5.6 Gate the running-state spinner on `prefers-reduced-motion`
- [ ] 5.7 Expose test ids `folder-banner-<kind>-<cwd>`
- [ ] 5.8 Verify no optional-freshness state renders as a banner — template drift is a menu marker only

## 6. SessionList tier restructure

- [ ] 6.1 Replace the trailing icon cluster with the single `FolderActionsMenu` trigger
- [ ] 6.2 Move urgency sort, pin/unpin, directory settings and project setup into the directory group
- [ ] 6.3 Move add-to-workspace and remove-from-workspace into the workspace group, preserving the scope-keyed popover state and the `add-to-workspace-btn-<cwd>` test id
- [ ] 6.4 Delete the `mdiOpenInNew` button and the `folder-open-home-<cwd>` test id; add a hover underline to the folder leaf name so the row reads as a link
- [ ] 6.5 Reduce the git row to facts only — branch plus dirty count, no settings gear, no init or cleanup controls
- [ ] 6.6 Merge the `Commit` link into the dirty-count chip
- [ ] 6.7 Delete `FolderActionBar` once it holds no controls, rather than rendering it empty
- [ ] 6.8 Keep `min-h-[44px] md:min-h-0` on the header row (WCAG 2.5.5)

## 7. SessionCard

- [ ] 7.1 Remove the `renderAddToWorkspace` prop and its render-prop plumbing from `SessionCard.tsx`
- [ ] 7.2 Remove the session-card call site and the `session:<id>` popover scope from `SessionList.tsx`
- [ ] 7.3 Confirm no session card renders an add-to-workspace control on desktop or mobile

## 8. Plugin contract migration

- [ ] 8.1 Remove `actions?: ReactNode` from `packages/dashboard-plugin-runtime/src/SlotPill.tsx` so a pill is one click target and nothing else
- [ ] 8.2 Migrate `FolderKbSection` — contribute a maintenance-group reindex item carrying the stale count as a badge, covering the index-now, reindex and retry states
- [ ] 8.3 Migrate `FolderGoalsSection` — contribute a create-group new-goal item; drop its refresh button
- [ ] 8.4 Migrate `FolderAutomationSection` — contribute a create-group new-automation item; drop its refresh button
- [ ] 8.5 Migrate `FolderOpenSpecSection` — contribute open-group archive and specs items with slot-qualified labels; drop its refresh button
- [ ] 8.6 Add one folder-level refresh item that refetches every slot for the directory, replacing the four per-slot refreshes
- [ ] 8.7 Verify the KB reindex stays a distinct item and is not folded into the generic refresh
- [ ] 8.8 Update `packages/dashboard-plugin-skill` templates and scaffolding that reference the removed actions prop
- [ ] 8.9 Update the plugin authoring docs for the new contribution API and note the breaking change

## 9. Icons

- [ ] 9.1 Switch project setup from `mdiFolderPlusOutline` to `mdiTextBoxCheckOutline` in `ProjectInitButton`
- [ ] 9.2 Switch the init hook from `mdiCogPlayOutline` to `mdiScriptTextPlayOutline` in `WorktreeInitButton`
- [ ] 9.3 Re-run the glyph audit across the rendered card and confirm no glyph carries two meanings — `mdiRefresh` must no longer appear four times, `mdiPlus` no longer twice
- [ ] 9.4 Confirm `mdiViewGridPlus` is used only for add-to-workspace

## 10. Docs

- [ ] 10.1 Delegate the `docs/` prose updates to DocScribe in caveman style and apply the returned tree rows
- [ ] 10.2 Update the directory `AGENTS.md` rows for every added, changed and deleted file in `packages/client`, `packages/dashboard-plugin-runtime`, `packages/kb-plugin`, `packages/goal-plugin`, `packages/automation-plugin`, `packages/server`
- [ ] 10.3 Run `kb dox lint` and fix any stale, missing or over-threshold rows the change introduced

## 11. Tests (provisional until task 1.4 folds test-plan.md)

- [ ] 11.1 Unit — status capsule severity ordering, needs-you above error, only the leading segment tinted, idle never tinted; see a sibling test in `packages/client/src/components/__tests__/`
- [ ] 11.2 Unit — capsule renders identically collapsed and expanded; input a folder with blocked plus working children, trigger both collapse states, observe identical segments
- [ ] 11.3 Unit — capsule segment activation targets the right session; input a capsule with needs-you and working segments, trigger the working segment, observe the first working session focused
- [ ] 11.4 Unit — banner truncation; input an overlong subline in a narrow container, trigger render, observe the action control fully visible and the subline ellipsised
- [ ] 11.5 Unit — banner absent for a healthy folder and for the template-outdated state; observe zero banner nodes
- [ ] 11.6 Unit — banner stacking order error before warning before info
- [ ] 11.7 Unit — setup tally states: none present, partial, all present; observe banner presence plus the menu item tally in each
- [ ] 11.8 Unit — slot pills expose no action buttons; extend `packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`, `packages/goal-plugin/src/__tests__/FolderGoalsSection.test.tsx`, `packages/automation-plugin/src/__tests__/FolderAutomationSection.test.tsx`, `packages/client/src/components/__tests__/FolderOpenSpecSection.test.tsx`
- [ ] 11.9 Unit — one refresh item covers every slot; observe exactly one refresh item with four slots present
- [ ] 11.10 Unit — menu group order stable across contributor registration orders; empty groups omitted
- [ ] 11.11 Unit — menu a11y: `aria-haspopup`, `aria-expanded` toggling, `role="menuitem"`, Escape closes and returns focus
- [ ] 11.12 Unit — update `packages/client/src/components/__tests__/SessionList.test.tsx` add-to-workspace block for the menu-open prerequisite
- [ ] 11.13 Unit — `packages/client/src/components/__tests__/FolderActionBar.test.tsx` removed or rewritten once the component is deleted
- [ ] 11.14 E2E — update `tests/e2e/folder-membership-drag.spec.ts` lines 151, 171 and 194 to open the actions menu before clicking `add-to-workspace-btn-<cwd>`
- [ ] 11.15 E2E — sidebar navigation to the directory home page via the header row now that `folder-open-home-<cwd>` is gone; see an existing spec for harness glue
- [ ] 11.16 Server — init-status returns the per-artifact tally for none, partial and complete directories, and fails open on error
- [ ] 11.17 Visual — verify both themes at 375, 768 and 1440 per the frontend-mockup-loop rubric, using isolated verification on non-8000 ports

## 12. Verification

- [ ] 12.1 `npm test` green; pipe once to a tmp file and grep rather than re-running
- [ ] 12.2 `npm run quality:changed` clean
- [ ] 12.3 `openspec validate reorganize-folder-card-header --strict` passes
- [ ] 12.4 Confirm no new colour token was added — banner and capsule resolve only existing `--severity-*` and `--status-*` tokens
- [ ] 12.5 Re-check the three open design questions before archiving: banner placement drift when a directory has no git row, pin discoverability behind the menu, and the clickable dirty-count chip beside an inert idle segment
