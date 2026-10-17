# Test Plan — add-mermaid-ai-repair

Stage: design   Generated: 2026-10-08

Hard gate cleared: no unfillable Triple slots after doubt-review cycles 1–3 (status codes, caps, defaults, concurrency, abort classification, state shape all pinned in specs/design).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared-config — absent block | EP | L1 | automated | config JSON with no `mermaidRepair` key | `parseMermaidRepairConfig(undefined)` + `loadConfig()` | resolved `{ enabled: false, maxChars: 20000, timeoutMs: 30000 }`, no throw |
| E2 | shared-config — maxChars clamp | BVA | L1 | automated | `maxChars` ∈ {999, 1000, 20000, 50000, 50001, 999999} | parse | {1000, 1000, 20000, 50000, 50000, 50000} |
| E3 | shared-config — timeoutMs clamp | BVA | L1 | automated | `timeoutMs` ∈ {10, 4999, 5000, 120000, 120001} | parse | {5000, 5000, 5000, 120000, 120000} |
| E4 | shared-config — wrong types + unknown fields | EP | L1 | automated | `"str"`; `{enabled:"yes", model:42, maxChars:"big", foo:1}` | parse | defaults for each bad field; result has no `foo`; no throw |
| E5 | shared-config — enable decision table | decision-table (enabled × model absent/`provider/id`/`@role`) | L1 | automated | `{enabled:true}`; `{enabled:true, model:"@fast"}`; `{enabled:true, model:"openrouter/x:free"}`; `{enabled:false, model:"a/b"}` | parse | `false`+`no_model`; `false`+`role_refs_unsupported`; `true`, model `openrouter/x:free` verbatim, no `disabledReason`; `false`, no reason |
| E6 | shared-config — GET /api/config projection | contract | L1 | automated | config `{enabled:true, model:"anthropic/m"}`; second run `{enabled:true}` | `GET /api/config` via fastify inject (localhost) | `data.mermaidRepair` = `{enabled:true, model:"anthropic/m", maxChars:20000, timeoutMs:30000}`; second run `disabledReason:"no_model"`; no key matching `/key|token|secret/i` in the block |
| E7 | Endpoint — fenced extraction | EP | L1 | automated | stub stream text `"Here:\n```mermaid\ngraph TD\nA-->B\n```\nthanks"` | `POST /api/mermaid/repair {code:"graph TD\nA-->", error:"Parse error"}` | 200 `{success:true, data:{code:"graph TD\nA-->B", model:"<cfg model>"}}` |
| E8 | Endpoint — bare text extraction | EP | L1 | automated | stub text `"  mermaid\ngraph TD\nA-->B  "` | POST | `data.code === "graph TD\nA-->B"` |
| E9 | Endpoint — non-text events ignored | EP | L1 | automated | stub events: thinking delta `"x"`, tool-call event, text deltas `"graph TD\n"`,`"A-->B"` | POST | `data.code === "graph TD\nA-->B"` |
| E10 | Endpoint — input caps | BVA | L1 | automated | maxChars 1000: `code` length 1000 / 1001; `error` length 2000 / 2001 | POST | 1000 & 2000 → stream called; 1001 → 413 `too_large`; 2001 → 413 `too_large`; stream call count 0 for rejected |
| E11 | Endpoint — malformed body | EP | L1 | automated | `{}`, `{code:""}`, `{code:"x", error:5}` | POST | 400 `{success:false, code:"bad_request", error:<string>}`; stream not called |
| E12 | Endpoint — disabled | EP | L1 | automated | config `enabled:false` | POST valid body | 404 `code:"disabled"`; stream not called |
| E13 | Endpoint — output budget | BVA | L1 | automated | maxChars 50000 and maxChars 3000 | POST | captured stream opts: `temperature 0`, `maxTokens` 8192 and 1000 respectively; no `apiKey` field in opts |
| E14 | Endpoint — prompt carries inputs | contract | L1 | automated | `code:"graph TD\nA-->"`, `error:"Parse error on line 2"` | POST | captured `system` instructs return-only-diagram; single user message contains both strings verbatim |
| E15 | Cache — remount reuses AI result | state-transition | L1 | automated | failing code, enabled, fetch mock returns renderable fix | click Fix → AI-fixed → unmount → remount | AI-fixed badge shown on remount; repair fetch call count stays 1 |
| E16 | Cache — failures not cached | state-transition | L1 | automated | fetch mock: 1st 502 `provider_error`, 2nd success | click Fix → failed → unmount → remount → click Fix | 2 fetch calls; ends AI-fixed |

### Performance

