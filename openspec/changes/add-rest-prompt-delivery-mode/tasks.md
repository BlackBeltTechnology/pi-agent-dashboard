## 1. REST delivery

- [ ] 1.1 Write failing tests in `packages/server/src/session/__tests__/` for `POST /api/session/:id/prompt`: `delivery:"steer"` forwarded on `send_prompt` (and `"followUp"`); absent ⇒ no `delivery` key; `"now"` / `5` / `null` ⇒ 400 and nothing sent; unknown session + invalid `delivery` ⇒ 400 (not 404); valid `delivery` + unknown session ⇒ 404; the forwarded `send_prompt` equals the WS-path message shape for the same inputs (modulo REST's `promptId`).
- [ ] 1.2 Implement in `session-api.ts`: body type gains `delivery?`, enum check before `getSessionOrFail`, include `delivery` in `send_prompt` only when provided. Tests from 1.1 pass.

## 2. MCP delivery

- [ ] 2.1 Write failing tests: MCP `send_prompt` with `delivery:"steer"` reaches the bridge as `{type:"send_prompt",sessionId,text,delivery:"steer"}`; absent ⇒ no `delivery` key; invalid value rejected by the schema; an existing two-argument `ctx.sendToSession(id, text)` caller still produces `{type:"send_prompt",sessionId,text}` unchanged (`packages/mcp-server-plugin/src/server/__tests__/`). The `server.ts` message construction is tested through the pure helper from 2.3: two-arg ⇒ no `delivery` key; `{delivery:"steer"}` ⇒ key present; `opts` given but `delivery` undefined ⇒ no key. MCP `images` still ignored.
- [ ] 2.2 Add `delivery?: "steer" | "followUp"` to `SendPromptRequest` (`packages/shared/src/rest-api.ts`); extend the `send_prompt` description in `packages/mcp-server-plugin/src/server/tools.manifest.ts` so MCP callers can discover `delivery` (steer = mid-turn after the current step; followUp/absent = after the agent finishes; must stay ≤ 120 chars — `manifest-invariants.test.ts`); regenerate `packages/mcp-server-plugin/src/server/generated/tools.ts` via the package `codegen` script (`npm run codegen -w packages/mcp-server-plugin`, i.e. `tsx codegen/generate-tools.ts`; freshness test must pass).
- [ ] 2.3 Widen `SendToSessionFn` (`server-context.ts`) with optional `opts?: { delivery? }`; pass `args.delivery` in the MCP `send_prompt` handler (`mcp-server-plugin/src/server/index.ts`); extract the `send_prompt` message construction of the inline `sendToSession` closure in `packages/server/src/server.ts` into a small exported pure helper (e.g. `buildPluginSendPrompt(sessionId, text, opts?)`; one call site, no generalisation) that includes `delivery` only when provided, and call it from the closure. Tests from 2.1 pass.

## 3. Docs

- [ ] 3.1 Update `packages/extension/.pi/skills/pi-dashboard/SKILL.md` (Send prompt row + example: optional `delivery`, 400 case, steer example `--data '{"text":"focus on X","delivery":"steer"}'`) and `packages/extension/.pi/skills/pi-dashboard/references/api-reference.md` + `api-reference.agent.md` (same directory) (body, 400 case, steer example).

## 4. Verify and land

- [ ] 4.1 Rebuild: server/shared/plugin-runtime changes ⇒ `npx tsx .pi/skills/implement/scripts/restart-server.ts` (jiti, no build); confirm `curl -s http://localhost:8000/api/health | jq .mode`. No extension reload needed.
- [ ] 4.2 Manual check: while a session streams, `POST /api/session/:id/prompt {"text":"x","delivery":"steer"}` shows a cancellable pending steer bubble in the browser, identical to a browser steer (run against a pi-bridge session, not ACP).
- [ ] 4.3 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary; `npm run quality:changed`.
- [ ] 4.4 `npx openspec validate add-rest-prompt-delivery-mode --strict`; `node scripts/check-conventions.mjs`.
