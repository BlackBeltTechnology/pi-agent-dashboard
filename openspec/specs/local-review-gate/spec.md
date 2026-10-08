# local-review-gate Specification

## Purpose
TBD - created by archiving change wire-local-review-gate. Update Purpose after archive.

## Requirements

### Requirement: A semantic review runs before push, on the integrated green tree

`ship-it` SHALL invoke a semantic review checkpoint (step 4.5) after the docker
harness is green and after the deterministic enforcers (step 4.4) pass, and
strictly before `ship-change` is driven inline. The checkpoint SHALL run on every
`ship-it` invocation that proceeds toward `ship-change`; there SHALL NOT be a
triviality escape based on diff size, changed-file count, or touched paths. An
invocation stopped before step 4.5 — by the entry gate on an existing
`SHIP_IT_BLOCKED.md`, a red harness, or a failing enforcer — neither reviews nor
reaches `ship-change`.

#### Scenario: Review runs after the harness and the enforcers

- **WHEN** the harness reports every automated scenario green and step 4.4 exits 0
- **THEN** the review checkpoint runs before any `ship-change` step executes
- **AND** it reads the tree that already includes the `origin/develop` merge from step 2.5

#### Scenario: A small diff is still reviewed

- **WHEN** the change's diff is a single line in a single file
- **THEN** the review checkpoint still runs
- **AND** no diff-size or path heuristic skips it

#### Scenario: Review never runs on a red tree

- **WHEN** the harness is red, or a step-4.4 enforcer exits non-zero
- **THEN** the review checkpoint does not run
- **AND** no model call is spent on a tree that already fails a mechanical gate

#### Scenario: An invocation stopped at the entry gate neither reviews nor ships

- **WHEN** `ship-it` stops at entry because `SHIP_IT_BLOCKED.md` exists
- **THEN** the review checkpoint does not run
- **AND** no `ship-change` step runs

### Requirement: The reviewer is fed the diff and the change's intent

The checkpoint SHALL supply the reviewer with both the change diff and the
change's intent, so findings can be judged against what the change set out to
do, not against the diff alone. The prompt SHALL name the diff range for the
reviewer to read in full. The intent SHALL comprise `proposal.md`, the task
text (`tasks.md`), and — whenever they exist — `design.md`, every delta spec under the
change's `specs/` directory, and `test-plan.md`. The diff SHALL be scoped to the
change's own commits, not to everything the step-2.5 merge introduced from
`develop`. The scoping SHALL use the three-dot range
`git diff origin/develop...HEAD` (merge-base), which yields only commits
authored on this branch; because the worktree is committed before each round,
the range covers every edit under review.

