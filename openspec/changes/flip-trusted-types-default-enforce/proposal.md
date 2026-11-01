## Why

Split out of `enforce-trusted-types-default` on 2026-10-30. That change ships the operator knob (`security.trustedTypes`, Settings control, shared resolver, dev-server parity) with the default unchanged (`report`; `off` when the baseline CSP is `off`). This change owns what must wait for real-world telemetry: the measured soak and the default flip to `enforce`. The enforce run (`docs/research/trusted-types-enforce-results.md` § Decision) names it as the follow-up; `add-trusted-types-shadow-enforce` provides the telemetry.

**Status: draft stub.** Spec delta, design and test-plan are authored when this is planned (`plan-proposal`), after the soak window can start. The text below is moved verbatim from the original proposal and is the starting point, not a reviewed plan.

## What Changes

- **Pre-flip soak gate (tasks, before any code change).** On released builds that carry `add-trusted-types-shadow-enforce`, recorded as evidence in tasks.md:
  - **Pipeline liveness (canary):** on the released build, a scripted canary (the steps of `add-trusted-types-shadow-enforce` test-plan F2, run against the instance) triggers one `would-alter-html` and one `would-block-script-url` and sees both in `cspReports.ttShadow`, read on the host as a disclosure-permitted loopback operator. If the counters cannot be read that way, the gate cannot be evaluated and the flip is blocked. The counters are then reset (`POST /api/csp-reports/reset`), and after at least 5 s (the counter flush) the server is restarted gracefully, so the in-memory per-source rows also start empty. That starts the window. The same canary runs again right after the final counts are recorded, proving the pipeline was still delivering at close.
  - **Window:** ≥14 consecutive days, spanning ≥1 release, with `cspReports.ttShadow.since` at or before the window start (a later value means the evidence restarted, so the window restarts from it). The live `PI_DASHBOARD_CSP` resolution and server version are recorded.
  - **Blocking outcomes:** `would-block-script`, `would-block-script-url`, `would-throw-html`, `would-alter-html`, `not-evaluated`, `shadow-error`, the persisted `require-trusted-types-for` counters and `dropped` must all be zero over the window, matching `add-trusted-types-shadow-enforce` D7b.
  - **Non-zero handling:** any non-zero count stops the flip. Per-source rows in `GET /api/csp-violations` are captured for triage.
    - A non-zero `would-*` outcome is cleared by a fix change, or by an explicit, doubt-reviewed amendment of this gate that records the accepted sources.
    - A non-zero `not-evaluated` or `shadow-error` has no amendment route. It is fixed upstream (budget resize or classifier fix), and then the window restarts.
  - **Enforce rehearsal:** the visual and enforce E2E specs are green with `forceTtMode(page, "enforce")`.
  - A blocking outcome stops the flip. Its fix (for example a `/plugin-assets/` worker-URL allowlist entry) is a separate change.

- **Default flip.** When neither env nor config sets the mode, it resolves to `enforce`, or to `off` when the baseline CSP mode is `off`.
  - One resolver in `packages/shared` serves the server (`csp.ts`) and the dev-server meta plugin (`packages/client/vite.config.ts`).
  - `createIndexHtmlSender` no longer defaults its meta to `report` (`packages/server/src/lib/index-html.ts:58`); the mode is required.
- **Test and harness alignment.** Specs that assumed the report default either pin their mode or read the baseline header by kind:
  - `tests/e2e/trusted-types-budget.spec.ts`
  - `tests/e2e/csp.spec.ts`
  - `tests/e2e/runtime-plugin-csp-enforce.spec.ts`
  - `tests/e2e/runtime-plugin-remote-and-paired.spec.ts`
  - `tests/e2e/csp-strict-report.spec.ts`
  - any other spec found reading `content-security-policy` as "the" policy

  A new E2E asserts the real unset default with no response interception.
- **BREAKING (security default):** deployments that set neither env nor config get Trusted Types enforced. This includes `PI_DASHBOARD_CSP=enforce` deployments, which are no longer protected from escalation unless they set `report`. Third-party runtime plugins run in the dashboard document and are affected equally. `/apps/*` mounts that set their own `Content-Security-Policy` keep it and receive no Trusted Types directive (`registerCsp` adds only absent header kinds, `csp.ts:154`). Mounts that set none are enforced like any dashboard response. Their violations already reach the persisted `require-trusted-types-for` counter in report mode (the budget spec's `/apps/team/` control step), so the soak covers them.
  - Known limit: `eval`, `new Function` and string timers are not Trusted-Types-routed while the baseline `script-src` keeps `'unsafe-eval'`, a stated non-goal (`docs/research/trusted-types-enforce-results.md` § Findings). The shipped `client-trusted-types` scenario "Script text refused" therefore holds for those three only once `'unsafe-eval'` is removed. Enforcement does refuse script-text DOM sinks and `javascript:` navigations through the `default` policy.

- **Rollback.** `security.trustedTypes: "report"` (in Settings, or by editing `~/.pi/dashboard/config.json` directly if Settings itself were affected) or `PI_DASHBOARD_TRUSTED_TYPES=report`, plus a restart. These are set on the host that runs the dashboard server; a desktop app attached to a remote dashboard follows that remote host's setting. No code revert. This restores Trusted Types behaviour only; if the sibling CSP flip also landed, its own rollback applies separately.

## Capabilities

### Modified Capabilities

- `baseline-content-security-policy`: "Independent Trusted Types mode" default becomes `enforce` (still `off` when the baseline CSP is `off`); scenarios "Default follows an enabled baseline" and "Existing enforce users are not escalated" change accordingly.

## Impact

- Shared: the default branch of `packages/shared/src/trusted-types-mode.ts` (one line).
- E2E/harness: `tests/e2e/trusted-types-budget.spec.ts` (pin report), `tests/e2e/csp.spec.ts`, `tests/e2e/runtime-plugin-csp-enforce.spec.ts`, `tests/e2e/runtime-plugin-remote-and-paired.spec.ts`, `tests/e2e/csp-strict-report.spec.ts`, any other spec reading `content-security-policy` as "the" policy; new `tests/e2e/trusted-types-default.spec.ts`; `docker/compose.test.yml` and `docker/test-up.sh` comments.
- Docs: CHANGELOG BREAKING entry, `docs/architecture.md`, `docs/faq.md`, `enforce-strict-csp-default` proposal sentence "unset TT still follows `report`".
- Carried-over checks: soak evidence (old tasks 1.1–1.4 / test-plan M1), enforce rehearsal incl. `/settings/security` (old F5), post-flip E2E with the mode unset (old 6.2), dev server under enforce (old M2 / 6.3).

## Discipline Skills

- `security-hardening`: enforcing Trusted Types closes the DOM-XSS sink class by default.
- `doubt-driven-review`: compatibility-affecting, hard-to-reverse default; review the soak evidence before the flip stands.
- `observability-instrumentation`: the soak exit is read from the persisted `ttShadow`, `require-trusted-types-for` and `dropped` counters plus the canary liveness check.
- `review-code`: before commit.
