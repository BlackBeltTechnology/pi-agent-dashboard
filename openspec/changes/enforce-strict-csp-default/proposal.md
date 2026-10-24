## Why

`harden-cors-and-csp-reporting` (S3b) ships the strict nonce-based CSP, a
baseline report sink and a persisted violation counter, but keeps the CSP
default at `report`: both the baseline and the strict policy are report-only,
and `enforce` (strict policy enforced) is opt-in via `PI_DASHBOARD_CSP=enforce`.
Enforcing by default before real-world evidence could break inline bootstrap
code or plugin bundles. This change owns the measured soak and the default flip.

## What Changes

- **Soak gate (tasks, before any code change).** On released builds, all must
  hold, recorded as evidence in tasks.md:
  - **Release:** a release tag containing `harden-cors-and-csp-reporting`
    exists (none does yet; this change stays blocked until it does). The open
    and close builds are different release tags, both containing it, so the
    window spans ≥1 release. The health `serverVersion` equals each tag
    without its leading `v`.
  - **Liveness canary:** at open, before the reset, and at close, after the
    final counts are recorded, one deliberately triggered strict
    `script-src-elem` violation must appear in `cspReports`. A pipeline that
    cannot be shown to deliver blocks the flip.
  - **Window:** opens with `POST /api/csp-reports/reset`; `cspReports.since`
    is within 60 s of the reset at open and unchanged at close (a later `since`
    means the evidence restarted, so the window restarts). ≥14 consecutive
    days.
  - **Exercise:** the install is in real use during the window. An exercise
    checklist (dashboard load, a runtime plugin claim, a diagram / editor
    surface, the passkey login page) is run and dated at open, mid-window and
    close, with the browsers used.
  - **Blocking counts:** every `strict`-label counter except
    `require-trusted-types-for` is zero over the window, and the persisted
    `dropped` (limiter, size cap, body deadline) is zero. A non-zero strict
    count is triaged by document path: a violation that reproduces only with a
    browser extension enabled, and not in a clean profile, may be excluded by a
    recorded sign-off naming it; any other non-zero count stops the flip until
    a fix lands and the window restarts. Strict `connect-src` / `img-src`
    violations produced by the accepted cross-origin switcher flows (below)
    may be excluded by a recorded sign-off naming the flow and document path.
    All zero checks read the snapshot taken before the closing canary.
    Malformed or wrong-type reports
    (400 / 415) are not counted anywhere; that gap is accepted.
  - **Trusted Types:** `require-trusted-types-for` counts never count toward
    this exit. The resolved TT mode is recorded at open and close; if it
    changes mid-window (for example `enforce-trusted-types-default` lands),
    the window restarts.
  - **E2E:** Playwright green against the docker harness with
    `PI_DASHBOARD_CSP=enforce`, run unmodified from a checkout of the close
    tag. A failure counts as an expected report-lane failure, not a gate
    failure, only when the failing spec issues a cross-origin request and its
    error is a CSP refusal; it is recorded as a report-lane member. Every other
    failure blocks.
  - **Sign-off:** the operator records the contributing installs (counters are
    local to each install, so the sample is the operator's own installs and is
    accepted as such), acceptance of the cross-origin switcher breakage (below),
    any switcher-flow and extension-only exclusions, and the expected
    report-lane failures.

  The non-`script-src` directives, the canary, the exercise checklist and the
  switcher sign-off extend the exit that `harden-cors-and-csp-reporting`
  handed off; the extension is deliberate.
- **Default flip.** Unset or unrecognized `PI_DASHBOARD_CSP` resolves to
  `enforce` instead of `report` (`resolveCspMode` in
  `packages/server/src/auth/csp.ts`). Parsing stays exact and case-sensitive;
  the server logs one startup warning for a set, non-empty, unrecognized value.
  Trusted Types mode resolution (`resolveTrustedTypesMode`, same file) is
  unaffected: unset TT follows `report` unless the CSP mode is `off`, until
  `enforce-trusted-types-default` changes that. Release notes name the
  rollback.
- **Rollback.** Stop the server, then start it with `PI_DASHBOARD_CSP=report`
  in its environment (strict back to report-only). No code revert. `off` also
  works but disables the baseline CSP and, while `PI_DASHBOARD_TRUSTED_TYPES`
  is unset, Trusted Types too; docs name `report` as the rollback. Whether
  `pi-dashboard restart` alone picks up a changed value is verified per install
  type; until then the documented procedure is stop + start. The production
  `docker/compose.yml` gains a `PI_DASHBOARD_CSP` passthrough so docker
  installs have the same knob.
