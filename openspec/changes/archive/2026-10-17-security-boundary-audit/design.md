## Context

Audit-only change. The deliverable is the findings register
(`audit-findings.md`) plus its routing in `tasks.md`. It writes no product code
and no spec deltas (`skip_specs: true` in `.openspec.yaml`). Scope, threat model
and method are in `proposal.md`; this file records only the design decisions
that make the register trackable.

## Decisions

### D1 — The register is the deliverable, fixes are separate changes
Each behaviour-changing fix lands in its own reviewed OpenSpec change. Mixing
fixes into the audit would make the register un-archivable until every fix
shipped, and would hide which change delivered which fix.

### D2 — `[x]` means routed, not fixed
A ticked finding line in `tasks.md` carries exactly one status: **Closed by**
an archived change, **Owner assigned** to an active change (fix open),
**Split** (fixed part Closed, residual gets its own ID and owner), or
**No gap (verified)** with evidence. An unticked finding line has no owner.
The change archives only when no unticked finding lines remain. Archiving does
not mean the fixes have landed; "Owner assigned" findings stay open in their
owner changes. Rule text: `proposal.md` `## Remediation Ownership`.

### D3 — One owner per finding ID
The owner table in `proposal.md` and the status on each `tasks.md` line must
agree, and no ID has two owners. Test-plan #E3 checks this at archive time.

### D4 — No finding is dropped
Every bullet in `audit-findings.md` (clusters A–G, cross-cutting, V1–V5) maps to
a `tasks.md` ID. Test-plan #E4 checks the mapping.

### D5 — Verification is document-vs-code, one-shot
All test-plan rows are `manual-only`: each falsifies a register-integrity claim
against the repository at archive time. A permanent test on a change directory
that is about to move under `archive/` would be brittle. Behaviour tests belong
to the owner changes.

## Risks / Trade-offs

- **[Register drifts from code]** Line citations in the original audit
  (2026-07-16) go stale. Owners' proposals carry current citations; the register
  was reconciled against code on 2026-10-17.
- **[A ticked line is mistaken for a landed fix]** Mitigated by D2: every tick
  names its status and owner.
