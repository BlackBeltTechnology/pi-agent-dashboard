## Why

Trusted Types ships in `report` mode by default (`PI_DASHBOARD_TRUSTED_TYPES`, change `harden-client-sinks`). The documented follow-up flips that default to `enforce` after a release with zero app-owned violations (`docs/research/trusted-types-enforce-results.md` § Decision). The current telemetry cannot show that:

- In `report` mode the `default` policy returns every input unchanged, so the browser raises no Trusted Types violation for a library sink. Today the client counts that the policy was invoked, but not what enforcement would have done.
- Under `enforce`, three outcomes break or change behaviour: library HTML that the safety-net sanitizer alters, script text the policy refuses (`createScript` → `null`), and script URLs outside the `/sw.js` + `/assets/*.m?js` allowlist. None of the three is measured today. For example, a runtime plugin creating a worker from its own `/plugin-assets/` URL would be blocked; none is known to ship.
- The client counters behind `/api/csp-violations` are in-memory, overflow past 50 keys per flush, and are dropped when a batch is refused, so they cannot serve as multi-week soak evidence.

This change makes report mode measure the would-be enforce outcome and persist it without silent loss. The flip itself is a separate change (`enforce-trusted-types-default`), gated on this evidence.

## What Changes

- **Shadow evaluation in the client `default` policy (report mode only).** Each `default` policy call still returns its input unchanged. The call also classifies what enforcement would do into one of six fixed outcomes:
  - `would-block-script`
  - `would-block-script-url`
  - `would-alter-html`: a DOMPurify removal, or dropped leading head content
  - `would-throw-html`
  - `not-evaluated`: skipped by the cost budget
  - `shadow-error`: the classifier itself failed

  Rendered output and `default`-hit counts stay identical. Classification uses its own DOMPurify instance, with a module-private parse-only policy so it raises no Trusted Types violation itself. It never throws into the sink, and a re-entry guard prevents recursion. HTML classification is memoized per distinct input with a per-window budget (count and bytes), so the cost is bounded without starving long-lived tabs. `off` and `enforce` modes do no shadow work.
- **Shadow aggregate on the existing channel.** Each `POST /api/csp-violations` report carries an optional `shadow: { <outcome>: n }` field.
  - The aggregate sits outside the 50-key cap and `overflow`, and is sent even with no entries.
  - It is clamped per report and kept across every failed send except a schema rejection (400). A 400 loss is counted as `shadow-error`.
  - Per-source `trusted-types-shadow / <outcome> / <source>` detail entries go into `entries` for triage. They are ordered last and shed first. On the server they live in their own in-memory LRU, so they never evict violation counters.
  - Reports are bounded by bytes, and sources are truncated to 512 characters, so a batch never exceeds the body limit.
  - No content sample is sent.
  - Unknown aggregate keys are ignored by the server (forward compatibility).
- **Persisted shadow counters.** The server adds each accepted report's `shadow` aggregate to a fixed-key `ttShadow` block in the existing counter file (`csp-reports.json`), never through the `policy × directive` path. The block has its own `since`. That `since` is renewed whenever the evidence restarts from zero: first start, a missing block after a rollback, or a malformed block. Lost evidence therefore shows as a later window start, never as a zero. A malformed block never discards the other counters. `POST /api/csp-reports/reset` zeroes it with the others.
- **Observability.** Whenever the server emits `cspReports` in `GET /api/health`, the block carries `ttShadow` with its `since` and all six counts, zeros included. An absent field means the server predates this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-trusted-types`:
  - "Default policy follows the Trusted Types mode": adds shadow evaluation in report mode.
  - "Violations are reported to the server": adds the shadow aggregate, its retention, entry ordering and source truncation.
  - "Violation endpoint stores counters only": accepts the `shadow` field and hands it to the persisted counter.
- `baseline-content-security-policy`:
  - "Violation counter is observable and persistent": adds the persisted fixed-key shadow block.
  - "Violation counters reset only by explicit operator action": the reset also zeroes the shadow block.
  - "Violation counters appear in the health report only when disclosure is permitted": `ttShadow` is always present in the block.
  - "Violation counter degrades safely": a malformed shadow block restarts only the shadow counters and is not file corruption.

## Impact

- Client: `packages/client/src/lib/security/trusted-types.ts` (+ `__tests__/trusted-types.test.ts`).
- Server: `packages/server/src/routes/csp-violations-routes.ts`, `packages/server/src/auth/csp-report-store.ts`, `packages/server/src/routes/system-routes.ts` (health block), and `packages/server/src/server.ts`, which constructs the store before the routes and wires `recordShadow`, plus their tests.
- E2E: a new report-mode variant in `tests/e2e/trusted-types-perf.spec.ts` (shadow cost; the existing checks force `enforce`). `tests/e2e/trusted-types-budget.spec.ts` must stay green.
- Docs: `docs/architecture.md` § Violation channel and § Trusted Types interaction.
- Compatibility: additive.
  - An older server ignores the `shadow` report field (`parseReport` drops unknown fields, `csp-violations-routes.ts:48-63`) and the `ttShadow` file block (`parse`, `csp-report-store.ts:261-279`), and drops that block on its next write.
  - Older clients send no `shadow` field.
- Rollback: revert. The shadow counts are lost on the next write by the older server, and a later roll-forward shows a new `ttShadow.since`. No other state is affected.
- Trust: forged shadow reports never change server behaviour. They can only hold the flip until an operator triages or resets.
- No user-visible behaviour change in any mode.

## Discipline Skills

- `security-hardening`: the shadow path runs inside a Trusted Types policy on untrusted library input. It must never change output or throw into a sink.
- `performance-optimization`: shadow sanitization adds DOMPurify cost on the render path. The memo and budget are measured by a report-mode perf check.
- `observability-instrumentation`: new persisted counters and a health field are the soak evidence for the enforce flip.
- `review-code`: before commit.
