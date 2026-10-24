## Why

The dashboard's CSP has no Trusted Types directive. A spike (docs/research/trusted-types-spike.md) measured the real DOM sink surface of the production build under `require-trusted-types-for 'script'` in report-only mode across ~20 core routes, plugin routes and the Mermaid pipeline. Findings:

- Chat, markdown, settings, OpenSpec and most previews produce **zero** violations.
- Violations are concentrated in ~9 sites: Mermaid SVG injection (`DOMParser` + `innerHTML`), AsciiDoc/DOCX `dangerouslySetInnerHTML`, Monaco/pdf.js worker constructors, and `navigator.serviceWorker.register`.
- A sanitizing default policy keeps Mermaid output pixel-identical except for one colorize step that needs a named policy.

Enforcing Trusted Types would convert a latent DOM-XSS class into a hard browser gate. Before any enforcement, the violation surface must be measured in report-only mode on the shipped build so regressions are visible without breaking users.

## What Changes

- Add a Trusted Types directive to the baseline CSP **in report-only mode only** (`Content-Security-Policy-Report-Only`, `require-trusted-types-for 'script'`, `report-uri`/`report-to` to the existing CSP report sink).
- Register a single named default policy in the client bootstrap (`main.tsx`) that sanitizes HTML through DOMPurify and is used for the Mermaid SVG and AsciiDoc/DOCX HTML sinks.
- Route the Mermaid colorize step through an explicitly named, reviewed policy so that its output is the only non-sanitized TrustedHTML path.
- Replace the three known script-URL sinks (Monaco worker, pdf.js worker, service worker registration) with `TrustedScriptURL` via the same policy mechanism, or document them as allowed exceptions with a rationale.
- Add a repeatable Playwright measurement script (promoted from `/tmp/tt-spike`) into the repo's e2e tooling so the violation count is a tracked number, not a one-off.

Out of scope for this change: switching the CSP from report-only to `enforce`. That is a separate follow-up gated on the report-only count reaching zero for a full release cycle.

## Capabilities

### New Capabilities
- `trusted-types-enforcement`: report-only Trusted Types directive, named default policy, and the measured violation budget.

### Modified Capabilities
- `baseline-content-security-policy`: add the report-only Trusted Types directive. The `enforce` mode of the CSP is unchanged.

## Impact

- `packages/server/src/auth/csp.ts` (+ tests): add report-only Trusted Types directive, behind the existing `PI_DASHBOARD_CSP` mode switch.
- `packages/client/src/main.tsx`: register the default TrustedTypes policy when `window.trustedTypes` is available.
- `packages/client/src/components/preview/MermaidBlock.tsx`: route SVG through the named policy (behaviour-preserving; one colorize step).
- `packages/client/src/components/editor-pane/monaco-setup.ts`, `packages/client/src/main.tsx` (service worker): script-URL sinks.
- `tests/e2e/`: new Trusted Types report-only measurement spec with a recorded budget.
- No behaviour change for users. Report-only mode does not block scripts.

## Rollback

Remove the report-only header from `csp.ts`. The default policy is inert without the enforcing directive and can stay. No data or schema changes.

## Discipline Skills

- `security-hardening`: CSP and DOM-sink review (this change is a hardening change by definition).
- `doubt-driven-review`: before the named policy is accepted as the only non-sanitized TrustedHTML path.
- `review-code`: after implementation, before commit.
