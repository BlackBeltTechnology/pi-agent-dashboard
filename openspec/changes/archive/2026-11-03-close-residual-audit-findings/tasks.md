# Tasks

## 1. Close the audit

- [ ] 1.1 Confirm all five split changes are archived (`ls openspec/changes/archive | grep -E 'harden-(auth-credentials|cors-and-csp-reporting|git-terminal-plugin-boundaries|bridge-inbound-and-discovery|media-and-electron-args)'` lists five entries)
- [ ] 1.2 Confirm the items owned elsewhere landed or are tracked: B14r in `close-container-loopback-impersonation` (archived), the CSP default flip in `enforce-strict-csp-default`, runtime dependency bumps in `bump-runtime-security-advisories`; record each status in `proposal.md` under "Ownership"
- [ ] 1.3 Verify every `security-boundary-audit` item this change was assigned (S1r, S3b, B1r, B4r, B14r, B15r, B16r, B17, B18, B19, B20, B21, B22, B23, B24, B26r, R1, R2, R4, R5) maps to exactly one owning change in the Ownership table, and `openspec validate close-residual-audit-findings` passes

## Workflow follow-up

- Archive this umbrella (no spec deltas; `skip_specs: true`) once 1.1–1.3 are done; the audit is then closed.
