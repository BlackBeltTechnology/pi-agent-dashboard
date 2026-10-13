## Why

Two PRs shipped visible UI without a mockup or a contract check: #848 (`add-passkey-user-auth`: Users section, invite QR, passkey impact note) and #867 (`stabilize-mdns-server-identity`: server selector, known servers, network discovery). `ui-contract.md:66` forbids Tailwind palette classes. The three connectivity files touched by #867 carry 46 of them (`ServerSelector.tsx` 17, `NetworkDiscoverySection.tsx` 17, `KnownServersSection.tsx` 12; whole-file counts, older code included) and zero `data-testid`s. `theme-token-guard` passes because it checks CSS variables only, not palette classes. This change is first of four retro UX reviews (Oct 2026 PR sweep) and owns the shared capture harness the other three reuse.

## What Changes

- Mockup loop on develop, before the worktree (preserve mode, `frontend-mockup-loop-dashboard`): an as-built replica plus a proposed version for every state of each surface, in Base dark, Base light and one other palette, at 375/768/1440. Output: `mockups/audit.md`, `mockups/ui-plan.md`, `mockups/*.html`. User approval gates the rest.
- Approved redesign decisions are folded into `specs/` and `tasks.md` via `openspec-update-change` before `plan-proposal` runs doubt-review and scenario-design.
- Mockup: `mockups/identity-connectivity.html` (in this change), approved with all 8 decisions. Measured on the board: as-built replica 451 contrast/size failures across three themes, proposed 0 (`mockups/audit.md`). Approved deltas: server selector as an APG menu button with inline blocked reasons; a "Verified" pill for identity-pinned servers; two-click server removal; surfaced load and remove failures; severity status pills for users; collapsed mDNS diagnostic.
- Shared capture harness (reused by `retro-ux-plugin-settings-forms`, `retro-ux-chat-rendering`, `retro-ux-model-selector`): a Playwright helper that seeds edge states with `page.route` fixtures, writes screenshots into the change's `mockups/after/`, and runs the `computed-contrast` probes.
- Contract conformance on the in-scope surfaces: palette classes and raw colour literals replaced by tokens or semantic families; keyboard reach and accessible names on every control; state not carried by colour alone.
- Protected and never changed: routes, nav and section labels, form field names, keyboard shortcuts, existing i18n keys, existing `data-testid`s (`UsersSection.tsx`, the `testId` passed to `PasskeyImpactNote`), and the selector's `data-unreachable`/`data-denied`/`data-cors-blocked`/`data-name-not-resolved` attributes. New strings get new i18n keys. New `data-testid`s are added where E2E needs them; none are renamed or removed.
- Spec semantics: the selector's blocked-entry rendering (`disabled` attribute and reduced opacity), one-click server removal, the always-expanded mDNS diagnostic, the "red message" scan error and the in-entry move Update action are specified today, so they change through MODIFIED deltas of `server-selector` and `known-servers`.

## Capabilities

### New Capabilities
- `ui-state-capture`: an opt-in Playwright harness that seeds named UI states with fixtures and captures them per theme and viewport into a change's mockups folder, together with contrast, size and focus probe results.

### Modified Capabilities
- `passkey-user-auth`: the Users section and its invite and impact surfaces conform to the UI contract and expose every state accessibly.
- `server-selector`: the selector conforms to the UI contract; availability is not shown by colour alone.
- `known-servers`: the known-servers and network-discovery sections conform to the UI contract and are keyboard-operable.

## Impact

- Client: `packages/client/src/components/connectivity/{UsersSection,PasskeyImpactNote,ServerSelector,KnownServersSection,NetworkDiscoverySection}.tsx`. Styling and markup only, no protocol or REST change.
- Tests: new `tests/e2e/helpers/ui-capture.ts`, `tests/e2e/fixtures/retro-ux/`, and `tests/e2e/retro-ux-identity-connectivity.spec.ts`. They reuse `helpers/computed-contrast.ts` and `helpers/evidence-path.ts`.
- Rollback: a revert restores the previous styling; there is no data or config migration.

## Non-goals

- New identity or discovery behaviour, and new REST routes.
- Extending `theme-token-guard` to palette classes. That is a separate follow-up because it touches every package.
- Add-ons page (#875/#876): handled by `addons-hub-folder-view`.

## Discipline Skills

- `review-code`: before commit, because many styling edits across five components could regress.
- `doubt-driven-review`: on the approved redesign before it is folded into specs, because changes to the visual contract are hard to reverse once E2E baselines exist.
- No `security-hardening`. Auth surfaces are restyled only; ceremony, routes and tiers are unchanged.
