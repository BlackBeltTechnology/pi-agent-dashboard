# Tasks — pin-invoicebot-role-models

## 1. Prove RED

- [x] 1.1 Unit tests in
  `packages/invoicebot-plugin/src/server/__tests__/role-models.test.ts`:
  all-pinned audits clean; a foreign-provider role is divergent; an empty role is
  `unset`; a divergent active preset is caught; malformed/missing config reads
  empty; no pin → skipped.
- [x] 1.2 Executable configuration assertion: a fixture `providers.json` with
  every declared InvoiceBot role set to `openai-codex/gpt-5.4` audits clean
  against that pin, and the same file with a foreign-provider role does not.
- [x] 1.3 Assert the declared role set matches the InvoiceBot roles the
  deployment exposes (`classification`, `extraction`, `bank-intake`,
  `rule-authoring`, `validation`, `fast`, `smart`).
- [x] 1.4 Extend the spawn tests to assert the pinned spawn model is never an
  Anthropic or DeepSeek fallback when a model is configured.
- [x] 1.5 Record RED output.

## 2. Implement

- [x] 2.1 Add `packages/invoicebot-plugin/src/server/role-models.ts`:
  `IB_DECLARED_ROLES`, `readRoleMap(home)`, `auditRoleModels(...)`.
- [x] 2.2 Run the audit at activation in
  `packages/invoicebot-plugin/src/server/index.ts` and log one explicit line.

## 3. Verify

- [x] 3.1 Targeted tests GREEN with real output.
- [x] 3.2 Full invoicebot-plugin suite GREEN.
- [x] 3.3 `npx tsc --noEmit` clean for the touched package.
- [x] 3.4 `npm run build` (client bundle) succeeds.
- [x] 3.5 `openspec validate pin-invoicebot-role-models --strict`.

## 4. Document

- [x] 4.1 Add the `role-models.ts` row and update the `index.ts` row in
  `packages/invoicebot-plugin/src/server/AGENTS.md`.

## 5. Ship

- [ ] 5.1 Implementation commit on `private/invoicebot`.
- [ ] 5.2 Archive + spec sync in a separate `docs(openspec)` commit.
- [ ] 5.3 Push `private/invoicebot` only; verify parity `0 0`.

## 6. Live gate

- [ ] 6.1 Rebuild `invoicebot:standalone` `--no-cache` from pushed sources;
  recreate the container on ports 5199/8100 preserving its data volumes.
- [ ] 6.2 Container healthy.
- [ ] 6.3 The roles surface reports the default AND every declared InvoiceBot role
  as `openai-codex/gpt-5.4`; no Anthropic or DeepSeek selected for any of them.
- [ ] 6.4 The activation audit logs all roles pinned.
- [ ] 6.5 A scoped per-invoice spawn records `openai-codex/gpt-5.4` in its
  session metadata, and a turn attempts no Anthropic OAuth.
