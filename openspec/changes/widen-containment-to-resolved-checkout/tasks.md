# Tasks — widen-containment-to-resolved-checkout

STUB. Design gate first — no code until 1.1–1.3 are done.

## 1. Design gate

- [ ] 1.1 Run `doubt-driven-review` on this proposal, specifically against the WIDENING. Change 1's cycle 2 already caught "a security widening wrongly asserted to be behaviour-preserving" in an earlier draft of this work.
- [ ] 1.2 Enumerate what becomes readable in each of the nine git states; confirm no state gains reach outside its own checkout. Include the outside-the-repository `core.worktree` case change 1 deliberately did not reject.
- [ ] 1.3 Write `design.md`, MODIFIED deltas for BOTH `file-read-containment` requirements (both currently mandate `dirname()`), and `test-plan.md`; fold the automated scenarios into this file.
- [ ] 1.4 Extend the design to `isAllowedCwd` (`packages/kb-plugin/src/server/kb-routes.ts`): bind `mainCheckout` to the repository before admission — re-resolve the claimed main checkout and require it to point back at the same common dir — so a repository-local `core.worktree` naming an unrelated KNOWN folder cannot admit an otherwise-unknown request `cwd`. Write the MODIFIED delta for `kb-plugin-cwd-guard`'s *Git-repo-main admission* requirement.
- [ ] 1.5 RE-TEST, do not re-assume, change 1's bounded-reach argument ("the store opens at the request's own `cwd`"): `reindexAll` follows a cwd-local `knowledge_base.json` whose `resolvedSources` need not stay under that cwd. Measure what an admitted cwd can actually reach before deciding the binding rule's strictness.

## 2. Implementation (blocked on the design gate)

- [ ] 2.1 Convert `path-containment.ts` to anchor on the resolver's `thisCheckout`, with tests over the nine states from `packages/shared/src/test-support/git-fixtures.ts`.
- [ ] 2.2 Implement the repository-binding rule in `isAllowedCwd`, with a route test proving a `core.worktree` aimed at an unrelated known folder is REJECTED, plus a positive control that an honest worktree of a known repo is still admitted.
