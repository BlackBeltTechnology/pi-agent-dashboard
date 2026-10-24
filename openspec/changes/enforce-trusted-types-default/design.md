## Context

**Server resolution.**
- `resolveTrustedTypesMode(raw, cspMode)` (`packages/server/src/auth/csp.ts:90-93`) returns an explicit `off|report|enforce` by strict `===`. Anything else resolves to `off` when the baseline is `off`, else `report`.
- `server.ts:2315-2317` resolves the mode once at startup and passes it to `registerCsp`.
- `plan()` (`csp.ts:120-138`) appends the directive to the baseline header when the modes match. Otherwise it emits the other header kind carrying the directive alone, labelled `trusted-types`.
- `registerCsp` adds a header kind only when the route has not set it (`csp.ts:152`), so `ctx.serveApp` mounts that set `Content-Security-Policy` get no TT directive.

**Document mode.**
- `createIndexHtmlSender` stamps `<meta name="pi-trusted-types">` with `opts.trustedTypesMode ?? "report"` (`packages/server/src/lib/index-html.ts:58`).
- The client `default` policy reads it (`readTrustedTypesMode`, `packages/client/src/lib/security/trusted-types.ts:62-65`); a missing meta reads as `report`.

**Dev.** `trustedTypesDevPlugin` (`packages/client/vite.config.ts:83-87`) re-implements the env resolution, and is not exported. `vite.config.ts` already imports sibling package sources by relative path (`:13`).

**Config.**
- There is no TT/CSP key today. Precedent `hostGate.mode`: absent → default, unrecognized → `report` so a typo cannot lock the operator out (`packages/shared/src/config.ts:61-75`).
- Settings → Security edits it through `AllowedHostsSection` (`packages/client/src/components/settings/SettingsPanel.tsx:2643-2647`).
- `PUT /api/config` flags a restart only for `RESTART_FIELDS` (`packages/server/src/config-api.ts:111`).

**Tests assuming the report default.**
- `tests/e2e/trusted-types-budget.spec.ts:10-14` (header comment).
- `tests/e2e/csp.spec.ts` reads `content-security-policy` as "the" policy.
- `tests/e2e/runtime-plugin-csp-enforce.spec.ts` skips only when no `content-security-policy` header exists.
- The enforce, visual and perf specs force their mode by interception (`forceTtMode`, `tests/e2e/helpers/trusted-types.ts:92`), so none exercises the real default.

**Soak evidence** comes from `add-trusted-types-shadow-enforce` (persisted `cspReports.ttShadow` with its own `since`; per-source rows in `GET /api/csp-violations`).

## Goals / Non-Goals

**Goals**
- Flip the default to `enforce` (still `off` when the baseline is `off`), only after positive, complete soak evidence.
- A rollback that works by configuration on every install type, including the desktop app.
- One resolution rule, used everywhere a mode is decided or stated.

**Non-Goals**
- Changing the enforce rules, named policies or script-URL allowlist. A blocking soak outcome spawns its own change.
- Removing `'unsafe-eval'`. Flipping `PI_DASHBOARD_CSP` (`enforce-strict-csp-default`).
- Changing the client fallback for a missing meta. It stays `report`. Every document the dashboard or its dev plugin serves states the mode, which D4 tests.
- Live (no-restart) mode switching.

## Decisions

**D1. The soak gate splits into pre-flip and post-flip.** Pre-flip (tasks group 1, before any code) covers the liveness check, the window and counter conditions, and the enforce rehearsal with `forceTtMode(page, "enforce")`. That rehearsal is runnable today (`tests/e2e/trusted-types-visual.spec.ts`, `trusted-types-enforce.spec.ts`). Post-flip (group 5) runs the E2E suite with the mode unset, plus D6. Thresholds are in proposal § What Changes.

**D2. Gate semantics.**
- Every shadow outcome, including `would-alter-html`, `not-evaluated` and `shadow-error`, must be zero, as must the persisted `require-trusted-types-for` counters and `dropped`. This matches upstream D7b.
- A sum-of-rows triage rule was rejected. The per-source rows are in memory, LRU-capped, shed into `overflow`, and not cleared by the reset, so they cannot reconcile with the persisted count.
- A non-zero count stops the flip. The rows are captured for triage, and the flip resumes only through a fix change or a doubt-reviewed amendment of this gate.
- A zero is evidence only between two canary runs:
  - The first canary runs before the reset. The reset is followed by a restart, so both the persisted and the in-memory views start empty.
  - The second canary runs after the final read.
  - Both must show the outcomes they triggered, which proves the released client and server deliver shadow outcomes at the window's start and end.
