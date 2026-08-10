## ADDED Requirements

### Requirement: The AGENTS.md byte cap is enforced by gating the existing lint's byte arm

The existing `kb dox lint` — which already implements `AGENTS_BYTE_CAP = 30000`
and emits an `over-threshold` issue with `arm: "bytes"` — SHALL be the source of
the byte-cap verdict at `ship-it` step 4.4. No second implementation of the cap
SHALL be written; in particular `scripts/split-large-agents.mjs` SHALL NOT gain a
cap-checking mode, because it computes a per-row character cap (`INLINE_CAP`),
not a per-file byte cap.

The lint SHALL NOT be invoked in its default exit-code mode, which fails on any
of its seven issue kinds and would adopt the repo's entire DOX backlog as a
blocking gate. The gate SHALL consume `kb dox lint --json` and fail only on
`over-threshold` issues whose `arm` is `"bytes"`.

#### Scenario: Over-cap file fails the gate

- **WHEN** an `AGENTS.md` exceeds `AGENTS_BYTE_CAP` and `ship-it` step 4.4 runs
- **THEN** the byte-arm gate reports it from `kb dox lint --json`
- **AND** step 4.4 exits non-zero

#### Scenario: Unrelated DOX issues do not fail the gate

- **WHEN** `kb dox lint` reports `missing`, `missing-companion`, `broken-ref`, `orphan`, `broken-pointer`, or `stale` issues, and no `over-threshold` / `arm:"bytes"` issue
- **THEN** step 4.4 exits 0 on this rule
- **AND** the pre-existing DOX backlog is not adopted as a blocking gate

#### Scenario: Row-arm over-threshold is not gated

- **WHEN** `kb dox lint` reports an `over-threshold` issue with `arm: "rows"`
- **THEN** the gate does not fail on it, because the row cap is informational

#### Scenario: Cap logic is not duplicated

- **WHEN** the change's diff is inspected
- **THEN** `scripts/split-large-agents.mjs` is unmodified
- **AND** no new code recomputes a per-file byte threshold; the gate only filters `kb dox lint`'s own verdict

#### Scenario: The splitter remains the remediation tool

- **WHEN** the byte-arm gate reports an over-cap `AGENTS.md`
- **THEN** `node scripts/split-large-agents.mjs <path> --write` remains the documented fix
- **AND** its existing behavior is unchanged

#### Scenario: Existing breach cleared when the gate is wired

- **WHEN** the byte-arm gate is wired into step 4.4
- **THEN** the over-cap `AGENTS.md` measured on this branch has been split
- **AND** the gate exits 0 on the change's own tree
