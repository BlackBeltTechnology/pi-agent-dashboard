## Context

See proposal.md - Why for motivation. The spike report `docs/research/trusted-types-spike.md` holds the measured sink inventory, harness method and the attribution of each violation to source. Constraints taken from that report:

- The production client is a single Vite bundle served by the dashboard server. Its CSP is built in `packages/server/src/auth/csp.ts` and governed by `PI_DASHBOARD_CSP=off|report|enforce`.
- Report mode is the existing staged-rollout path, so Trusted Types goes in report mode only.
- Mermaid's `dangerouslySetInnerHTML` path already sanitizes with DOMPurify and uses `HTML_INTEGRATION_POINTS` (see MermaidBlock.tsx ~:183), so the SVG path needs a named policy wrapper, not a new sanitizer.
- Monaco, pdf.js and the service worker create workers/scripts from URL strings, which Trusted Types treats as script sinks.

## Goals / Non-Goals

**Goals**
- Emit the Trusted Types directive in report-only mode and observe real violations on the shipped build.
- Provide one named default policy so new sinks fail closed in report output.
- Make the violation count a tracked, budgeted number.

**Non-Goals**
- Enforcing Trusted Types (`enforce` mode). Gated on a zero report-only count over a release cycle.
- Refactoring the Mermaid pipeline beyond routing its SVG through the named policy.
- Changing the `'unsafe-inline'`/`'unsafe-eval'` allowances. Those are a separate CSP-tightening decision.

## Decisions

**D1. Report-only, not enforce, in this change.** Enforcement would break any sink not yet covered. Report-only keeps behaviour identical and produces the data needed to size the enforcement work.

**D2. One default policy, DOMPurify-sanitized.** `trustedTypes.createPolicy("default", …)` sanitizes string input through DOMPurify before returning TrustedHTML. A single default policy is the Trusted Types-recommended shape; a second default is rejected at registration.

**D3. Mermaid colorize step gets a named policy.** The spike showed the colorize step is the only Mermaid path that needs a non-default output. It is routed through a named policy (`pi-mermaid`) so its output is reviewable in one place. Alternative rejected: loosening the default policy, because that would widen every sink.

**D4. Script-URL sinks are handled explicitly.** Monaco worker, pdf.js worker and `navigator.serviceWorker.register` create script URLs. Each is either wrapped in a `TrustedScriptURL` via a named policy or recorded as an allowed exception with a rationale in the spec. Decision per sink is made during implementation and recorded in tasks.md.

**D5. Measurement is a repo spec, not a script in /tmp.** The spike harness is promoted to `tests/e2e/` so the budget is versioned and reproducible.

## Risks / Trade-offs

- **Default-policy sanitization changes output for HTML that DOMPurify strips.** Mitigation: the Mermaid pixel-identity scenario and the AsciiDoc/DOCX sinks are re-measured before merge.
- **Report-only noise from third-party code.** Mitigation: the budget counts per route and per source file, so noise is attributable.
- **A named policy named `pi-mermaid` is reachable by any code that calls it.** Mitigation: the policy only accepts strings that DOMPurify has already sanitized and is not exported beyond the Mermaid module.

## Migration Plan

1. Land the report-only header and default policy behind `PI_DASHBOARD_CSP=report`.
2. Run the measurement spec on the production build; record the budget.
3. Route the Mermaid colorize step and the three script-URL sinks; re-run until the budget is met.
4. Enforcement is a separate, later change.

Rollback: remove the report-only directive from `csp.ts`. The default policy is inert without the directive.

## Open Questions

- Whether the service worker registration should move to a policy or be dropped if unused. To be answered during implementation by checking whether `/sw.js` is still served.
