# Tasks — apply-checkout-root-to-worktree-ops

STUB. Design gate first — no code until 1.1–1.3 are done.

## 1. Design gate

- [ ] 1.1 Run `doubt-driven-review` on this proposal. Change 1's three cycles were spent on change 1's narrowed artifact, not this one.
- [ ] 1.2 Decide the fail-closed behaviour of `isMainWorktree` when `mainCheckout` is `null` (worktree of a bare hub), BEFORE converting any consumer — a delete boundary reading "this IS the main checkout" fails in the wrong direction.
- [ ] 1.3 Write `design.md`, the spec deltas (`git-operations-api`, `worktree-init-hook`) and `test-plan.md`; fold the automated scenarios into this file.