- **Cross-origin server switching (accepted, documented).** A browser page
  served by an enforcing dashboard whose API base is another origin
  (`cross-origin-client`) needs cross-origin `fetch` and images. The enforced
  `connect-src 'self' ws: wss:` and `img-src 'self' data: blob:` refuse them,
  which breaks:
  - WS ticket minting (`/api/ws-ticket`), and so the authenticated socket;
  - pairing and bearer rotation (`/api/paired-devices/rotate`);
  - the in-page known-server switch, whose signed identity challenge is a
    cross-origin `fetch`;
  - every other REST call, including plugin `fetch("/api/...")` calls the
    host rewrites to the remote API base, and every remote image;
  - a `VITE_API_URL` build pointing at another origin, when that build is
    served by a dashboard host (a build served by any other static host gets
    that host's CSP, not this one).

  The switcher is therefore unusable from a page served by an enforcing host.
  This change does not widen the policy. A host whose page is used to drive
  another dashboard runs `PI_DASHBOARD_CSP=report`; release notes list the
  broken flows, and `cross-origin-client` gains a requirement stating it. The
  Electron app is unaffected for switching: with the open-server-window
  capability it opens the target server in its own window on that server's
  origin instead of switching in-page (`server-selector` requirement "Electron
  opens a server window instead of switching in-page"), and its local window
  ignores a saved remote (`getInitialWsUrl` in
  `packages/client/src/lib/api/server-switch.ts`).
- **CI coverage of the report lane.** CI never sets `PI_DASHBOARD_CSP`, so
  after the flip the report-lane specs would skip in every shard. Every E2E
  spec that needs a cross-origin request (`runtime-plugin-remote-and-paired`,
  `known-server-stale-name`, any other found by a sweep) skips under an
  enforcing header with a skip message containing `PI_DASHBOARD_CSP` and joins
  the report lane. A new `ci-e2e-browser.yml` job boots one harness with
  `PI_DASHBOARD_CSP=report`, runs `csp-strict-report.spec.ts` plus those specs,
  and fails if any test is skipped for a CSP-lane reason. Like its sibling
  jobs it is advisory on pull requests (`continue-on-error`, required by the
  workflow contract test) and blocking on dispatch and scheduled runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `baseline-content-security-policy`: in "Staged CSP mode resolution", the
  default for unset or unrecognized values changes from `report` to `enforce`,
  and a mistyped value logs one startup warning. Explicit `off` / `report` /
  `enforce` are unchanged. Delta:
  `specs/baseline-content-security-policy/spec.md` restates that one
  requirement in full, keeps its four scenarios with updated defaults, and
  adds four: explicit `report` stays available as rollback, a mistyped value
  warns once at startup, unset or empty does not warn, and the default
  enforces the strict policy on dashboard-owned responses. The capability's
  Purpose line ("observed in report-only mode before being enforced") stays
  accurate as history and is not changed.
- `cross-origin-client`: ADDED "Cross-origin API base depends on the serving
  host's CSP mode": the capability's cross-origin requirements describe client
  behaviour, exercisable end to end only when the dashboard that served the
  page runs `PI_DASHBOARD_CSP=report` or `off`; under `enforce` the browser
  refuses the requests and the policy is not widened. Delta:
  `specs/cross-origin-client/spec.md`.

## Impact

- Server: `packages/server/src/auth/csp.ts` (mode resolution default and the
  warning text), `packages/server/src/server.ts` (logs the warning once), and
  their tests.
- Users: the strict `script-src` (no `'unsafe-inline'` / `'unsafe-eval'`) and
  the rest of the strict policy are enforced by default; an unseen inline
  script stops running. Vite dev mode keeps its carve-out (no strict policy;
  defined by `harden-cors-and-csp-reporting`), but Vite-proxied dev responses
  now carry the baseline policy as an enforcing header instead of report-only.
- Users of the browser cross-origin server switcher: the switcher stops
  working (flows listed above) unless the serving host sets
  `PI_DASHBOARD_CSP=report`.
- Docker installs: `docker/compose.yml` passes `PI_DASHBOARD_CSP` through.
- E2E harness and CI: an unset `PI_DASHBOARD_CSP` now boots enforcing; the
  report lane (`csp-strict-report.spec.ts`, the cross-origin specs) runs with
  an explicit `PI_DASHBOARD_CSP=report`, locally and in the new CI job.
- Docs: release note and CSP mode docs state the new default, the rollback,
  where to set it, and the cross-origin switcher requirement.
- Coordination: `enforce-trusted-types-default` edits the same files
  (`csp.ts`, `csp.test.ts`, CSP E2E specs, `docs/architecture.md`,
  `docs/faq.md`) and its proposal states this change's TT wording. This change
  owns updating that cross-reference whichever lands first; the second to land
  rebases on the first. Both `dependencies.yaml` files list each other under
  `related`. `add-android-server-host/design.md` states the old `report`
  default.
- Depends on `harden-cors-and-csp-reporting` (sink, counter, strict policy,
  `enforce` semantics). See `dependencies.yaml`.

## Discipline Skills

- `security-hardening`: enforcing the strict CSP closes the S3b XSS-mitigation
  gap.
- `doubt-driven-review`: the default flip is compatibility-affecting; review
  the soak evidence before it stands.
- `observability-instrumentation`: the soak exit is read from the persisted
  violation and `dropped` counters behind a liveness canary; the startup
  warning surfaces a mistyped mode.
