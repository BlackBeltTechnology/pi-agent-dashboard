## Why

Trusted Types is `report` by default and can only be changed with the `PI_DASHBOARD_TRUSTED_TYPES` environment variable. Operators of desktop and remote installs have no configuration-level way to enforce it, or to roll an enforcement back without editing the process environment. The sibling follow-up `flip-trusted-types-default-enforce` will flip the default to `enforce` after a measured soak; it needs a rollback that works for every install type first. This change ships that rollback and the knob, with the default unchanged.

**Scope amendment (2026-10-30).** This change originally also owned the soak gate and the default flip. The soak cannot start until `add-trusted-types-shadow-enforce` is released and then needs ≥14 days, so those parts moved to `flip-trusted-types-default-enforce` (draft stub, blocked by this change). The default flip, E2E/harness alignment, soak evidence and BREAKING CHANGELOG entry are no longer part of this change.

## What Changes

- **Operator knob.** A new `security.trustedTypes: "off" | "report" | "enforce"` key in `~/.pi/dashboard/config.json`, editable in Settings → Security.
  - Precedence: `PI_DASHBOARD_TRUSTED_TYPES` beats config, and config beats the default.
  - A recognized value is trimmed and matched case-insensitively. This also changes how today's values parse (`OFF`, which currently resolves to `report`, becomes `off`); the CHANGELOG states it.
  - A present but unrecognized or non-string value resolves to `report` with one startup warning, following the shipped `hostGate.mode` convention (`openspec/specs/shared-config/spec.md`, `parseHostGateMode`). A mistyped rollback (`reprot`) therefore still relaxes, and the warning makes the typo visible. Every present source is validated, so a config typo under a valid env value is warned about too.
  - A change needs a restart, which `PUT /api/config` reports by comparing values.
  - `GET /api/config` exposes a computed, never-persisted `trustedTypesEnvOverride`, following the `agentPathGateEnvOverride` precedent, so Settings shows when the env var decides.
- **One resolver.** `packages/shared` serves the server (`csp.ts`) and the dev-server meta plugin (`packages/client/vite.config.ts`). With no env or config value the mode resolves exactly as today: `report`, or `off` when the baseline CSP mode is `off`.
  - `createIndexHtmlSender` no longer defaults its meta to `report` (`packages/server/src/lib/index-html.ts:58`); the mode is required, so every document states the resolved mode.
- **Behaviour change, not a default change.** `PI_DASHBOARD_TRUSTED_TYPES` is now trimmed and case-insensitive (`OFF` becomes `off`; it resolved to `report` before) and an unrecognized value logs a startup warning. The CHANGELOG states it.
- **Rollback / opt-in.** `security.trustedTypes` (Settings, or `~/.pi/dashboard/config.json`) or the env var, plus a restart. Set on the host that runs the dashboard server; a desktop app attached to a remote dashboard follows that host.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `baseline-content-security-policy`: "Independent Trusted Types mode" gains the config source and precedence, the no-lockout handling of unrecognized values, dev-server parity and a document-meta / header consistency scenario; adds "Trusted Types mode is configurable through the config API" and "Config API reports an environment override". The default stays `report` (`off` when the CSP is `off`).
- `settings-panel`: adds "Security page exposes the Trusted Types mode" and "Trusted Types control is read-only under an environment override".

## Impact

- Shared: `packages/shared/src/trusted-types-mode.ts` (new resolver), `packages/shared/src/config.ts` (`security.trustedTypes` parse).
- Server:
  - `packages/server/src/auth/csp.ts`: the old `(raw, cspMode)` resolver is removed and re-exports the shared one; module doc.
  - `packages/server/src/server.ts:2315-2317`: resolve with config and warning.
  - `packages/server/src/lib/index-html.ts`: required mode; callers in `csp.test.ts` and `index-html.test.ts` updated.
  - `packages/server/src/config-api.ts`: `security` deep merge, value-compared restart flag, `trustedTypesEnvOverride` dropped on write.
  - `packages/server/src/routes/system-routes.ts`: computed `trustedTypesEnvOverride` on `GET /api/config`.
  - Tests: `csp.test.ts` (call sites move to the object form).
- Client:
  - `packages/client/vite.config.ts`: shared resolver.
  - `packages/client/src/components/settings/SettingsPanel.tsx`: Security select beside `AllowedHostsSection`, `Config` type, `CONFIG_FIELD_PAGE` entry, `computeConfigPartial` diff block.
  - The settings field-contract test.
- E2E: one new spec (Settings → restart glue).
- Docs: `docs/architecture.md` (§ Trusted Types mode, § Baseline CSP), `CHANGELOG.md` `[Unreleased]`, `csp.ts.AGENTS.md`.
- Coordination: the default flip lives in `flip-trusted-types-default-enforce` (blocked by this change).

## Discipline Skills

- `security-hardening`: the no-lockout rule keeps a typo from breaking the UI; no raw config/env value in warnings.
- `observability-instrumentation`: one startup warning per bad source, never per request.
- `review-code`: before commit.
