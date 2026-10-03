# Rebuild package templates

Layout under `.reverse-spec-scratch/<target-slug>/rebuild/`:

```
README.md              index: target, commit SHA, capabilities, counts, gate verdicts
model.md               entities and value types
rules.md               BR-NNN business rules (explicit | implicit)
quirks.md              QUIRK-NNN suspected defects, kept faithful
gaps.md                GAP-NNN registered unknowns
completeness.md        entry point -> spec | GAP map + verdict
capabilities/<cap>/spec.md   behavioral spec (OpenSpec full form)
_fragments/<cap>.json  generator output, merge input (kept for re-runs)
```

Identifiers are three-digit, zero-padded, global to the package (`BR-001`,
`QUIRK-001`, `GAP-001`). Every item and field carries a citation per
`references/provenance.md`.

## README.md

```
# Rebuild package: <target>

- Target: <path relative to repo root>
- Commit: <full SHA of `git rev-parse HEAD` at extraction>
- Generated: <YYYY-MM-DD> by reverse-spec-for-rebuild
- Previous package: <path or "none"> (ids carried over)

## Capabilities

- `<cap>` — <purpose>; audit <pass|revise>, format <pass|fail> (lint-spec[, openspec validate])

## Counts

- Rules: <n> (explicit <e>, implicit <i>)
- Quirks: <q>
- Gaps: <g>
- Completeness: <PASS|FAIL> (<mapped>/<total> entry points)
```

## model.md

One `##` section per entity or value type. Fields as a bullet list (no tables).

```
## Loan
Identity: `id` UUID v4, generated on checkout.
<!-- cite: ref=lib/loans.py:18, confidence=confirmed -->
Persistence: `loans` table (PostgreSQL); `due_at` stored as UTC timestamp.
<!-- cite: ref=db/schema.sql:12-21, confidence=confirmed -->

- `renewals` — integer 0..2; optional on input; absent -> 0 (BR-007).
  <!-- cite: ref=lib/loans.py:25, confidence=confirmed -->
- `returned_at` — timestamp; nullable; null while the loan is active.
  <!-- cite: ref=db/schema.sql:19, confidence=confirmed -->

Relationships: belongs to `Member`; references one `Item`.
```

Per field state: name, type, required/optional (and nullability), allowed
values or range, default when absent, and the rule ids constraining it.
Persistence format only where the code defines one (DB schema, file format,
wire shape).

## rules.md

```
## BR-004 Active loan cap
- Class: explicit
- Statement: A member holding 5 active loans cannot borrow another item (`LOAN_LIMIT`); returned loans do not count.
- Capabilities: checkout, self-service-kiosk
<!-- cite: ref=lib/loans.py:41-44, confidence=confirmed -->
```

Statement precision: concrete thresholds, formulas, precedence (which rule wins),
rounding mode and the step where it happens, time zone / clock handling.

Classification (calibrated on code patterns):

- `explicit` — stated directly by the code that enforces it: a conditional or
  guard (`if active >= MAX_ACTIVE: raise LoanLimit`), a validation schema, a
  lookup table of rates, a formula (`fee = min(days * 0.25, 10)`), or a comment
  that matches the code.
- `implicit` — a business outcome nobody wrote as a rule; it arises from:
  a default value (`renewals = data.get("renewals", 0)` lets a migrated loan be
  renewed twice more), an exception handler (`except KeyError: pass` around a
  hold lookup lets a checkout proceed when the hold record is missing),
  fall-through / else branches (an unknown member type falls into the adult
  loan period), ordering (a reminder email queued before the renewal is
  committed), or cross-module interaction (the catalog module's item class
  silently selecting a different loan period in the checkout module).

Each rule appears once. A rule enforced by two capabilities lists both, and both
specs reference the same id.

## quirks.md

```
## QUIRK-001 Due date computed in UTC, documented as local time
- Observed: `due_at` is midnight UTC 21 days after checkout.
- Suspected intent: midnight in the branch's local time zone (docstring: "due at local midnight").
- Evidence: `datetime.utcnow()` in the due-date helper vs its docstring.
- Confidence: inferred
- Spec: capabilities/checkout/spec.md, Requirement "Loan period"
- Rules: BR-002
<!-- cite: ref=lib/dates.py:8-14, confidence=confirmed -->
```

The spec keeps the observed behavior; the quirk only flags it. The rebuilder decides.

## gaps.md

```
## GAP-001 Late-fee waiver list
- Unknown: which member types are exempt from late fees.
- Why: fetched at runtime from the membership service; no schema or fixture in the target.
- Affects: returns (BR-009)
- Resolve by: the membership service contract or a recorded response.
<!-- cite: ref=lib/fees.py:30-33, confidence=confirmed -->
```

## completeness.md

```
# Completeness: <PASS|FAIL>

## tools/commands
- `library renew` -> renewals
  <!-- cite: ref=cli/main.py:52, confidence=confirmed -->

## environment variables
## CLI flags
## HTTP routes
## WebSocket / event message types
## configuration keys
## error codes / types

## Unmapped
- [P0] `DELETE /holds/{id}` — no spec or gap references it
```

One bullet per inventoried entry point: `<entry point> -> <cap>` or
`-> GAP-NNN`. Every category heading is present (write `- none found` when empty).
`## Unmapped` lists each entry point mapped to neither, with P0 (user-facing
surface), P1 (operator/config) or P2 (internal) — priority orders remediation
only; any unmapped entry point makes the verdict FAIL.

## _fragments/<cap>.json

Generator output, consumed by the merge. Local ids (`r1`, `q1`, `g1`) are
capability-scoped and are rewritten to global ids by the merge.

```json
{
  "capability": "checkout",
  "rules": [
    { "local": "r1", "class": "explicit", "statement": "...", "cite": "lib/loans.py:41-44", "confidence": "confirmed" }
  ],
  "entities": [
    { "name": "Loan", "identity": "...", "persistence": "...", "fields": [
      { "name": "renewals", "type": "integer 0..2", "optional": true, "default": "0",
        "constraints": "...", "rules": ["r3"], "cite": "lib/loans.py:25", "confidence": "confirmed" }
    ], "relationships": ["belongs to Member"] }
  ],
  "quirks": [
    { "local": "q1", "title": "...", "observed": "...", "suspected_intent": "...", "evidence": "...",
      "rules": ["r2"], "requirement": "Loan period", "cite": "lib/dates.py:8-14", "confidence": "inferred" }
  ],
  "gaps": [
    { "local": "g1", "title": "...", "unknown": "...", "why": "...", "resolve_by": "...",
      "rules": ["r5"], "cite": "lib/fees.py:30-33" }
  ],
  "entry_points": [
    { "category": "http-route", "name": "POST /loans", "cite": "api/routes.py:24" }
  ]
}
```

Spec text references fragment items as `{r1}`, `{q1}`, `{g1}`; the merge
replaces each with its global id (`BR-007`, ...). After the merge no `{...}`
local reference may remain.
