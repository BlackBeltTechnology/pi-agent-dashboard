## Why

Split out of `close-residual-audit-findings` (which closes `security-boundary-audit`) so the CORS and CSP-reporting items ship and archive independently of the larger umbrella. Four findings belong together:

- **B19 + R2** both live in `auth/cors-origin.ts`: the zrok wildcard read path and tunnel-URL origin normalization share one comparison seam and one `server-cors` delta.
- **S3b** builds the baseline CSP report sink, the persisted counter and the strict nonce policy. The CSP default stays `report`; the flip to `enforce` is owned by `enforce-strict-csp-default`. `add-trusted-types-report-only` also needs this sink.
- **B26r** is triage-only documentation. It sits here because the `xlsx` pin and the advisory classification are a supply-chain check that gates nothing else.

Unlike the rest of the umbrella, these items carry no auth or storage migration, so they can land first. Planned with `plan-proposal`.

## What Changes

- **B19 · Narrow the zrok CORS read path.** `auth/cors-origin.ts:156` admits any
  `*.share.zrok.io` origin on the read path (`allowZrokWildcard !== false`).
  Admission (`:259`) is already narrowed. Narrow the read path to the active
  tunnel host. Needs a MODIFIED delta on `server-cors`: its spec keeps the
  blanket zrok match "untouched" (`openspec/specs/server-cors/spec.md:105-112`).
- **R2 · Tunnel-URL origin normalization.** The register flags tunnel-URL
  normalization in `auth/cors-origin.ts` (`:59` at audit time). Compare
  case-, port- and trailing-dot-normalized origins against the active tunnel
  URL, and add tests for each variant.
- **S3b · Strict CSP: instrumentation and policy.** `packages/server/src/auth/csp.ts:36` ships
  report-only and keeps `'unsafe-inline'` / `'unsafe-eval'` in `script-src`.
  `sanitize-untrusted-rendered-content` put enforcement out of scope. Highest-risk
  item: enforcing can break Vite dev, inline bootstrap, and plugin bundles. Needs
  a MODIFIED delta on `baseline-content-security-policy`, whose spec mandates the
  current `script-src` (`openspec/specs/baseline-content-security-policy/spec.md:50-60`).
  The rollback switch already exists: `PI_DASHBOARD_CSP=report|enforce|off`
  (`csp.ts:8-10`). This change builds the baseline report sink and a persisted
  violation counter (with reset and a `dropped` count), and ships the strict
  nonce policy as a second Report-Only header. Trusted Types already shipped
  (`harden-client-sinks`); its existing header keeps every carve-out and only
  gains a report endpoint (label `trusted-types`). The new counter's reset is
  `POST /api/csp-reports/reset` and its health key `cspReports`; the existing
  `/api/csp-violations` client counters are untouched. Vite dev emits no
  strict header. `enforce` becomes the strict
  policy enforced, opt-in. **The default stays `report`.** The soak gate and
  the default flip to `enforce` move to the follow-up change
  `enforce-strict-csp-default`, which is `blocked_by` this one.
- **B26r · Residual advisory triage.** The `xlsx` high is mitigated by the CDN
  pin (`packages/server/package.json:110`). Check that pinned 0.20.3 clears the
  advisories, and that the lockfile records an integrity hash for the vendor
  tarball, which is a new remote trust root. Triage the remaining transitive `npm audit` advisories as
  reachable / build-only / accepted, each with a reason, in
  `openspec/changes/harden-cors-and-csp-reporting/advisory-triage.md`.
  Runtime-reachable bumps found at planning (fastify 5.12.1
  GHSA-p68q-wchp-6fh7 auth bypass, nodemailer, linkify-it) are carved out to
  the urgent standalone change `bump-runtime-security-advisories`; this change
  records them in the triage only.

## Capabilities

### Modified Capabilities

- `server-cors` (B19, R2)
- `live-server-preview` (B19)
- `baseline-content-security-policy` (S3b)
- `oauth-authentication` (S3b sink public path)

## Impact

- Server: `auth/cors-origin.ts`, `auth/csp.ts`, `auth/auth-plugin.ts` (sink public path), `auth/passkey/passkey-pages.ts`, `lib/index-html.ts`, `server.ts` (`corsOpts()`, `sendIndexWithImportMap`), `routes/system-routes.ts` (health `cspReports`), new sink route and counter store.
- Shared: `config.ts` (new `cors.allowZrokWildcard` key, default `false`, B19), `route-tiers.ts` (reset route).
- Docs: `openspec/changes/harden-cors-and-csp-reporting/advisory-triage.md` plus a committed `pnpm audit --json` snapshot (B26r).
- **Overlaps with active changes.** Sequence or coordinate with each:
  - `add-plugin-isolation-and-public-routes` edits `cors-origin.ts` and the network guard (B19, R2); textual rebase on `server-cors`.
  - `add-plugin-capability-routes` touches `auth-plugin.ts` and the baseline CSP (S3b); rebase `auth-plugin.ts` / `csp.ts`.
  - `add-trusted-types-report-only` modifies the same CSP header requirement and needs the baseline report sink built here. It becomes `blocked_by` this change. Its premise is partly stale: the TT directive already ships. Its reports are counted under the `trusted-types` label, never toward the strict `script-src*` exit.
  - `enforce-strict-csp-default` (follow-up, `blocked_by` this change) owns the S3b soak gate and the CSP default flip `report` → `enforce`.
  - `bump-runtime-security-advisories` owns the runtime bumps found by B26r; no dependency.
- **Compatibility:**
  - B19: can break a stale second zrok frontend; escape hatch `cors.allowZrokWildcard: true`.
  - R2: widens nothing; trailing-dot origins equal their dotless form, as in host admission.
  - S3b: can break bundles only under opt-in `enforce`; the default stays `report`.
- **Rollback:** each item is an independent local revert. S3b is a config change (`PI_DASHBOARD_CSP=report|off` plus restart); B19 is `cors.allowZrokWildcard: true`.
- **Closes (security-boundary-audit):** B19, R2, B26r, and S3b as instrumentation plus the strict policy (opt-in `enforce`); the final default flip is tracked by `enforce-strict-csp-default`.

## Discipline Skills

- `security-hardening` — CORS admission narrowing and an unauthenticated report sink are untrusted-input boundaries.
- `observability-instrumentation` — S3b adds the persisted violation counter, `dropped` count and health block.
- `performance-optimization` — the per-response CSP header budget and the sink limiter (token bucket, 8 KiB cap) must not add measurable request latency.
