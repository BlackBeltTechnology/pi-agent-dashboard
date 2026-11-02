# Design

## Context

See proposal.md § Why. Current state, shipped by the archived
`2026-10-23-harden-cors-and-csp-reporting` (commit `f426a45b5`, not yet in a
release tag: `v0.10.0` predates it):

- `resolveCspMode` (`packages/server/src/auth/csp.ts:82-85`) accepts exact
  `enforce` / `off`; everything else, unset and `""` included, resolves to
  `report`. Its single caller, `packages/server/src/server.ts:2315`, resolves
  once at boot from `process.env.PI_DASHBOARD_CSP`.
- `plan()` in `csp.ts` maps mode → headers: `report` = baseline + strict, both
  Report-Only; `enforce` = strict enforced (production) or baseline enforced
  (Vite-proxied dev responses); `off` = nothing.
- `resolveTrustedTypesMode(raw, cspMode)` (`csp.ts:90-93`): unset TT → `off`
  iff CSP `off`, else `report`. With CSP `enforce` + TT `report` the modes
  differ, so the TT directive rides alone on a separate Report-Only header
  labelled `trusted-types` (covered by the `WE14: TT directive topology across
  the mode matrix` block, `packages/server/src/__tests__/csp.test.ts:430`).
  `packages/client/vite.config.ts:83-86` re-derives the dev TT meta from
  `PI_DASHBOARD_CSP`, but only checks for `off`, so the flip does not change it.
- Soak evidence: persisted `~/.pi/dashboard/csp-reports.json` (`policy ×
  effective-directive` counts, `dropped`, `since`, document-path breakdown),
  read via `GET /api/health` → `cspReports` (disclosure-permitted callers),
  reset via `POST /api/csp-reports/reset`. `connect-src` and `img-src` are in
  `CSP_DIRECTIVE_ALLOW_SET` (`packages/server/src/auth/csp-report-store.ts:44-68`),
  so the widened gate needs no new instrumentation. The counters are per
  install; nothing is uploaded.
- `cross-origin-client`: the browser client mints its WS ticket with
  `fetch(${getApiBase()}/api/ws-ticket)` (`packages/client/src/lib/pairing/device-auth.ts:514`)
  and pairs / rotates over REST. Enforced `connect-src 'self' ws: wss:` refuses
  all of these when the API base is another origin.
  `tests/e2e/runtime-plugin-remote-and-paired.spec.ts:56-58` (F14) and AF1–AF5
  already skip when an enforcing header is present.
  `tests/e2e/known-server-stale-name.spec.ts` drives an in-page known-server
  switch through a Playwright route (`proxyToHarness`); the browser applies
  `connect-src` before the route sees the request, so it needs the report lane
  too. `VITE_API_URL` (`packages/client/src/lib/api/api-context.ts:44`, used at
  `App.tsx:496`) sets a cross-origin API base at build time.
- Production docker: `docker/compose.yml` does not pass `PI_DASHBOARD_CSP` into
  the container (only `compose.test.yml:191` does), so a docker install has no
  env rollback today.
- E2E harness: `docker/test-up.sh:252` and `docker/compose.test.yml:191` pass
  `PI_DASHBOARD_CSP` through as `""` when unset, so the harness boots on the
  server default via the empty-string path. Playwright's managed mode
  (`tests/e2e/global-setup.ts`) boots its own harness unless
  `PW_E2E_USE_RUNNING=1`.
- CI: `.github/workflows/ci-e2e-browser.yml` never sets `PI_DASHBOARD_CSP`.
  Today the enforce-lane specs always skip in CI. Variant-harness jobs exist
  for other env-dependent specs (`e2e-browser-relay`, line ~198).

Sibling: `enforce-trusted-types-default` flips the TT default independently
and edits the same files.

## Goals / Non-Goals

**Goals:**
- Gate the flip on recorded soak evidence (proposal § Soak gate) before any code changes.
- One-line default change in `resolveCspMode`; every other mode path unchanged.
- Rollback by environment + restart only, with a documented, verified procedure per install type.
- Keep automated coverage of the report-only lane and the cross-origin topology after the default changes, locally and in CI.

**Non-Goals:**
- Widening `connect-src` / `img-src` for cross-origin switching (D2).
- Any Trusted Types default change (owned by `enforce-trusted-types-default`).
- Removing `'unsafe-inline'` from `style-src`, or `'unsafe-eval'` from the dev baseline.
- Case-insensitive or trimmed parsing of `PI_DASHBOARD_CSP` (D3).
- A config-file / Settings knob for the CSP mode.
- Cutting the release that starts the soak (release process, `release-cut`).

