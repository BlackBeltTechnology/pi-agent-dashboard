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