- `cspReports` is read as a disclosure-permitted local operator (loopback).
- Accepted coupling: `dropped` also counts refused reports of unrelated policies. That can only delay the flip; the sibling gate shares the counter.

**D3. One resolver in `packages/shared`.** `resolveTrustedTypesMode({ env, config, cspMode }): { mode, source, warnings }` lives in `packages/shared/src/trusted-types-mode.ts`.
- Total over `unknown` inputs.
- A source is set when it is not `undefined` and not a whitespace-only string. The first set source in order (env, then config) decides.
- A string that, trimmed and lowercased, is `off`, `report` or `enforce` maps to itself. Any other set value (another string, a number, an object) maps to `report` and adds a warning naming the source (`env`/`config`) without echoing the value. This is the shipped `hostGate.mode` convention (`config.ts:61-75`; `openspec/specs/shared-config/spec.md`).
- Rationale for `report`: the realistic typo is a mistyped rollback (`reprot`), which must still relax.
- Every set source is validated, so a config typo shadowed by a valid env value still warns.
- With no set source, the default applies: `cspMode === "off" ? "off" : "enforce"`.
- The old `csp.ts` `resolveTrustedTypesMode(raw, cspMode)` is removed, not wrapped, so no caller can bypass config. `csp.ts` re-exports the shared function, and its call sites (`server.ts:2316`, the `csp.test.ts` default and `WE12-14` cases) move to the object form.
- `server.ts` resolves once with `loadConfig().security?.trustedTypes`, logs each warning once, and passes the same value to `registerCsp` and `createIndexHtmlSender` (`server.ts:3721`).
- `trustedTypesDevPlugin` imports it by relative path and also reads the config, so dev and production state the same mode for the same environment.
- Replaces the earlier lockstep-test idea: one implementation, nothing to keep in sync.

**D4. The document always states the resolved mode.** `createIndexHtmlSender` takes `trustedTypesMode` as a required option, with no `report` fallback.
- A unit test asserts that for each (CSP mode × TT mode) pair the index-html meta equals the TT mode that `plan()` puts in an enforcing or report-only header.
- An E2E with no interception asserts, under the unset TT default, `content="enforce"` plus an enforcing policy containing `require-trusted-types-for 'script'`. With the live CSP default `report`, that is a separate TT-only enforcing header; with CSP `enforce` (if the sibling flip has landed), the directive is appended to the strict enforcing header. The spec checks whichever holds for the harness's CSP mode.

**D5. Config knob.**
- `security?: { trustedTypes?: unknown }` in `DashboardConfig`. `loadConfig()` builds its result field by field (`config.ts:2760-2811`), so it explicitly copies `parsed.security?.trustedTypes` (raw, unvalidated) into `result.security`. A round-trip test covers it.
- `PUT /api/config` deep-merges `security` (`{ ...existing.security, ...partial.security }`), like the other nested sections, so sibling keys survive. A `trustedTypes: null` in the partial deletes the key, which is how Settings' Default choice clears it; an emptied `security` object is removed. It sets `restartRequired` only when the normalized value differs from the existing one, following the `serverHeap` value-compare pattern (`config-api.ts:397-407`).
- Settings wiring: the client `Config` type (`SettingsPanel.tsx:281` area), a `security: "security"` entry in `CONFIG_FIELD_PAGE` (`:357`), and a `computeConfigPartial` diff block like the `hostGate` one (`:465-466`). The settings field-contract test covers the new field.
- Settings → Security gains one select (Default: Enforce unless CSP is off / Enforce / Report only / Off; Default stores no key) beside `AllowedHostsSection`, following its mode-control pattern, with the restart notice the panel already shows for restart fields.
- An env override is shown as read-only text ("Set by PI_DASHBOARD_TRUSTED_TYPES: <mode>"), because env wins. The data source is a computed `trustedTypesEnvOverride: "off" | "report" | "enforce" | null` on `GET /api/config`. It is derived per request from `process.env`, which is constant for the process, following `agentPathGateEnvOverride` (`system-routes.ts:468-475`), and deleted from every write (`config-api.ts:472-474`). The select itself shows the saved config value, with the panel's restart notice.

