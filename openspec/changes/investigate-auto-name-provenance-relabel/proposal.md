# Investigate: a bridge reload relabels its OWN auto-name as a `user` rename

## Why

Split out of `fix-auto-naming-reasoning-model` (design D8b) as a distinct bug with a
different root cause. Recorded there as a **verification hazard**: a session named by that
change is relabelled `user` on the next reload, so anyone verifying auto-naming after a
reload will misread a working fix as broken.

**Mechanism (traced, not yet measured):**

- `createAutoNamer`'s `seed()` exists but is **never called in production** — only in tests.
  Nothing delivers persisted provenance to the bridge on connect.
- `lastSelfApplied` is closure state and is NOT carried across reload.
  (`fix-auto-naming-reasoning-model` carries a `PersistedNamerState` but deliberately
  restores only the STOP fields, precisely to avoid changing this bug's behaviour.)
- After a reload, `onObservedName(pi.getSessionName())` sees the bridge's own auto-name,
  `classifyNameChange` finds no matching `lastSelfApplied`, and classifies it **external**.
- Result: `nameSource: "user"` is latched, auto-naming is permanently locked out for that
  session, and a `session_name_update{nameSource:"user"}` is persisted.

**Evidence gathered so far (live system, 2026-08-20):**

| Check | Result |
|---|---|
| Sessions with `nameSource: "auto"` (`GET /api/sessions`) | 0 of 3380 |
| Persisted `"nameSource":"user"` rows in `~/.pi/agent/sessions/**/*.meta.json` | 174 |
| How many of those 174 were manufactured by this bug | **unknown — the open question** |

The 174 `user` rows are of unknown provenance: some are genuine renames, some are
plausibly this bug. The `fix-auto-naming-reasoning-model` proposal cited that count as
evidence and explicitly flagged it as possibly inflated by this bug.

## What Changes

Investigation first, not a fix. Deliverables:

1. **Measure the population.** Determine how many of the 174 `user` rows are genuine
   renames versus manufactured by a reload. Session transcripts and
   `session_name_update` history are the available evidence.
2. **Decide the seeding transport.** A fix requires delivering persisted provenance to the
   bridge on connect — a transport that does not exist today. The narrowly-scoped
   `auto_name_state_restore` message added by `fix-auto-naming-reasoning-model` is the
   obvious carrier to extend (it already flows server→bridge at register and already
   omits provenance ON PURPOSE), but widening it changes lockout behaviour for every
   existing session and needs its own review.
3. **Decide the migration question.** Whether wrongly-latched `user` rows should be
   repaired, and on what evidence. A blanket reset would clobber genuine renames.

## Impact

- Blocks a truthful reading of auto-naming success rates until resolved.
- Touches `auto-session-namer.ts` (`seed`, `classifyNameChange`, `lastSelfApplied`),
  `bridge.ts` (register-time restore), and the server's provenance persistence.
- No behaviour change until the investigation produces a design.

## Discipline Skills

- `systematic-debugging` — the mechanism is traced but the POPULATION is unmeasured;
  measure before designing a fix, exactly as the parent change did.
- `doubt-driven-review` — widening provenance restore changes the permanent-lockout state
  machine for every existing session; stress-test before it stands.
