## 1. Flow agents get the rewrite from the flows plugin

- [ ] 1.1 In `packages/flows-plugin/src/bridge/index.ts`, create a module-level `claudeCompatExtension` factory reading `process.__pi_dashboard_bridge__?.claudeSubscriptionCompat === true` and announce it on `flow:register-agent-extension` on activate and every parent `session_start` (design D1, D2); verify with tasks 1.2 and 1.3.
- [ ] 1.2 Test (test-plan #F1), harness exemplar the removed `flows-plugin bridge wiring` E6 test (`git show 7d07c461a^:packages/flows-plugin/src/bridge/__tests__/claude-compat.test.ts`), new file `packages/flows-plugin/src/bridge/__tests__/flow-agent-compat.test.ts`: process-global switch true/false/absent × agent provider anthropic/openai → agent `before_provider_request` rewrites `system` only for (true, anthropic); agent bus never emitted on.
- [ ] 1.3 Test (test-plan #F2), same file, harness exemplar the removed E7 test: activate + 3× `session_start` → 4 `flow:register-agent-extension` emits, one factory reference.
- [ ] 1.4 Update `packages/flows-plugin/src/bridge/AGENTS.md` (`index.ts` row + test row) with `See change: restore-flow-agent-claude-compat`; add a CHANGELOG `[Unreleased]` Fixed entry.

## 2. Manual verification

- [ ] 2.1 Run a flow with an `anthropic` agent step with the switch on (test-plan: manual-only, #M1).
