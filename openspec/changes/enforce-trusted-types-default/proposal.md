## Why

Trusted Types defaults to `report` (`resolveTrustedTypesMode`, `packages/server/src/auth/csp.ts:90-93`), so DOM-XSS sink discipline is measured but not enforced unless an operator sets `PI_DASHBOARD_TRUSTED_TYPES=enforce`. The enforce run (`docs/research/trusted-types-enforce-results.md`) showed core routes, diagrams and editors working under enforcement. Its § Decision names the follow-up: flip the default to `enforce` once real-world telemetry shows enforcement would break nothing. Change `add-trusted-types-shadow-enforce` provides that telemetry. This change owns the measured soak, the default flip, and an operator rollback that works for every install type.

The sibling change `enforce-strict-csp-default` flips `PI_DASHBOARD_CSP` and explicitly leaves the Trusted Types default alone. The two flips are independent, but the soak evidence records which CSP default was live.

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
- **Operator knob.** A new `security.trustedTypes: "off" | "report" | "enforce"` key in `~/.pi/dashboard/config.json`, editable in Settings → Security.
  - Precedence: `PI_DASHBOARD_TRUSTED_TYPES` beats config, and config beats the default.
  - A recognized value is trimmed and matched case-insensitively. This also changes how today's values parse (`OFF`, which currently resolves to `report`, becomes `off`); the CHANGELOG states it.
  - A present but unrecognized or non-string value resolves to `report` with one startup warning, following the shipped `hostGate.mode` convention (`openspec/specs/shared-config/spec.md`, `parseHostGateMode`). A mistyped rollback (`reprot`) therefore still relaxes, and the warning makes the typo visible. Every present source is validated, so a config typo under a valid env value is warned about too.
  - A change needs a restart, which `PUT /api/config` reports by comparing values.
  - `GET /api/config` exposes a computed, never-persisted `trustedTypesEnvOverride`, following the `agentPathGateEnvOverride` precedent, so Settings shows when the env var decides.
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

### New Capabilities

None.

### Modified Capabilities

- `baseline-content-security-policy`: "Independent Trusted Types mode" gains:
  - the config source and its precedence;
  - the no-lockout handling of unrecognized values;
  - the new `enforce` default;
  - dev-server parity;
  - a document-meta / header consistency scenario.

  "Existing enforce users are not escalated" now requires an explicit `report`; OpenSpec keeps the scenario name, its body is the explicit-opt-out case.
- `settings-panel`: adds "Security page exposes the Trusted Types mode".

## Impact

- Shared: `packages/shared/src/trusted-types-mode.ts` (new resolver), `packages/shared/src/config.ts` (`security.trustedTypes` parse).
- Server:
  - `packages/server/src/auth/csp.ts`: the wrapper keeps the `(raw, cspMode)` signature; module doc.
  - `packages/server/src/server.ts:2315-2317`: resolve with config and warning.
  - `packages/server/src/lib/index-html.ts`: required mode; callers in `csp.test.ts` and `index-html.test.ts` updated.
  - `packages/server/src/config-api.ts`: `security` deep merge, value-compared restart flag, `trustedTypesEnvOverride` dropped on write.
  - `packages/server/src/routes/system-routes.ts`: computed `trustedTypesEnvOverride` on `GET /api/config`.
  - Tests: `csp.test.ts` (the report-default and `WE12-14` cases).
- Client:
  - `packages/client/vite.config.ts`: shared resolver.
  - `packages/client/src/components/settings/SettingsPanel.tsx`: Security select beside `AllowedHostsSection`, `Config` type, `CONFIG_FIELD_PAGE` entry, `computeConfigPartial` diff block.
  - The settings field-contract test.
- E2E and harness: the four specs above plus one new spec, the `docker/compose.test.yml:192-194` and `docker/test-up.sh:249-253` comments.
- Docs: `docs/architecture.md` (§ Trusted Types mode, § Baseline CSP), `docs/faq.md:4590`, `CHANGELOG.md` `[Unreleased]` BREAKING entry with rollback, and the `csp.ts.AGENTS.md` and `test-up.sh.AGENTS.md` sidecars.
- Coordination: `enforce-strict-csp-default` (proposal § Default flip) says unset Trusted Types "still follows `report`". Whichever change lands second updates that sentence. If both land, the post-flip E2E runs with both unset.

## Discipline Skills

- `security-hardening`: enforcing Trusted Types closes the DOM-XSS sink class by default. The no-lockout rule keeps a typo from breaking the UI.
- `doubt-driven-review`: the default flip is a compatibility-affecting, hard-to-reverse default. Review the soak evidence before it stands.
- `observability-instrumentation`: the soak exit is read from the persisted `ttShadow`, `require-trusted-types-for` and `dropped` counters plus the liveness check.
- `review-code`: before commit.