## Decisions

### D1: Flip in the resolver, not at the call site
`resolveCspMode` returns `enforce` for unset / unrecognized values. `server.ts`
keeps calling it with the raw env.
- Alternative: default at the call site (`process.env.PI_DASHBOARD_CSP ?? "enforce"`). Rejected: unrecognized values would still fall to `report`, contradicting the spec, and the resolver's tests would no longer describe the default.
- `resolveTrustedTypesMode` is untouched.

### D2: Cross-origin switching: accept, document, sign off; do not widen
The strict and baseline policies keep `connect-src 'self' ws: wss:` and
`img-src 'self' data: blob:`. The switcher stops working from an enforcing
host (WS ticket mint, pairing, rotation, REST, images). A host whose page
drives another dashboard sets `PI_DASHBOARD_CSP=report`.
- Alternative: widen to `http: https:`. Rejected: it removes the exfiltration limit that justifies enforcing at all.
- Alternative: block on a server-side origin allowlist change. Rejected by the operator for this change; it can follow if demand appears.
- The soak gate requires an explicit operator sign-off on the switcher breakage. Strict `connect-src` / `img-src` violations from the listed switcher flows are excluded only by a sign-off naming the flow and document path; any other strict violation blocks (proposal § Soak gate).
- Electron is unaffected for switching: with the open-server-window capability the client opens the target server in its own window on that server's origin instead of switching in-page (`openspec/specs/server-selector/spec.md` "Electron opens a server window instead of switching in-page"); its local window ignores a saved remote (`getInitialWsUrl`, `packages/client/src/lib/api/server-switch.ts`).
- A `VITE_API_URL` build is affected only when a dashboard host serves it; any other static host applies its own CSP.
- `cross-origin-client` gains an ADDED requirement: its cross-origin requirements describe client behaviour, exercisable end to end only from a `report` / `off` serving host. It qualifies the shipped requirements without contradicting them (the client still prefixes, mints and rotates; the browser refuses under the host's policy), so no MODIFIED delta is needed.

### D3: Keep exact-match parsing; warn on set, non-empty, unrecognized values
Parsing stays exact and case-sensitive, as the delta spec states. New: a pure
helper in `csp.ts` (`cspModeWarning(raw)`, returning the warning text or
`undefined`) decides whether to warn. The text names `PI_DASHBOARD_CSP`, the accepted values `off|report|enforce` and the resolved mode, and never echoes the raw value (operator decision; parity with the TT sibling; an env value may carry control characters); `server.ts` logs its result once, next
to `resolveCspMode` at boot. Keeping the decision pure makes it unit-testable
in `csp.test.ts` without booting a server. A mistyped rollback (`REPORT`,
`reprot`) then enforces, and the warning makes that visible in `server.log`.
- `""` resolves to `enforce` with no warning. `""` is how the docker harness and compose files pass "unset" (`test-up.sh:252`), so warning on it would fire on every default harness boot. Unset and `""` behave identically.
- Alternative: trim + case-insensitive match. Rejected: changes the shipped WE15 parse table and widens scope.
- Alternative: unrecognized → `report` (no-lockout, as `enforce-trusted-types-default` chose for its own variable). Rejected: contradicts this change's spec delta and lets a typo silently disable enforcement. The two variables therefore fail in opposite directions on a typo: CSP fails closed (enforce + warning), TT fails open (report + warning). The CHANGELOG entry and `docs/architecture.md` state both rules side by side.

### D4: E2E lanes and CI after the flip
- Lane commands use Playwright managed mode with the env on the Playwright process (`PI_DASHBOARD_CSP=… PI_E2E_SEED=1 npx playwright test <specs>`). A bare `npm run test:e2e` after a manual `docker/test-up.sh` would boot a second, managed harness; `PW_E2E_USE_RUNNING=1` is the alternative when a harness is already up.
- Default lane (unset): enforcing. `csp-strict-enforce.spec.ts` and `runtime-plugin-csp-enforce.spec.ts` run without an explicit env. The true-unset default is asserted at L1 (D1 tests plus the default-wiring test); the E2E default lane covers the `""` path the harness uses.
- Report lane: `PI_DASHBOARD_CSP=report`. `csp-strict-report.spec.ts` plus the cross-origin members. Provisional members: `runtime-plugin-remote-and-paired.spec.ts` (F14, AF1–AF5; already guarded) and `known-server-stale-name.spec.ts` (unguarded); task 3.1 confirms membership by running each candidate under `enforce`, and the soak's enforce run (task 1.5) records any expected failures among them. Each member skips under an enforcing header with a message containing `PI_DASHBOARD_CSP` and naming the report lane; the existing guards at `runtime-plugin-remote-and-paired.spec.ts:58` and `:202` lack the token and are rewritten.
- CSP-lane skip reason: every lane guard's skip message contains `PI_DASHBOARD_CSP`. Pre-existing unrelated conditional skips (for example `known-server-stale-name.spec.ts:260`, two harness aliases) do not contain it.
- Zero-skip check: lanes run with `--reporter=blob,json` and `PLAYWRIGHT_JSON_OUTPUT_NAME=<file>`; `scripts/e2e-csp-lane-check.mjs <report.json> [--allow <comma-separated spec basenames>] [--require <comma-separated spec basenames>]` (no flag = empty list) walks the report's suites → specs → tests, and fails when the report holds 0 tests, when a `--require`d spec is absent, when `stats.unexpected > 0`, or a test in a spec outside the allow-list has a skipped result with a `skip` annotation whose description contains `PI_DASHBOARD_CSP`. Its test fixture is captured from the installed Playwright's real JSON reporter output, so the field shape is not assumed. `--reporter=list` alone exits 0 on skips. In the report lane, every member must report no CSP-reason skip; in the enforce lane, only report-lane members may.
- Report-lane membership: specs found by sweeping `tests/e2e/**/*.ts` (helpers included) for `proxyToHarness`, `LAST_SERVER_KEY`, `API_ORIGIN`, a second loopback origin (`127.0.0.1:` or `localhost:` with a port other than the page's), confirmed by running each candidate under `enforce` and observing a refused request. That run also settles whether a Playwright route fulfils a request before CSP is applied; the guard is fail-safe either way.
- CI: new job `e2e-csp-report-lane` in `ci-e2e-browser.yml`, modelled on `e2e-browser-relay` (same label gate, managed mode, own runner and harness), runs the report-lane members with `PI_DASHBOARD_CSP=report` and the zero-skip check. The 18-shard matrix keeps the default (enforce) lane, where the report-lane members skip. The job sets job-level `timeout-minutes` and the PR-path `continue-on-error` like its siblings, which `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts` enforces; that test is the workflow check. On PRs the job is advisory, like its siblings; its blocking verification is a `workflow_dispatch` run of `ci-e2e-browser.yml` on the change branch, which also proves the 18-shard matrix green under the new default.

### D5: Rollback procedure is verified, not assumed
`pi-dashboard restart` delegates to `/api/restart` when a dashboard is up
(`packages/server/src/cli.ts:861-864`). Whether the restarted process sees a
`PI_DASHBOARD_CSP` set in the caller's shell, or the old server's environment,
is unverified. A task verifies it per install type (CLI foreground, CLI
daemon, service, Electron, docker) and fails if any type has no working path.
Until a type is proven, the documented rollback is `pi-dashboard stop`, then
start with the new value; `restart` is documented only for types where the
task shows it picks up the change. Production docker gains
`PI_DASHBOARD_CSP: "${PI_DASHBOARD_CSP:-}"` in `docker/compose.yml`, so the
rollback there is `.env` + `docker compose up -d`, documented in `docker/README.md`.

### D6: Trusted Types sibling coordination
- The default-wiring test derives the expected TT header shape by calling the TT resolver exactly as `server.ts` does at the time of implementation (today `resolveTrustedTypesMode(undefined, resolveCspMode(undefined))`; after the sibling, its shared resolver with env and config sources unset) instead of hard-coding `report`, so it holds whichever default the sibling ships.
- Code-merge order: the second change to land rebases on the first; `related` keeps them in the same scheduling wave without a blocking edge.
- The coordination edit in the sibling's proposal is plain prose, never a labelled line naming this change in backticks, so dependency inference does not create a blocking edge.
- This change owns the cross-reference whichever order they land in: if the sibling is still active, update its proposal's Coordination bullet to state the CSP default is now `enforce`; if it already landed, update this change's TT wording and docs (via DocScribe) to its shipped default. Both `dependencies.yaml` files list each other under `related`.
- Soak windows: the TT mode is recorded at open and close; a mid-window change restarts this window (proposal § Soak gate).

### D7: Docs and comments carry the new default
Each task group updates the docs its own work changes:
- resolver and rollback (group 2): `csp.ts` module doc (`csp.ts:7-10`, `:35`), `server.ts:2309-2311` comment (also drop its stale `/editor` skip claim; `SKIP_PREFIXES` is `["/live/"]`, `csp.ts:46`), `csp.test.ts:42-46` and `:452` titles, `csp.ts.AGENTS.md`, `docs/architecture.md` § Baseline CSP (via DocScribe), `CHANGELOG.md` `[Unreleased]` BREAKING entry;
- harness, lanes, CI (group 3): `docker/test-up.sh:249`, `docker/compose.test.yml:189-190`, `docker/compose.yml` comment, CSP E2E spec header comments and skip messages, the `test-up.sh.AGENTS.md` / `compose.test.yml.AGENTS.md` / `tests/e2e/AGENTS.md` rows, and the `docs/faq.md` "CSP enforce + OAuth real-gate E2E lanes" entry rewritten in full (via DocScribe).

Verification is a fixed file list with anchored patterns, not a repo-wide grep.
`openspec/changes/add-android-server-host/design.md:45,294` is another active
change's artifact; its owner is notified and the outcome recorded, without
editing it here.

## Risks / Trade-offs

- [An inline script or plugin bundle unseen during the soak stops running] → strict `script-src*` = 0 over ≥14 days on released builds; rollback is env + restart.
- [The soak sample is the operator's own installs, not the user base] → accepted trade-off; the sign-off names the contributing installs. Rollback stays cheap.
- [Cross-origin server switcher stops working] → accepted (D2); required sign-off; release notes list the flows and the `report` rollback.
- [`dropped` > 0 blocks the flip and is forgeable: the sink is unauthenticated and tunnel users share the `127.0.0.1` bucket] → fail-safe, since inflation only delays the flip. A non-zero `dropped` restarts the window after the source is identified. Evidence from a tunnel-exposed install may never qualify; the sign-off may draw on non-tunnel installs only.
- [Vite `--dev` responses switch from report-only to enforced baseline] → baseline keeps `'unsafe-inline'` / `'unsafe-eval'` and `ws:`; a dev-mode smoke test is a task. Rollback for dev is the same env.
- [A mistyped rollback value enforces instead of relaxing] → D3 startup warning; docs show the exact lowercase values and the opposite TT rule.
- [A rollback set in the wrong environment is silently ignored] → D5 verification task and per-install-type docs.
- [Report lane loses coverage once it is not the default] → D4 CI job with zero-skip assertion.
- [A strict violation comes from a browser extension, not dashboard code, and blocks the gate forever] → the counter has no source class; triage by document path and a clean-profile reproduction, with a recorded exclusion sign-off (proposal § Soak gate).
- [Docker installs cannot roll back] → D5 compose passthrough.
- [An idle install passes the zero-count gate without exercising anything] → dated exercise checklist at open, mid-window and close (proposal § Soak gate).
- [A dead report pipeline looks like zero violations] → liveness canary at open and close: in a report-mode page, append an inline `<script>` from DevTools; the strict `script-src-elem` count must rise. At open it runs before the reset; at close after the final counts are recorded.
- [Real reports refused as malformed (400) or wrong type (415) are counted nowhere] → accepted: browsers send well-formed reports, the canary proves delivery, and the predecessor's spec keeps those refusals uncounted.
- [`off` as rollback also disables Trusted Types while its variable is unset] → docs name `report` as the rollback.
- [Sibling TT change lands mid-window or in between] → D6.

## Migration Plan

1. Soak (tasks § 1): after a release containing `f426a45b5` exists, reset counters, record open state, run ≥14 days spanning ≥1 release, record close state and sign-offs, run the enforce-lane E2E. Any blocking non-zero stops the flip; its fix is a separate change, after which the window restarts.
2. Code: resolver default + startup warning + tests; harness / E2E / CI alignment; docs and CHANGELOG.
3. Release: notes state the new default, the rollback and where to set it, and the cross-origin switcher flows.
4. Rollback: stop the server, start it with `PI_DASHBOARD_CSP=report` (strict back to report-only, baseline report-only again) in its environment (D5). No data migration; the counter file is unchanged and keeps counting under any mode.

Compatibility: explicit `off` / `report` / `enforce` deployments see no change. Only unset, `""` or unrecognized values change behaviour.
