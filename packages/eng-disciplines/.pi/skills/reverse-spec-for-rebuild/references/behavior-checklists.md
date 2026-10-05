# Behavior checklists

Each capability spec walks these checklists. Every item the code exhibits
becomes a Requirement (grouping related items) with concrete Scenarios. Items the
code does not exhibit are skipped silently; items the code exhibits but you
cannot determine become a `GAP-`. Never add a separate `##` section — everything
is a `### Requirement:` / `#### Scenario:` pair so the spec stays OpenSpec full form.

## State machine

For each stateful entity or process:

- [ ] States (complete list) and the initial state.
- [ ] Each legal transition: from, to, trigger, guard.
- [ ] Rejected transitions: what happens on an illegal move (error code, no-op, silent).
- [ ] Terminal states.
- [ ] Side effects per transition (events, writes, calls).
- [ ] Persistence: where state lives and whether it survives restart.

Pattern — one allowed and one rejected scenario per guarded transition:

```
### Requirement: Hold lifecycle
The library SHALL move a hold through queued, ready, collected and expired, starting in queued, and SHALL reject any other move with `HOLD_STATE`.
<!-- cite: ref=lib/holds.py:10-19, confidence=confirmed -->

#### Scenario: Ready hold is collected
- **WHEN** a member collects a ready hold
- **THEN** the hold becomes collected

#### Scenario: Expired hold cannot be collected
- **WHEN** a member tries to collect an expired hold
- **THEN** the request fails with `HOLD_STATE`
- **AND** the hold stays expired
```

## Edge cases

- [ ] Empty input (no items, empty string, missing optional field).
- [ ] Limits: minimum, maximum, just beyond each (state the exact boundary and
      whether it is inclusive).
- [ ] Concurrent access (two writers, re-entrancy) — only what the code handles or
      visibly fails to handle.
- [ ] Interruption or partial failure (crash between two writes, a failing call
      mid-sequence): what state remains.

Pattern:

```
#### Scenario: Renewal on the due date
- **WHEN** a loan is renewed on its due date
- **THEN** the renewal is accepted and the due date moves 21 days later (BR-007)
```

## Error handling

For each error the capability can raise or receive:

- [ ] Detection: the condition that triggers it.
- [ ] Response: thrown type/code, status, retry, fallback, swallow.
- [ ] User-visible message or code, verbatim where the code defines it.
- [ ] Recovery: what state remains, whether the caller can retry.

Pattern:

```
#### Scenario: Missing hold record does not block checkout
- **WHEN** an item is checked out and its hold record cannot be found
- **THEN** the checkout succeeds without an error
- **AND** no hold is marked collected (BR-011)
```

## Format reminders

`### Requirement: <name>` (no number), `#### Scenario: <name>` (a heading, not a
bold label), `- **WHEN**` and `- **THEN**` in every scenario, no tables. Run
`node scripts/guard.mjs lint-spec <spec.md>`; the examples above pass it when
wrapped in `# <cap> Specification`, `## Purpose`, `## Requirements`.