The reviewer prompt SHALL be produced by the ship-it skill's prompt generator
and passed to the reviewer verbatim. It SHALL carry the `review-code` rubric
text. The generator SHALL accept only structured inputs (change name, round
number, the previous round's blocking findings as the reviewer wrote them, the
fix ledger, the previous round's commit) and SHALL NOT accept free-text author
commentary. Text the generator authors SHALL contain no assertion about the
change or its fixes (for example "all findings were fixed" or "a further round
is not permitted"); author-supplied ledger fields SHALL appear only inside one
delimited block labelled as unverified records for the reviewer to check
against source.

#### Scenario: Intent accompanies the diff

- **WHEN** the review checkpoint invokes the reviewer
- **THEN** the reviewer input contains the change diff range
- **AND** it references the change's `proposal.md` and the text of the tasks being implemented
- **AND** it references `design.md`, every delta spec, and `test-plan.md` for each of those that exists in the change directory

#### Scenario: Merged develop code is not attributed to the change

- **WHEN** step 2.5 has merged `origin/develop` into the worktree
- **THEN** the reviewed diff excludes changes originating from `develop`
- **AND** the reviewer is not asked to review code the change did not author

#### Scenario: Cross-file coupling is reviewable

- **WHEN** a diff edits a file whose behavior is documented as mirroring another package's rules by comment only
- **THEN** the reviewer receives enough context to raise the coupling as a finding
- **AND** the finding does not depend on any static-analysis rule existing for it

#### Scenario: The prompt is generated, not hand-written

- **WHEN** step 4.5 spawns the reviewer
- **THEN** the prompt it passes is the prompt generator's output for that change and round, unmodified
- **AND** two runs with the same inputs produce the same prompt

#### Scenario: Author assertions cannot reach the reviewer as instructions

- **WHEN** the prompt generator is given any combination of its accepted inputs
- **THEN** the text it authors contains no statement that findings are fixed, that the review is final, or that the reviewer should limit what it reports
- **AND** it exposes no free-text input for author commentary
- **AND** every ledger-derived string appears only inside the delimited unverified-records block

#### Scenario: A ledger string cannot escape the unverified block

- **WHEN** a ledger field contains the characters used to delimit the unverified-records block
- **THEN** the generated prompt still contains exactly one unverified-records block
- **AND** that field's full text is inside it

### Requirement: The reviewer is a REQUIRED role-aliased subagent

The checkpoint SHALL spawn an isolated subagent via the `Agent` tool with
`model: "@review"`, carrying `review-code`'s rubric as its prompt (embedded in
the generated prompt). The spawn SHALL use an agent definition that disables
parent-context inheritance, so the reviewer receives no part of the
orchestrator's conversation — only the generated prompt and what it reads from
the repository. It SHALL NOT
invoke the CodeRabbit CLI or any other metered PR-gate service, and SHALL NOT run
the review procedure inline in the orchestrator's own context.

`@review` SHALL be required: when the role is unconfigured or does not resolve,
the checkpoint SHALL fail with an actionable error naming the fix. It SHALL NOT
fall back to the session default model, because that model is the author model
and the result would be self-review.

#### Scenario: Role alias configured

- **WHEN** `@review` resolves to a model
- **THEN** the checkpoint spawns an isolated subagent on that model
- **AND** the reviewer runs in a context separate from the orchestrator's

#### Scenario: The reviewer inherits no author context

- **WHEN** step 4.5 spawns the reviewer while the subagent runtime's global setting inherits parent context
- **THEN** the reviewer is spawned from a definition that disables inheritance
- **AND** its input contains the generated prompt and no compressed copy of the orchestrator's conversation

#### Scenario: Role alias unconfigured

- **WHEN** `@review` is not configured or fails to resolve
- **THEN** the checkpoint fails with an error naming `@review` and how to set it
- **AND** the error suggests seeding it from an existing `@propose-review-N` role
- **AND** no review is performed against the session default model

#### Scenario: Review is never run inline by the orchestrator

- **WHEN** the checkpoint executes
- **THEN** the review is performed by a spawned subagent, not by the orchestrator itself

#### Scenario: PR-gate quota is not spent locally

- **WHEN** the checkpoint runs
- **THEN** no CodeRabbit CLI invocation occurs
- **AND** CodeRabbit remains the post-push PR gate, unchanged

### Requirement: Each reviewer invocation is deadline-bounded

The checkpoint SHALL apply a timeout to every reviewer invocation. A timeout
SHALL be treated as a checkpoint failure with a legible reason — never as a
blocking finding, and never as a silent pass.

#### Scenario: Reviewer stalls

- **WHEN** the reviewer invocation exceeds its deadline
- **THEN** the checkpoint terminates the invocation
- **AND** reports a timeout as the reason
- **AND** the headless run does not hang

#### Scenario: Timeout is not a silent pass

- **WHEN** a reviewer invocation times out
- **THEN** `ship-it` does not proceed to `ship-change` as though the review had passed

### Requirement: Severity routing under a hard cap of two review rounds

Findings of severity `issue(blocking)` SHALL re-enter `ship-it`'s step-4 fix
loop. Findings of every other severity SHALL be reported and SHALL NOT block.

The review SHALL be bounded by an explicit count of at most **two rounds**:
review, fix, re-review. The ceiling SHALL rise above two only by one round per
explicit human approval given at the cap (see "A review-driven halt is
legible"); the orchestrator SHALL NOT restart, reset, or otherwise renew the
round budget on its own within a `ship-it` invocation. The round number and the
count of approvals SHALL be derived from the invocation's recorded round
outputs and recorded answers, not supplied ad hoc. If blocking findings
remain when the ceiling is reached, the checkpoint SHALL stop. The review SHALL
NOT be bounded solely by step 4's no-progress rule, which a non-deterministic
reviewer can defeat by emitting a fresh finding each cycle.

Before each round the worktree SHALL be committed, so the reviewed tree has a
commit. Every round after the first SHALL be a verification round: the reviewer
receives the previous round's blocking findings as it wrote them, the fix
ledger as unverified records to check against source, and the fix delta from
the previous round's commit to the current one. It SHALL classify each previous
blocking finding as resolved, partially resolved, or unresolved with evidence,
SHALL check that each ledger test exercises its finding and each listed sibling
site, and SHALL review the fix delta. New blocking findings anywhere in the
change SHALL still be reported and SHALL still block. Every round's reply SHALL
end with a per-class sweep summary, then one `BLOCKING_COUNT: <n>` line, then
one `VERDICT: pass|block` line.

A reply is malformed when it is empty, does not contain exactly one
`BLOCKING_COUNT` line and one `VERDICT` line, its count disagrees with the number
of distinct blocking finding ids it lists, or its verdict disagrees with its
count (`pass` exactly when the count is 0). A malformed reply SHALL NOT be
routed as a pass and SHALL NOT count as a round. The orchestrator MAY re-invoke
the reviewer once for that round, keeping the malformed attempt as a separate
record; a second malformed reply SHALL halt the checkpoint like a timeout.

#### Scenario: Clean first round

- **WHEN** round 1 returns no `issue(blocking)` findings
- **THEN** `ship-it` proceeds to drive `ship-change`
- **AND** any non-blocking findings are reported

#### Scenario: Blocking finding fixed and cleared on re-review

- **WHEN** round 1 returns an `issue(blocking)` finding
- **THEN** it becomes a work item in the step-4 fix loop
- **AND** the harness and the step-4.4 enforcers are re-run after the fix
- **AND** exactly one verification round (round 2) runs on the updated diff
- **AND** a clean round 2 proceeds to `ship-change`

#### Scenario: Round 2 verifies instead of starting over

- **WHEN** round 2 is requested after round-1 blocking findings `B1` and `B2` were worked
- **THEN** the round-2 prompt contains the round-1 reviewer's `B1` and `B2` findings as written
- **AND** it contains the fix ledger inside the unverified-records block
- **AND** it names the fix-delta range from the round-1 commit
- **AND** the reviewer's reply states, for `B1` and `B2`, resolved, partially resolved, or unresolved with evidence

#### Scenario: Uncommitted fixes are still a distinct fix delta

- **WHEN** round 1 reviewed a tree and the round-1 fixes are made without the author committing them
- **THEN** the worktree is committed before round 2
- **AND** the fix-delta range contains only the edits made after the round-1 commit

#### Scenario: A malformed reply is not a pass

- **WHEN** a reviewer reply is empty or has no `BLOCKING_COUNT` line
- **THEN** `ship-it` does not proceed to `ship-change`
- **AND** after at most one re-invocation for that round, a second such reply halts the checkpoint

#### Scenario: A contradictory reply is malformed

- **WHEN** a reply lists a blocking finding `B1` but ends with `BLOCKING_COUNT: 0`, or ends with `BLOCKING_COUNT: 0` and `VERDICT: block`
- **THEN** the reply is treated as malformed, not as a pass

#### Scenario: A retried attempt does not advance the round

- **WHEN** round 2's first reply is malformed and its re-invocation is well-formed
- **THEN** the derived round number is 2, not 3
- **AND** the malformed attempt is still on record

#### Scenario: Round state is derived from records

- **WHEN** the invocation's records hold round outputs for rounds 1 and 2 and no recorded approval
- **THEN** the derived state is round 2 with zero approvals
- **AND** a verification round is not requested on that state

#### Scenario: Blocking findings survive the second round

- **WHEN** round 2 (or, after approvals, the last approved round) still returns `issue(blocking)` findings
- **THEN** no further round runs without a new human approval
- **AND** the checkpoint stops as defined by "A review-driven halt is legible"

#### Scenario: A reviewer emitting fresh findings each round cannot loop forever

- **WHEN** the reviewer returns a different `issue(blocking)` finding on every round
- **THEN** a headless run still terminates after round 2
- **AND** an interactive run cannot pass round 2 without a recorded human approval for each additional round
- **AND** termination does not depend on a cycle producing no worktree change

#### Scenario: The orchestrator cannot renew its own budget

- **WHEN** round 2 has returned blocking findings and no human approval has been given
- **THEN** no further reviewer invocation occurs in that `ship-it` invocation
- **AND** no round is relabelled as round 1 of a new budget

#### Scenario: A review fix may not weaken a test

- **WHEN** a fix for a review finding edits a test file in a way `assertNoWeakening` reports as `ok:false`
- **THEN** the change is rejected
- **AND** the finding is addressed in code instead

#### Scenario: An unsatisfiable finding is escalated, not looped

- **WHEN** a blocking finding can only be satisfied by weakening or deleting a test, and `assertNoWeakening` therefore rejects every candidate fix
- **THEN** the checkpoint stops and takes the escape hatch
- **AND** the report names both the finding and the guardrail blocking it
- **AND** the guardrail is not relaxed automatically

### Requirement: A review-driven halt is legible

When the checkpoint halts — blocking findings remaining at the round ceiling,
an unsatisfiable finding (including a fix-ledger entry that cannot be
completed within its bound), an unconfigured `@review` role, a reviewer timeout, or a second
malformed reply — the outcome SHALL be explicit and recorded.

A run is **interactive** exactly when the `ask_user` tool is available in the
session; otherwise it is headless. At the round ceiling in an interactive run,
`ship-it` SHALL ask the human via `ask_user`, naming the remaining blocking
findings, to choose between one more verification round and handing back to
planning. Approvals SHALL be recorded in an approval record kept separate from
reviewer output, written only from an `ask_user` answer; reviewer text is never
read as an approval. Choosing one more round SHALL raise the ceiling by exactly
one. If the `ask_user` call fails, the run SHALL be treated as headless. Choosing hand-back, and every halt
in a headless run, SHALL take the existing boundary-reverse (step-5) escape
hatch: leave the worktree intact, write
`openspec/changes/<change>/SHIP_IT_BLOCKED.md` naming the cause and what was
attempted, and exit non-zero. Every other halt cause SHALL take the escape hatch
in both modes. No blocked-state file or exit code other than the escape hatch's
SHALL be introduced.

#### Scenario: Unattended run halts on review

- **WHEN** a headless `ship-it` run has blocking findings after round 2
- **THEN** `SHIP_IT_BLOCKED.md` is written naming the blocking findings and the attempted fixes
- **AND** the worktree is left intact
- **AND** the process exits non-zero

#### Scenario: Interactive run asks at the ceiling

- **WHEN** an interactive run reaches the round ceiling with blocking findings `B1` and `B3` remaining
- **THEN** `ask_user` is called once, naming `B1` and `B3`
- **AND** its options are one more verification round and hand back to planning
- **AND** no `SHIP_IT_BLOCKED.md` is written before the human answers
- **AND** an approval is recorded in the approval record, never inferred from reviewer output

#### Scenario: Without ask_user the run is headless

- **WHEN** the round ceiling is reached with blocking findings in a session where `ask_user` is unavailable, or the `ask_user` call fails
- **THEN** the escape hatch is taken
- **AND** no round is added

#### Scenario: One more round is exactly one

- **WHEN** the human chooses one more verification round
- **THEN** exactly one additional verification round runs
- **AND** if blocking findings still remain after it, the human is asked again

#### Scenario: Hand-back uses the escape hatch

- **WHEN** the human chooses hand back to planning
- **THEN** `SHIP_IT_BLOCKED.md` is written naming the remaining blocking findings and the attempted fixes
- **AND** the worktree is left intact and the process exits non-zero

#### Scenario: Configuration and timeout failures are equally legible

- **WHEN** the checkpoint fails because `@review` is unconfigured, or because the reviewer timed out
- **THEN** the escape hatch records the cause in either mode
- **AND** a human can determine from the artifact why the run stopped

#### Scenario: No new escape machinery

- **WHEN** a review-driven halt occurs
- **THEN** it uses the same escape hatch as a red-test halt
- **AND** no additional blocked-state file or exit code is defined

### Requirement: Blocking findings are fixed under a recorded protocol

Before any verification round is spent, every blocking finding from the
previous round SHALL have a fix-ledger entry recording: a regression test in
the change's diff that reproduces the finding, or a reason of at least 20
characters stating why no automated test can observe the defect; the pattern
searched for sibling instances of the same defect across the change, and the
sibling sites found (possibly none); and where the fix landed (a commit id or
the uncommitted worktree). Each round SHALL have its own ledger, bound to that
round's finding ids. The ledger SHALL carry no resolved/unresolved verdict, and
its free-text fields SHALL NOT assert a status (phrases such as "is fixed",
"already resolved", "now verified", "no further", "should pass"); ledger
validation reports such an entry incomplete. Words that do not assert a status
(for example "passes the lock check") SHALL remain allowed.
Ledger validation SHALL check presence and shape only; whether a test truly
exercises its finding is judged by the verification round. The ledger and round outputs SHALL be stored outside the
change directory and outside version control, per worktree and per `ship-it`
invocation. A verification round SHALL NOT be requested while any blocking
finding lacks a complete entry. After three failed validations of the same
round's ledger, or when the fix loop cannot complete an entry, the finding SHALL
be treated as unsatisfiable.

#### Scenario: Complete ledger unlocks round 2

- **WHEN** every round-1 blocking finding has an entry naming a test file present in the change's diff, a sibling search, and a fix location
- **THEN** the ledger validates and round 2 may be requested

#### Scenario: Missing entry blocks round 2

- **WHEN** round 1 reported `B1` and `B2` and the ledger has an entry only for `B1`
- **THEN** ledger validation fails naming `B2`
- **AND** no reviewer invocation occurs until `B2` has an entry

#### Scenario: A test that is not part of the change does not count

- **WHEN** an entry names a test file that is absent from the change's diff
- **THEN** ledger validation reports the entry incomplete

#### Scenario: Untestable findings need a reason

- **WHEN** an entry declares its finding untestable with a reason shorter than 20 characters
- **THEN** ledger validation reports the entry incomplete

#### Scenario: Verdict language in the ledger is rejected

- **WHEN** an entry's untestable reason or sibling search text states that the finding is fixed or verified
- **THEN** ledger validation reports the entry incomplete

#### Scenario: Ordinary words are not verdict language

- **WHEN** an entry's untestable reason reads "the race occurs only when the second request passes the lock check first"
- **THEN** ledger validation does not reject it for verdict language

#### Scenario: A reused finding id does not inherit old evidence

- **WHEN** round 2 reports a new blocking finding `B1` and only round 1's ledger has a `B1` entry
- **THEN** validation of round 2's ledger reports `B1` missing

#### Scenario: Repeated validation failure is bounded

- **WHEN** the same round's ledger fails validation three times
- **THEN** no further fix cycle is attempted for it
- **AND** the checkpoint halts as for an unsatisfiable finding

#### Scenario: An entry that cannot be completed escalates

- **WHEN** the fix loop can neither add a regression test nor state a reason for a blocking finding
- **THEN** no verification round is requested
- **AND** the checkpoint halts as for an unsatisfiable finding

#### Scenario: The sibling sweep is recorded even when empty

- **WHEN** an entry records a sibling search that found no other sites
- **THEN** the entry is complete
- **AND** an entry with no recorded search is incomplete

#### Scenario: The ledger never enters version control

- **WHEN** the fix loop writes the ledger and round outputs
- **THEN** they are not inside the change directory
- **AND** `git status` in the worktree does not list them
- **AND** a later `ship-it` invocation writes to a separate location instead of overwriting them

### Requirement: The review rubric sweeps named defect classes

The `review-code` rubric SHALL name defect classes the reviewer sweeps across
the whole change, each with guidance on how to find its instances: spec and task
conformance; canonicalize before check; degenerate and boundary inputs;
stale state and reconciliation; error-path cleanup; shared-helper blast radius;
concurrency and interleaving; test fidelity to production wiring. The rubric
SHALL also state the fix protocol (reproducing test first, smallest fix, sibling
sweep, re-read of the fix against the finding's class). The ship-it reviewer
prompt SHALL require a per-class sweep summary in the reply. A missing summary
SHALL be reported as a gap in the round's record and in the step-4.5 report,
and SHALL NOT by itself fail the checkpoint.

#### Scenario: Rubric names the classes and the protocol

- **WHEN** the `review-code` skill is read
- **THEN** it names each of the eight defect classes with sweep guidance
- **AND** it states the four-step fix protocol

#### Scenario: Reviewer reports per class

- **WHEN** the ship-it reviewer prompt is generated for any round
- **THEN** it requires a per-class sweep summary followed by a `BLOCKING_COUNT` line

#### Scenario: A missing summary is not a failure

- **WHEN** a reviewer reply includes `BLOCKING_COUNT` but omits the sweep summary
- **THEN** the checkpoint routes findings normally
- **AND** the omission is noted in the round's record and the step-4.5 report