**D6. Header shape follows from existing `plan()` logic.** No change to `plan()`.
- Unset TT with an unset CSP gives TT `enforce` against a `report` baseline. An enforcing header carrying the directive alone, labelled `trusted-types`, appears on dashboard responses outside the skipped prefixes (`/live/` etc.) that have not set their own `Content-Security-Policy`.
- Unset TT with `PI_DASHBOARD_CSP=enforce` matches modes, so the directive is appended to the strict enforcing header.
- Consequence for tests: a spec that reads `content-security-policy` as the baseline must select by kind and content (`report-only` + `default-src`) or pin its mode.

**D7. Budget and report-mode specs pin report; header readers select by kind.** A `grep -l content-security-policy tests/e2e/*.spec.ts` sweep is part of the task, so specs not named here are aligned too. Guard replacements:
- `runtime-plugin-remote-and-paired.spec.ts:54-55` skips on any CSP → skip only when the enforcing header carries a `connect-src` directive.
- `runtime-plugin-csp-enforce.spec.ts:19-20` runs when any enforcing header exists → run only when the enforcing header carries `script-src`.
- `csp.spec.ts` selects the baseline policy by kind and the presence of `default-src`.
- Skip counts before and after the flip are compared in the post-flip run.
- `runtime-plugin-csp-enforce.spec.ts` also gains a TT-enforce case: a trusted runtime plugin claim renders with zero CSP and TT violations. This covers "Runtime plugin loading fits the baseline policy" under the new default. `trusted-types-budget.spec.ts` and `csp-strict-report.spec.ts` (WF4) pin `forceTtMode(page, "report")` per page, matching the `client-trusted-types` "Measured violation budget" requirement ("with Trusted Types in report mode"). `csp.spec.ts` and `runtime-plugin-csp-enforce.spec.ts` select the baseline/strict header by kind instead of "first CSP header".

**D8. Rollback is configuration.** `security.trustedTypes: "report"` in Settings or the file, or the env var, plus a restart. The CHANGELOG BREAKING entry names both.

## Risks / Trade-offs

- **Third-party runtime plugins** may create workers from `/plugin-assets/` or pass script text. The soak counts these as `would-block-*`, and any non-zero blocks the flip.
- **Low-traffic routes** escape the soak. The enforce, visual and budget E2E specs cover core routes, previews, settings and plugin settings pages. `/apps/*` mounts with their own CSP are not TT-enforced by this flip (D6).
- **`eval` / `new Function`** stay allowed under `'unsafe-eval'`. This is a stated known limit, revisited with the CSP tightening.
- **Single-deployment soak.** The window may be satisfied by one maintainer instance. The evidence records the deployment count, and the reviewer of the flip decides whether that suffices.
- **Typo handling** maps to `report` (weaker, no lockout) with a warning, so a mistyped rollback still relaxes. A typo while trying to tighten leaves `report`, and the warning makes that visible.
- **Budget-driven `not-evaluated`:** if real traffic exceeds the upstream classification budget, the gate cannot pass until the budget is resized upstream and the window restarts.
- **Electron** loads the same server document and enforces by default. Desktop rollback is via Settings (D5). If Settings itself were affected, rollback is a direct edit of `~/.pi/dashboard/config.json` plus a restart. The enforce rehearsal includes the Settings Security page.
- **Dev server under enforce:** the Vite HMR client and error overlay run in the dashboard document. A dev smoke under enforce is part of the post-flip verification.
- **Scenario name:** "Existing enforce users are not escalated" keeps its name because the validator requires existing scenario names in a MODIFIED block. Its body is now the explicit-opt-out case.

## Migration Plan

1. Release `add-trusted-types-shadow-enforce`. Run the liveness check, reset, then soak for ≥14 days across ≥1 release (group 1).
2. Record the evidence and stop if the gate fails.
3. Land the resolver, knob, flip, spec alignment and docs. Run the post-flip E2E with the mode unset (and with the CSP mode unset too if the sibling has landed).
4. Rollback: Settings / config `security.trustedTypes: "report"` or the env var, plus a restart.

## Open Questions

None.