none — the spec sets no latency/throughput budget beyond the configured timeout (covered by X3).

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Gate — action visibility | decision-table (enabled × rule-repair outcome) | L1 | automated | enabled false + error; enabled true + error; enabled true + rule-repaired; enabled true + ok | mount `MermaidBlock` | "Fix with AI" present only in case 2 |
| F2 | Gate — no automatic call | state | L1 | automated | enabled true, failing code | mount, wait for render settle, no click | repair fetch call count 0 |
| F3 | Gate — accessible action + disclosure | a11y | L1 | automated | enabled true, failing code | render | button has accessible name, is a `<button>` (keyboard-operable), and has a description/title containing the provider-disclosure string |
| F4 | Pending state | state-transition | L1 | automated | fetch mock returns deferred promise | click Fix, click again | button `disabled` + pending indicator; fetch call count 1 |
| F5 | Renderable AI result | state-transition | L1 | automated | fetch → `{code:"graph TD\nA-->B", model:"anthropic/m"}`; render mock ok for fixed code | click Fix | SVG shown; badge text contains "AI-fixed" and `anthropic/m`; distinct from rule-repair badge; show-original + copy-fixed buttons present |
| F6 | Show original / copy fixed | state | L1 | automated | AI-fixed diagram | click show-original; click copy-fixed | original code + original error shown, viewport `hidden`, toggle `aria-pressed="true"`; clipboard text = fixed code |
| F7 | Source change discards AI result | state-transition | L1 | automated | AI-fixed diagram | rerender with different failing `code` | no AI badge; error display with "Fix with AI" for new code; no new fetch |
| F8 | Theme change keeps AI result | state-transition | L1 | automated | AI-fixed diagram, theme light | switch theme dark | AI-fixed diagram re-rendered (render called with fixed code); fetch count unchanged; original view closed if it was open |
| F9 | Unmount aborts | race | L1 | automated | fetch mock deferred, captures `signal` | click Fix → unmount → resolve | `signal.aborted === true`; no state-update warning; page cache empty for that key |
| F10 | Client reads config | contract | L1 | automated | `GET /api/config` mock with `mermaidRepair.enabled:true` | app hydration | `MermaidBlock` receives enabled=true (action rendered for failing code) |
| F11 | Fetch helper | contract | L1 | automated | fetch mock 200 / 429 `busy` envelope | `repairMermaidWithAi(code, error, signal)` | returns `{code, model}` on 200; rejects with an error exposing `code:"busy"` and human `error`; passes `signal` to fetch; POSTs JSON to `/api/mermaid/repair` |
| F12 | AI badge legibility | visual | — | manual-only | AI-fixed badge in light + dark, narrow chat bubble + wide preview | human looks | [judgment: AI badge readable, visually distinct from rule badge, does not crowd the diagram] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Concurrency | fault (overlap) | L1 | automated | first request's stream deferred | second POST while first pending; then resolve first; third POST | 2nd → 429 `busy`, stream call count 1; 3rd → accepted (count 2) |
| X2 | Disconnect aborts | fault-injection (abort) | L1 | automated | stream stub awaits its `signal` | start POST on a real listening server, destroy the client socket | stub sees `signal.aborted`; next POST accepted (not `busy`); log line `outcome=aborted` |
| X3 | Timeout | fault-injection (delay) | L1 | automated | stream never yields; `timeoutMs` 5000 with fake timers | POST, advance 5000 ms | 504 `code:"timeout"`; log `outcome=timeout ms=<n> model=<ref>` |
| X4 | Provider failure / unknown model | fault-injection (abort) | L1 | automated | stream throws `Error("401")`; separately registry `find` → undefined | POST | 502 `code:"provider_error"`; stream not called for unknown model; response body contains no `apiKey`/`headers` |
| X5 | Unparseable output | EP | L1 | automated | stub text `""`; `"```mermaid\n```"`; 1001-char diagram with maxChars 1000 | POST | 502 `code:"unparseable"`; `data` absent |
| X6 | Network guard | fault (untrusted caller) | L1 | automated | inject with `remoteAddress: "203.0.113.5"`, no auth | POST | rejected by guard (401/403 per guard); stream not called |
| X7 | No content in logs | contract | L1 | automated | `code` containing sentinel `SENTINEL_SRC_9f3`, stub output containing `SENTINEL_OUT_7a1`, error `SENTINEL_ERR_2c4` | POST success; POST timeout | each emits one `[mermaid-repair]` line with `outcome=ok`/`timeout`, `model=`, `ms=`, `chars=`; captured log contains none of the sentinels |
| X8 | Non-renderable AI result | fault (render) | L1 | automated | fetch → fix; render mock throws for fixed code | click Fix | original error display kept; "AI fix failed" message; retry button enabled; no SVG |
| X9 | Endpoint error surfaced | fault (HTTP) | L1 | automated | fetch → 504 `{code:"timeout", error:"Model timed out"}` | click Fix | original error kept; "AI fix failed" with reason text; retry → second fetch |
| X10 | i18n parity | contract | L1 | automated | new action/pending/AI-fixed/failed/disclosure keys | `i18n.test.ts` sweep + `node scripts/i18n-parity.mjs` | every new key present in en, zh-CN, hu; parity script exit 0; Hungarian UI shows Hungarian action text |
| X11 | Real model end-to-end | integration (live provider) | — | manual-only | `mermaidRepair` configured with a real `provider/id`, `.md` with unbalanced flowchart `subgraph` | restart server, open preview, click Fix with AI | [judgment + live credentials: AI-fixed diagram rendered and plausible; server.log `[mermaid-repair]` line has no diagram text — needs a real paid provider, not available in CI/docker harness] |

---

## Coverage summary

- Requirements covered: 6/6 (mermaid-ai-repair: 5; shared-config: 1)
- Scenarios by class: edge 16 · perf 0 · frontend 12 · error 11
- Scenarios by level: L1 37 · L2 0 · L3 0 · manual 2
- Scenarios by disposition: automated 37 · manual-only 2

## New infra needed

- none. No L3: the docker harness has no model provider, and every rendered-UI behaviour is deterministic under the jsdom `MermaidBlock` tests with mocked fetch/render (precedent: `add-mermaid-auto-repair` test-plan F1–F11).
