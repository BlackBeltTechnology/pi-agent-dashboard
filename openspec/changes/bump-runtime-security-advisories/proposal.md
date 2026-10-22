## Why

During planning of `close-residual-audit-findings` (B26r advisory triage),
`pnpm audit` found advisories that the running dashboard can actually reach.
The most serious one is in the server's own direct dependency:

- **fastify 5.12.1** (the lockfile resolves `packages/server/package.json:96`
  `"fastify": "^5.0.0"` to it): GHSA-p68q-wchp-6fh7 (auth bypass), plus three
  more high advisories. Fixed in ≥ 5.12.5.
- **nodemailer**, reached through `mailparser` 3.9.14
  (`packages/server/package.json:103`). An addressparser denial of service,
  reachable through the `.eml` preview.
- **linkify-it**, reached through `ansi-to-react`
  (`packages/client/package.json:73`). A client-side denial of service.

These are dependency bumps with no behaviour change, so they ship now as a
standalone fix. They do not wait for the larger audit-closure change, which is
blocked on `close-loopback-legacy-window` and on a CSP soak.

This is a scoped stub. Plan it with `plan-proposal` (or fast-path it) before
implementation.

## What Changes

- Raise the lockfile resolution of `fastify` to ≥ 5.12.5 across the workspace.
  Many plugin packages declare `"fastify": "^5.0.0"` as a dev or peer
  dependency, so the server and all of them must resolve to one patched version.
- Bump `mailparser` (or add a pnpm override for `nodemailer`) to a release
  that pulls a patched nodemailer.
- Bump `ansi-to-react`, or add a pnpm override for `linkify-it`, to a patched
  version.
- Re-run `pnpm audit` and confirm none of these advisories still apply.
  Record any remaining runtime-reachable advisory with its reason in
  `close-residual-audit-findings/advisory-triage.md`.
- Also look at the lower-risk runtime paths found in the same audit, and bump
  them when the bump is a patch-level upgrade:
  - undici via `@fastify/http-proxy`
  - node-forge and follow-redirects via `acme-client`
  - fast-uri via fastify's ajv

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The bumps are dependency-only and do not change any specified
behaviour.

## Impact

- Files: `pnpm-lock.yaml`, `packages/server/package.json`,
  `packages/client/package.json`, and possibly a `pnpm.overrides` block in the
  root `package.json`.
- Compatibility: these are patch or minor bumps inside fastify 5. Run the full
  vitest suite plus the docker E2E smoke, because fastify patch releases have
  changed hook and route-matching edge cases before.
- Rollback: revert the lockfile and package.json commit.
- Related: `close-residual-audit-findings` (B26r) records the triage and points
  here for the fixes.

## Discipline Skills

- `security-hardening`: the purpose of the change is closing reachable
  advisories, including an auth bypass.
- `doubt-driven-review`: the fastify bump touches the request pipeline that
  every auth hook runs in. Check that guard, CORS and rate-limit behaviour is
  unchanged before it lands.
