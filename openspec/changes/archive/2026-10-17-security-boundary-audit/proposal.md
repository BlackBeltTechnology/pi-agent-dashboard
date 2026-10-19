# Security Boundary Audit

## Why

The `security-hardening` discipline skill (STRIDE + OWASP + LLM Top-10) landed
*after* most of the dashboard was built. The codebase was never swept against it
as a whole. This change is an **audit**, not a feature: enumerate every trust
boundary and dangerous capability across all packages, run STRIDE over each, and
record findings in a tracked register so remediation can be scoped as follow-up
changes.

This is captured as an OpenSpec change so findings + remediation are trackable;
the audit itself writes no product code.

## Threat Model

**Asset (crown jewel):** arbitrary code execution on the host. The dashboard is
an agent *control plane* — reaching it lets an actor drive AI agents that run
shell/tools, open PTYs (`terminal-gateway`, `browser-gateway`, node-pty), spawn
processes (33 exec sites in `server/` alone), read files, run git ops, and use
the operator's model-provider credentials (`model-proxy`).

**Deployment reality (operator-confirmed):** mostly localhost / LAN, with
*occasional* zrok tunnel exposure to the public internet. So the audit weights
**both** local/LAN threats (other LAN devices, CSRF from a browser on the same
host, trusted-network CIDR width) **and** the remote/tunnel path (a public zrok
frontend reaching a dangerous capability).

**Existing controls (already present — audit verifies coverage, not absence):**
`localhost-guard`, `local-token`, `auth-plugin` (OAuth cookie), `bearer-auth`
(revocable device tokens), `pairing`/`paired-devices` (QR), `ws-ticket`
(single-use WS upgrade), `cors-origin`, `model-proxy/auth-gate`,
`lib/path-containment`.

**Central audit question:** does every dangerous capability sit behind the
central auth/guard gate — including WS upgrades, plugin route registrars
(`automation-plugin`, `kb-plugin`, `flows-plugin`), and document-rendering
surfaces — or did any door get left unlocked?

## What Changes

- Add an audit findings register (`audit-findings.md`) enumerating each finding:
  severity · STRIDE category · trust boundary · `file:line` · exploit sketch ·
  existing control · gap · suggested remediation.
- No product code changes in this change. Each actionable finding becomes a task
  and, where behavior changes, a follow-up OpenSpec change of its own.
- No spec deltas (`skip_specs: true` in `.openspec.yaml`). The register is the
  deliverable; behaviour requirements land in the follow-up changes.

## Remediation Ownership (close-out rule)

The register's `[x]` means **routed**, not fixed. This change delivers the
register and its routing. The fixes are delivered by the owner changes. Every
ticked finding line in `tasks.md` carries exactly one status:

- **Closed by `<change>`.** The fix is in current code (checked 2026-10-17), and
  the named change sits under `openspec/changes/archive/`. Residuals that owner
  change explicitly accepted, with written rationale, count as closed (B10).
- **Owner assigned → `<change>` (fix open).** An active change owns the fix, and
  its `proposal.md` names the finding ID (`Closes` line or scope). The finding is
  then tracked there.
- **Split.** The fixed part is Closed, and the residual gets its own ID (`<id>r`,
  or `S3b`) with an assigned owner.
- **No gap (verified).** Re-checked against code and found not exploitable;
  the line cites the evidence.

The rule covers finding lines. V1–V5 are audit-procedure checks.

An unticked finding line has no owner. This change archives only when it has
no unticked finding lines. Archiving it does NOT mean the fixes have landed: the
"Owner assigned" findings stay open in their owner changes.

Reconciled against code on 2026-10-17:

| Owner | Findings |
|---|---|
| `add-universal-network-guard` (archived) | S1 (root guard) |
| `add-pi-gateway-transport-identity`, `loopback-credential-proof` (archived) | S2 core |
| `sanitize-untrusted-rendered-content` (archived) | S3 (markdown / AsciiDoc / mermaid XSS) |
| `fix-git-checkout-command-injection` (archived) | B1 (shell injection), B6 |
| `harden-electron-renderer-boundary` (archived) | B2, B3, B10 (LAN/loopback allowed by design) |
| `harden-trust-and-credential-boundaries` (archived) | B4 (same-origin), B5, B14 (opt-in proof), B15 (server denylist), B16 (`secure` on an https base), B25 |
| `harden-untrusted-content-ingestion` (archived) | B11, B12 (incl. fetch byte cap + timeout), B13, B26 (`xlsx` CDN pin) |
| `harden-server-capability-bounds` (active) | B7, B8, B9 |
| `close-loopback-legacy-window` (active) | S2r (tokenless loopback grace, legacy raw token) |
| `close-residual-audit-findings` (active) | S1r, S3b, B1r, B4r, B14r, B15r, B16r, B17, B18, B19, B20, B21, B22, B23, B24, B26r, R1, R2, R4, R5 |
| no gap (verified) | R3 |

## Scope

- **In:** all `packages/*/src` route registrars, WS handlers, exec/spawn sites,
  file readers, fetch (SSRF) sites, client XSS surfaces, token storage, LLM /
  document output handling, install-time scripts.
- **Out:** implementing fixes (follow-up changes), dependency CVE remediation
  beyond `npm audit` triage, penetration testing of deployed infra.

## Method

Per-package STRIDE sweep, clustered A–G by risk, each cluster scanned against the
`security-hardening` checklist, findings aggregated into the register and
severity-ranked.

## Discipline Skills

- `security-hardening` — the audit lens (STRIDE, OWASP Top-10, LLM Top-10).
- `doubt-driven-review` — stress-test each high-severity finding before it drives
  a remediation change (avoid false positives / wasted fixes).
