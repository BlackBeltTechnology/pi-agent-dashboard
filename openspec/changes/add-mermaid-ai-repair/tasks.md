## 0. Preconditions

- [ ] 0.1 Confirm `add-mermaid-auto-repair` has landed on the base branch (`MermaidOutcome` type + badge row in `MermaidBlock.tsx`); if not, stop and hand back via `SHIP_IT_BLOCKED.md`

## 1. Config (TDD)

- [ ] 1.1 Test: absent block — copy harness from `packages/shared/src/__tests__/config-keeper-log.test.ts`; config JSON without `mermaidRepair` · `parseMermaidRepairConfig(undefined)` + `loadConfig()` · resolves `{ enabled: false, maxChars: 20000, timeoutMs: 30000 }` without throwing (test-plan #E1)
- [ ] 1.2 Test: maxChars clamp — same exemplar as 1.1; `maxChars` 999/1000/20000/50000/50001/999999 · parse · 1000/1000/20000/50000/50000/50000 (test-plan #E2)
- [ ] 1.3 Test: timeoutMs clamp — same exemplar as 1.1; `timeoutMs` 10/4999/5000/120000/120001 · parse · 5000/5000/5000/120000/120000 (test-plan #E3)
- [ ] 1.4 Test: wrong types and unknown fields — same exemplar as 1.1; `"str"` and `{enabled:"yes", model:42, maxChars:"big", foo:1}` · parse · defaults per bad field, no `foo`, no throw (test-plan #E4)
- [ ] 1.5 Test: enable decision table — same exemplar as 1.1; `{enabled:true}`, `{enabled:true, model:"@fast"}`, `{enabled:true, model:"openrouter/x:free"}`, `{enabled:false, model:"a/b"}` · parse · `no_model`, `role_refs_unsupported`, enabled with verbatim model and no reason, disabled with no reason (test-plan #E5)
- [ ] 1.6 Verify 1.1–1.5 fail; add `MermaidRepairConfig` + `parseMermaidRepairConfig` to `packages/shared/src/config.ts`, wire into `loadConfig()`; verify 1.1–1.5 pass
- [ ] 1.7 Test: GET /api/config projection — copy harness from `packages/server/src/__tests__/access-routes.test.ts`; config `{enabled:true, model:"anthropic/m"}` then `{enabled:true}` · `GET /api/config` inject from localhost · `data.mermaidRepair` carries resolved fields, second run `disabledReason:"no_model"`, no key matching `/key|token|secret/i` in the block (test-plan #E6); verify it passes (served via `readConfigRedacted()`, no route change expected)

## 2. Server endpoint (TDD)

- [ ] 2.1 Test: fenced extraction — copy route harness from `packages/server/src/routes/__tests__/pi-retry-routes.test.ts` and stream-stub pattern from `packages/grammar-plugin/src/__tests__/grammar-llm.test.ts` (injected registry + stream fn); stub text with prose around a ```` ```mermaid ```` block · `POST /api/mermaid/repair {code, error}` · 200 with only the block's source and the configured model (test-plan #E7)
- [ ] 2.2 Test: bare text extraction — same exemplars as 2.1; stub text `"  mermaid\ngraph TD\nA-->B  "` · POST · `data.code === "graph TD\nA-->B"` (test-plan #E8)
- [ ] 2.3 Test: non-text events ignored — same exemplars as 2.1; thinking delta + tool-call event + text deltas · POST · `data.code` is the concatenated text deltas only (test-plan #E9)
- [ ] 2.4 Test: input caps — same exemplars as 2.1; maxChars 1000, `code` 1000/1001 chars, `error` 2000/2001 chars · POST · boundary values call the stream, 1001/2001 → 413 `too_large` with zero stream calls (test-plan #E10)
- [ ] 2.5 Test: malformed body — same exemplars as 2.1; `{}`, `{code:""}`, `{code:"x", error:5}` · POST · 400 `{success:false, code:"bad_request", error:<string>}`, stream not called (test-plan #E11)
- [ ] 2.6 Test: disabled — same exemplars as 2.1; config `enabled:false` · POST valid body · 404 `code:"disabled"`, stream not called (test-plan #E12)
- [ ] 2.7 Test: output budget — same exemplars as 2.1; maxChars 50000 and 3000 · POST · captured opts `temperature 0`, `maxTokens` 8192 / 1000, no `apiKey` field (test-plan #E13)
- [ ] 2.8 Test: prompt carries inputs — same exemplars as 2.1; `code:"graph TD\nA-->"`, `error:"Parse error on line 2"` · POST · `system` instructs return-only-diagram, one user message contains both strings verbatim (test-plan #E14)
- [ ] 2.9 Test: concurrency — same exemplars as 2.1; first stream deferred · second POST while pending, then resolve, then third POST · second → 429 `busy` with one stream call, third accepted (test-plan #X1)
- [ ] 2.10 Test: disconnect aborts — copy harness from `packages/server/src/routes/__tests__/pi-retry-routes.test.ts` but on a real listening server (`fastify.listen` on port 0); stream stub awaits its `signal` · destroy the client socket mid-request · stub sees `signal.aborted`, next POST accepted, log line `outcome=aborted` (test-plan #X2)
- [ ] 2.11 Test: timeout — same exemplars as 2.1 with fake timers; stream never yields, `timeoutMs` 5000 · POST, advance 5000 ms · 504 `code:"timeout"`, log `outcome=timeout` with `ms=` and `model=` (test-plan #X3)
- [ ] 2.12 Test: provider failure / unknown model — same exemplars as 2.1; stream throws `Error("401")`; separately registry `find` → undefined · POST · 502 `provider_error`, stream not called for unknown model, body has no `apiKey`/`headers` (test-plan #X4)
- [ ] 2.13 Test: unparseable output — same exemplars as 2.1; stub `""`, empty fenced block, 1001-char diagram with maxChars 1000 · POST · 502 `unparseable`, no `data` (test-plan #X5)
- [ ] 2.14 Test: network guard — copy guard harness from `packages/server/src/__tests__/model-proxy-api-key-routes.test.ts`; inject with `remoteAddress: "203.0.113.5"`, no auth · POST · rejected by the guard, stream not called (test-plan #X6)
- [ ] 2.15 Test: no content in logs — same exemplars as 2.1 with a captured logger; sentinels `SENTINEL_SRC_9f3` in code, `SENTINEL_ERR_2c4` in error, `SENTINEL_OUT_7a1` in output · POST success and POST timeout · one `[mermaid-repair]` line each with `outcome=`, `model=`, `ms=`, `chars=`, none of the sentinels present (test-plan #X7)
- [ ] 2.16 Verify 2.1–2.15 fail; implement `packages/server/src/routes/mermaid-repair-routes.ts` (validation order, prompt builder, `collectRepairText`, extractor, in-flight flag, `AbortSignal.any([timeout, disconnect])`, error mapping, log line) using `InternalRegistry.find` + `getApiKeyAndHeaders` and the runtime `streamSimple` without `apiKey` (pattern `packages/server/src/model-proxy/streamer.ts`); register with `preHandler: networkGuard`; add request/response types to `packages/shared/src/`; verify 2.1–2.15 pass

## 3. Client

- [ ] 3.1 Test: fetch helper — copy harness from `packages/client/src/lib/__tests__/model-proxy-api.test.ts`; fetch mock 200 and 429 `busy` envelope · `repairMermaidWithAi(code, error, signal)` · returns `{code, model}` on 200, rejects exposing `code:"busy"` + human `error`, forwards `signal`, POSTs JSON to `/api/mermaid/repair` (test-plan #F11)
- [ ] 3.2 Implement `repairMermaidWithAi` in `packages/client/src/lib/api/`; verify 3.1 passes
- [ ] 3.3 Test: client reads config — copy harness from `packages/client/src/components/__tests__/MermaidBlock.test.tsx` (hydration source `packages/client/src/App.tsx:1142-1166`); `GET /api/config` mock with `mermaidRepair.enabled:true` · app hydration · `MermaidBlock` renders the action for failing code (test-plan #F10)
- [ ] 3.4 Test: action visibility — copy harness from `packages/client/src/components/__tests__/MermaidBlock.test.tsx`; enabled false + error / true + error / true + rule-repaired / true + ok · mount · "Fix with AI" only in the second case (test-plan #F1)
- [ ] 3.5 Test: no automatic call — same exemplar as 3.4; enabled, failing code · mount and settle without click · repair fetch count 0 (test-plan #F2)
- [ ] 3.6 Test: accessible action + disclosure — same exemplar as 3.4; enabled, failing code · render · `<button>` with accessible name and a description/title containing the provider-disclosure text (test-plan #F3)
- [ ] 3.7 Test: pending state — same exemplar as 3.4; deferred fetch · click Fix twice · button disabled with pending indicator, fetch count 1 (test-plan #F4)
- [ ] 3.8 Test: renderable AI result — same exemplar as 3.4; fetch → `{code:"graph TD\nA-->B", model:"anthropic/m"}`, render ok · click Fix · SVG shown, badge contains "AI-fixed" and `anthropic/m`, distinct from rule badge, show-original + copy-fixed present (test-plan #F5)
- [ ] 3.9 Test: show original / copy fixed — same exemplar as 3.4; AI-fixed diagram · click show-original, click copy-fixed · original code + error shown, viewport `hidden`, `aria-pressed="true"`, clipboard = fixed code (test-plan #F6)
- [ ] 3.10 Test: source change discards AI result — same exemplar as 3.4; AI-fixed diagram · rerender with a different failing `code` · no AI badge, "Fix with AI" for the new code, no new fetch (test-plan #F7)
- [ ] 3.11 Test: theme change keeps AI result — same exemplar as 3.4; AI-fixed diagram in light · switch to dark · render called with fixed code, fetch count unchanged, open original view closed (test-plan #F8)
- [ ] 3.12 Test: unmount aborts — same exemplar as 3.4; deferred fetch capturing `signal` · click Fix → unmount → resolve · `signal.aborted`, no state-update warning, page cache empty for the key (test-plan #F9)
- [ ] 3.13 Test: remount reuses AI result — same exemplar as 3.4; fetch returns renderable fix · click Fix → unmount → remount · AI-fixed badge on remount, fetch count stays 1 (test-plan #E15)
- [ ] 3.14 Test: failures not cached — same exemplar as 3.4; fetch 502 `provider_error` then success · click Fix → failed → unmount → remount → click Fix · 2 fetch calls, ends AI-fixed (test-plan #E16)
- [ ] 3.15 Test: non-renderable AI result — same exemplar as 3.4; fetch → fix, render throws for fixed code · click Fix · original error kept, "AI fix failed", retry enabled, no SVG (test-plan #X8)
- [ ] 3.16 Test: endpoint error surfaced — same exemplar as 3.4; fetch → 504 `{code:"timeout", error:"Model timed out"}` · click Fix, then retry · original error kept, "AI fix failed" with the reason, retry issues a second fetch (test-plan #X9)
- [ ] 3.17 Verify 3.3–3.16 fail; implement config read in `App.tsx` hydration, the `aiState` machine, action button, AI-fixed badge in the badge row, provider-disclosure tooltip and page-lifetime success cache in `MermaidBlock.tsx`; verify 3.3–3.16 pass
- [ ] 3.18 Test: i18n parity — copy harness from `packages/client/src/__tests__/i18n.test.ts`; new action/pending/AI-fixed/failed/disclosure keys · key sweep + `node scripts/i18n-parity.mjs` · every key present in en, zh-CN, hu, parity exit 0, Hungarian UI shows Hungarian action text (test-plan #X10); add the keys and verify it passes

## 4. Security, docs, verification

- [ ] 4.1 Run the `security-hardening` checklist on the diff (input caps, output-as-untrusted, guard, single in-flight, no secret echo); record findings in this change's design.md Risks; verify no open High findings
- [ ] 4.2 Add `mermaid-repair-routes.ts` row to `packages/server/src/routes/AGENTS.md` and update `MermaidBlock.tsx.AGENTS.md` (See change: add-mermaid-ai-repair); delegate the `docs/` config reference entry for `mermaidRepair` to DocScribe; verify rows present
- [ ] 4.3 Full suite + `npm run quality:changed`; verify green
- [ ] 4.4 Manual: AI badge legibility in light + dark, narrow chat bubble and wide preview — badge readable, distinct from the rule badge, not crowding the diagram (test-plan: manual-only, #F12)
- [ ] 4.5 Manual: configure `mermaidRepair` with a real `provider/id`, restart, open a `.md` with an unbalanced flowchart `subgraph`, click Fix with AI — AI-fixed diagram renders and the `[mermaid-repair]` server.log line has no diagram text (test-plan: manual-only, #X11)
