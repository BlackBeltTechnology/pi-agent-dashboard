# Tasks — pin-invoicebot-spawn-model

## 1. Prove RED

- [x] 1.1 Unit tests for the resolver in
  `packages/invoicebot-plugin/src/server/__tests__/spawn-model.test.ts`:
  precedence order, `provider/modelId` validation, malformed skip-with-warning,
  no-candidate → `undefined`, nested provider ids accepted.
- [x] 1.2 Integration tests in
  `packages/invoicebot-plugin/src/server/__tests__/session-link-model.test.ts`
  proving BOTH spawn paths (`dispatchFlow` and `ensureScopedSession`) receive
  `model: "openai-codex/gpt-5.4"` when the dashboard config sets that
  `defaultModel`.
- [x] 1.3 Integration test proving a malformed configured model falls back to the
  next candidate and the spawn still happens.
- [x] 1.4 Integration test proving that with no configured model the spawn options
  carry no `model` key at all (host behaviour preserved).
- [x] 1.5 Run the suite and record RED output.

## 2. Implement

- [x] 2.1 Add `packages/invoicebot-plugin/src/server/spawn-model.ts`:
  `parseModelRef`, `resolveSpawnModel(sources, logger?)`.
- [x] 2.2 Add `resolveSpawnModel?: () => string | undefined` to `SessionLinkDeps`
  and spread the resolved model into BOTH spawn calls in `session-link.ts`.
- [x] 2.3 Wire the resolver in `packages/invoicebot-plugin/src/server/index.ts`
  from plugin config + dashboard `loadConfig().defaultModel` + `IB_MODEL`.

## 3. Verify

- [x] 3.1 Re-run the targeted tests — GREEN with real output.
- [x] 3.2 Full invoicebot-plugin suite green.
- [x] 3.3 `npx tsc --noEmit` clean.
- [x] 3.4 `openspec validate pin-invoicebot-spawn-model --strict`.

## 4. Document

- [x] 4.1 Add the `spawn-model.ts` row and update `session-link.ts` / `index.ts`
  rows in `packages/invoicebot-plugin/src/server/AGENTS.md`.

## 5. Ship

- [x] 5.1 Implementation commit on `private/invoicebot`.
- [x] 5.2 Archive + spec sync in a separate `docs(openspec)` commit.
- [x] 5.3 Push `private/invoicebot` only; verify parity `0 0`.

## 6. Live gate

- [ ] 6.1 Rebuild the standalone image `--no-cache`, recreate the container on its
  existing data volumes, leave it healthy.
- [ ] 6.2 Open one invoice detail so a scoped session spawns; prove its
  `.meta.json` records `openai-codex/gpt-5.4`.
- [ ] 6.3 Prove a prompt in that session attempts no Anthropic OAuth.
