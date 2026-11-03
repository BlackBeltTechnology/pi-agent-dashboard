## Why

`security-boundary-audit` (archived 2026-10-17) routes every finding to an
owner change. After its reconciliation, one set had no owner: the Tier-3
findings (B17–B24), the residuals of earlier partial fixes (S1r, B1r, B4r,
B14r, B15r, B16r, B26r), the strict-CSP part of S3 (S3b) and the register items
that never got a task (R1, R2, R4, R5). This change was created to own them all.

Planning (2026-10-22) produced 377 tasks across 20 spec capabilities. That is
far above any archived change in this repo (median 27, p90 70, max 259), so the
work was split into five independently shippable changes. This change remains
as the **umbrella**: it records ownership and closes the audit once every owner
has landed. It carries no spec deltas (`skip_specs: true`).

## What Changes

### Ownership

| Item(s) | Owner change | Notes |
|---|---|---|
| B17, B16r, B18, B4r | `harden-auth-credentials` | blocked_by `close-container-loopback-impersonation` (shared auth specs) |
| B19, R2, S3b, B26r | `harden-cors-and-csp-reporting` | CSP default stays `report`; ships sink, counter, strict report-only policy, advisory triage |
| B20, B1r, R1, S1r, B15r | `harden-git-terminal-plugin-boundaries` | sequence with `extract-git-as-plugin` |
| B21, B22, R4, R5 | `harden-bridge-inbound-and-discovery` | builds on archived `fix-remote-bridge-ticket-origin` |
| B23, B24 | `harden-media-and-electron-args` | — |
| B14r | `close-container-loopback-impersonation` | `requireLocalProof` default flip, moved out after a demonstrated container exploit |
| S3b default flip | `enforce-strict-csp-default` | soak gate + `report`→`enforce`; blocked_by `harden-cors-and-csp-reporting` |
| B26r runtime bumps | `bump-runtime-security-advisories` | fastify GHSA-p68q-wchp-6fh7, nodemailer, linkify-it |

Design decisions keep their original numbering in the owner changes (D1–D3,
D5 auth; D6–D11 CORS/CSP; D12–D16 server; D17–D20 bridge; D21–D22
media/Electron). D4 (B14r) is owned by `close-container-loopback-impersonation`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. All spec deltas live in the owner changes.

## Impact

- No code. The umbrella closes when every owner change is archived.
- Other changes that reference `close-residual-audit-findings` (e.g.
  `close-container-loopback-impersonation`, `device-key-mutual-check`,
  `group-servers-by-identity`) remain valid; the owner for a given item is in
  the table above.
- Rollback: not applicable (each owner change carries its own rollback).

## Discipline Skills

None apply to the umbrella itself: it ships no code. Each owner change names
its own discipline skills.
