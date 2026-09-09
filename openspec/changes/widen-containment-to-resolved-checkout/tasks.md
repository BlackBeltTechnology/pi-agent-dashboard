# Tasks — widen-containment-to-resolved-checkout

STUB. Design gate first — no code until 1.1–1.3 are done.

## 1. Design gate

- [ ] 1.1 Run `doubt-driven-review` on this proposal, specifically against the WIDENING. Change 1's cycle 2 already caught "a security widening wrongly asserted to be behaviour-preserving" in an earlier draft of this work.
- [ ] 1.2 Enumerate what becomes readable in each of the nine git states; confirm no state gains reach outside its own checkout. Include the outside-the-repository `core.worktree` case change 1 deliberately did not reject.
- [ ] 1.3 Write `design.md`, MODIFIED deltas for BOTH `file-read-containment` requirements (both currently mandate `dirname()`), and `test-plan.md`; fold the automated scenarios into this file.
