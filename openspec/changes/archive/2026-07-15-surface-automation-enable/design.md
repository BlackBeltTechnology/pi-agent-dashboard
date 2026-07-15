## Context

Schedule automations under `<cwd>/.pi/automation/<name>/automation.yaml` carry a
`disabled?: boolean` field. The scheduler skips arming any automation whose
config is disabled ("dormant until re-enabled"), and a recursive `fs.watch` on
`.pi/automation/` re-scans + re-arms the scheduler on any `automation.yaml`
change (≈300ms debounce), regardless of which process wrote the file. The
invoicebot schedule automations are scaffolded `disabled: true`, and no existing
route or tool ever clears that field — so processing never fires.

The invoicebot-plugin already mounts cwd-keyed routes under
`/api/plugins/invoicebot/*` behind the dashboard's global `onRequest` auth gate,
with a `badCwd` validator. Every current route wraps the engine port; none does
a direct filesystem write.

## Goals / Non-Goals

**Goals:**
- One self-contained plugin (invoicebot-plugin) owns the enable/disable surface.
- A single-target flip route that mutates ONLY the `disabled` field in place.
- A discovery route so the consuming UI hard-codes no automation names.
- Zero change to the automation-plugin; rely on its watcher for live re-arm.

**Non-Goals:**
- The front-end toggle (separate standalone change).
- Reconciling the independent `intake_paused` engine gate (documented limitation).
- Any `ib_*` tool or engine port method — deliberately kept dashboard-local.
- Batch/multi-flip in one call; the UI loops per name from the discovery list.

## Decisions

**D1 — Own it in invoicebot-plugin via a direct FS write, not the engine port.**
No `ib_*` tool touches `disabled` (the engine `cadence` action rewrites only the
`cron:` line), so wrapping the engine would force an engine-repo change. The
plugin instead reads/writes the `automation.yaml` directly. This is the first
invoicebot route that does not wrap the engine port — an accepted, explicitly
flagged departure that keeps the whole change in one repo.
*Alternative rejected:* add a route to the automation-plugin — rejected per the
direction to keep the operator surface in the invoicebot-plugin; and it would
need invoicebot-domain knowledge (which names) in a domain-agnostic plugin.

**D2 — Single-target flip keyed by `{ cwd, name, enabled }`.**
The route addresses exactly one automation, is idempotent, and rejects a missing
name (never creates). Positive polarity (`enabled`) reads correctly at the call
site and is negated to `disabled` on write.
*Alternative rejected:* a blanket "flip everything in cwd" call — magic, and it
could silently touch an automation the operator did not intend.

**D3 — Surgical YAML edit preserving comments/formatting.**
Use the `yaml` package's Document API to set/remove only the `disabled` node,
then re-serialize. This preserves the scaffold's inline
`# enable deliberately (no runaway)` comment and every other field byte-for-byte,
and is safe for all action kinds.
*Alternative rejected:* parse → re-`stringify` the whole config — drops comments,
reformats, and (for prompt-kind automations) risks clobbering the sibling
`prompt.md`. A regex line edit was also rejected as fragile.

**D4 — Discovery route in the same plugin.**
`GET …/automation?cwd` enumerates the invoicebot automations + `enabled` state so
the UI renders one switch and enumerates flip targets without a client-side name
list. Names are discovered by scanning `<cwd>/.pi/automation/` for the invoicebot
automations; the endpoint tolerates 1 or 2 (drop-folder-only vs connector).

**D5 — Response returns resulting state; arming is eventually-consistent.**
The response reflects the state written to disk. The scheduler arm/disarm happens
asynchronously via the automation-plugin watcher within the debounce window; the
response does not block on it. The spec asserts the re-arm as a separate,
verifiable outcome.

## Risks / Trade-offs

- **First FS-write route in the invoicebot-plugin** → keep the write helper small,
  well-tested, and reuse the existing `badCwd` guard + a strict automation-name
  validator (reject separators / `..`).
- **Two contradicting switches (`disabled` here vs `intake_paused` in the engine)**
  → a stale `intake_paused: true` still swallows processing after enable.
  Mitigation: document plainly in the proposal; defer engine reconciliation to an
  optional companion change under the shared base name (sequenced engine → this).
- **Response ≠ armed state** (arming is 300ms-later, async) → spec verifies the
  re-arm independently; the response is truthful about disk state only.
- **Concurrent flips debounce into one re-scan** → benign; the watcher re-scans
  the whole scope, so the final on-disk state is what arms.

## Migration Plan

Additive routes only — no migration, no data model change. Rollback is removal of
the two route handlers; on-disk `automation.yaml` files remain valid either way.

## Open Questions

- None blocking. The `intake_paused` reconciliation is intentionally deferred and
  tracked separately, not resolved in this change.
