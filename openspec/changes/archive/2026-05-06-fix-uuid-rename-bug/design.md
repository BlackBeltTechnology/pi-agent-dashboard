## Context

The `proposal-attachment` capability already documents an "Activity detector rejects flag-shaped change names" requirement (added by `fix-openspec-flag-rename-bug`, archived 2026-04-28). That fix tightened the detector to reject tokens starting with `-` and explicitly declined defense-in-depth at the rename site, on the grounds that the detector is the single source of truth.

A new symptom hits the same cascade: when an agent's tool event references an OpenSpec change directory by a UUID-shaped slug (e.g. a path `openspec/changes/019df0aa-.../...` from a write event, or a CLI argument), `detectOpenSpecActivity` returns `{ changeName: "019df0aa-...", isActive: true }`. The auto-attach branch in `packages/server/src/event-wiring.ts` (lines ~240–268) then stamps `openspecChange`, sets `attachedProposal`, and — because the freshly-spawned session has no user-set name — calls `attachRenameTarget`, which returns the UUID and renames the session to it.

OpenSpec's own CLI rejects change names that don't match `^[a-z][a-z0-9-]*$` (verified: "Test_Invalid", "test-Invalid", "1bad" all fail at `openspec new change`). The detector currently accepts a much wider shape (`[^\s"']+`), so any non-whitespace token slips through.

## Goals / Non-Goals

**Goals:**
- Stop UUID-shaped (and any other non-slug) tokens from cascading into auto-attach + auto-rename.
- Single shared predicate for the slug shape — same source consumed by detector and rename site.
- Defense-in-depth at the rename call site so a future detector regression cannot rename a session.
- Regression tests covering UUID, mixed-case, underscore, and digit-prefixed inputs.

**Non-Goals:**
- Backfill / migration for already-corrupted sessions. The existing rename / detach UI handles cleanup.
- Re-architecting the auto-attach path or proposal-attach-naming witness rule.
- Validating change names anywhere else (e.g. browser-initiated `attach_proposal`). Browser inputs come from a list the server itself produced; the bug is detector-driven.
- Reverting the prior `-`-guard rule. It is subsumed by the slug allowlist but kept for clarity in the spec.

## Decisions

### Decision 1: Allowlist over blocklist

Use a positive shape rule: `^[a-z][a-z0-9-]{0,63}$`. Mirrors the OpenSpec CLI's own validation (lowercase, starts with a letter, kebab-case). Bounded length (64 chars) prevents pathological inputs.

**Alternatives considered:**
- *UUID-specific blocklist* (`/^[0-9a-f]{8}-[0-9a-f]{4}-.../i`). Rejected — fixes the immediate symptom but leaves the next not-yet-seen junk shape (file paths with dots, sessionIds, hashes) unguarded. We've now had two regressions of this exact class; an allowlist closes the family.
- *Length-only cap.* Rejected — UUIDs are 36 chars, well within any reasonable session-name cap.

### Decision 2: Defense-in-depth at the rename site

Re-validate `detected.changeName` shape inside the auto-attach branch in `event-wiring.ts` before mutating `session.openspecChange`, `session.attachedProposal`, or sending `rename_session`. This **reverses** the explicit "no duplication" stance of `fix-openspec-flag-rename-bug`.

Rationale: two regressions of the same class within ~6 months is sufficient evidence that the detector is not a stable single source. The cost of one extra `if` at the rename site is trivial; the cost of a third regression that ships a junk session name to disk is not.

**Alternatives considered:**
- *Detector-only fix* (matches the prior proposal). Rejected — a future change to `detectOpenSpecActivity` (new tool, new regex) re-opens the same hole. The rename site is the value boundary; guard it.
- *Type-level guard (branded `OpenSpecChangeName` type).* Rejected — would force changes through the entire pipeline and the protocol; out of proportion to the bug.

### Decision 3: Helper lives next to the detector

Export `isValidOpenSpecChangeSlug(name: string): boolean` from `packages/shared/src/openspec-activity-detector.ts`. The detector uses it internally; `event-wiring.ts` imports it as a sibling check.

**Alternatives considered:**
- *Separate `change-slug.ts` module.* Rejected — single 6-line predicate, no other planned consumers.
- *Inline regex at both sites.* Rejected — drift risk; the whole point is one source of truth for the shape.

### Decision 4: Drop the `-` guard, or keep it?

Keep it. The slug allowlist already excludes leading `-` (the rule requires `[a-z]` first). Removing the dedicated check + scenarios would churn the existing requirement that ships in `openspec/specs/proposal-attachment/spec.md`. The MODIFIED delta keeps the flag-shaped requirement and adds the slug-shape requirement alongside; the implementation collapses both into the single allowlist call.

### Decision 5: Defense-in-depth scope

Only the rename / auto-attach branch in `event-wiring.ts` re-validates. The `applyAttachProposal` helper in `session-meta-handler.ts` and the REST `/attach-proposal` route do **not** add re-validation — those are user/browser-initiated and operate on names from a server-curated list. Adding guards there is overreach.

## Risks / Trade-offs

- **Risk:** Real OpenSpec change names that violate the regex (e.g. someone manually creates `openspec/changes/MyChange/` bypassing the CLI) would no longer trigger auto-attach. → **Mitigation:** mirrors CLI validation exactly; manual attach via UI still works. Edge case acceptable.
- **Risk:** 64-char cap could clip legitimate long change names. → **Mitigation:** survey of `openspec/changes/` and `openspec/changes/archive/` shows no name exceeds ~50 chars. Cap is generous; can be raised later if needed.
- **Trade-off:** Two checkpoints (detector + rename site) duplicate the predicate call but not the predicate. The duplication is intentional per Decision 2.

## Migration Plan

No migration. Existing sessions whose name was set to a UUID by the bug:
1. User clicks rename on the session card → enters new name (or empty to clear).
2. Or detaches the (UUID-shaped) `attachedProposal` via the existing detach UI — the witness rule clears the name automatically.

No code-side backfill, no startup sweep.

## Open Questions

None. Slug shape mirrors the OpenSpec CLI; defense-in-depth scope settled (Decision 5).
