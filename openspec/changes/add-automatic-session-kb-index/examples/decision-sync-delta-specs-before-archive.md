---
kb:
  signal: decision
  signature: decision:sync-delta-specs-into-main-specs-before-archiving
  seen: 10
  sessionIds: [019da480, 019da4ce, 019de650, 019e0f85]   # +6 more (truncated)
  cwd: <repo>
  model: claude-opus-4-7
  confidence: 0.656
  verified: true
  firstSeen: 2026-06-xx
  lastSeen: 2026-07-13
  tags: [openspec, archive, sync-specs, delta-specs, convention]
---
# Convention: sync delta specs into main specs before archiving a change

## Decision
When archiving a completed OpenSpec change, sync its delta `specs/` into the main
`openspec/specs/` first, then archive. Recurred as a human-confirmed step across 10
sessions.

## Why
Archiving moves the change out of `openspec/changes/`. If the delta was not merged into
main specs first, the capability's source-of-truth spec goes stale — the archived
change holds requirements the live spec never absorbed.

## How
- Run the sync step (openspec-sync-specs skill) to fold ADDED/MODIFIED requirements into
  `openspec/specs/<capability>/spec.md`.
- Verify main specs reflect the delta, then run the archive step.

## Provenance
sessions 019da480, 019da4ce, 019de650, 019e0f85 (+6 more); seen 10×;
distilled by claude-opus-4-7 on 2026-07-13; confidence 0.656 (mid — human decision,
moderate recurrence).
