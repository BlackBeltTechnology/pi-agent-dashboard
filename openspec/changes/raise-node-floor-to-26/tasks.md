## 0. Gate (draft → ready)

- [ ] 0.1 `strip-only-native-ts-loader` is shipped
- [ ] 0.2 Node 26 is Active LTS (on or after 2026-10-28)
- [ ] 0.3 Resolve design Open Questions 1–6 and record the decisions in `design.md`
- [ ] 0.4 Write the spec deltas listed in `proposal.md` and pass `openspec validate raise-node-floor-to-26 --strict`
- [ ] 0.5 Run `plan-proposal` (doubt-review, scenario-design, test fold)

## 1. Outline (refine after the gate)

- [ ] 1.1 Floor: `node-version.ts` `MIN_SUPPORTED_NODE`, root and server `engines.node`, `node-guard`
- [ ] 1.2 Bridge auto-start runtime resolution plus a TUI notice when no Node qualifies
- [ ] 1.3 Electron `BUNDLED_NODE_VERSION` → v26.x; Docker base image; CI `node-version`; `_smoke.yml` matrix
- [ ] 1.4 Remove the nodejs#58515 mitigation once a 26-only test proves it unnecessary
- [ ] 1.5 Docs and CHANGELOG: **BREAKING** major release note
