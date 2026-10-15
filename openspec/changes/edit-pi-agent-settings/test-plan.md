# Test Plan — edit-pi-agent-settings

Stage: design   Generated: 2026-10-14

Hard gate passed: one gap (lock-wait non-blocking threshold) resolved by the user → `< 50 ms`, folded
into spec `pi-agent-settings-editor` scenario "Waiting for the lock does not block other requests".

Level homes (this repo):
- L1 server store → `packages/server/src/__tests__/pi-agent-settings.test.ts` (extend; `FsDeps` seam)
- L1 server routes → `packages/server/src/routes/__tests__/pi-settings-routes.test.ts` (new; exemplar `pi-retry-routes.test.ts`)
- L1 config mirror route → `packages/server/src/__tests__/system-routes-pi-mirror.test.ts` (new; exemplar `system-routes-restart.test.ts`)
- L1 shared → `packages/shared/src/__tests__/dashboard-paths.test.ts` (extend)
- L1 client → `packages/client/src/components/__tests__/PiSettingsSection.test.tsx` (new; exemplar `RetrySettingsSection.test.tsx`), `SettingsPanel.test.tsx` (extend)
- L3 → `tests/e2e/pi-settings-editor.spec.ts` (new; exemplar `tests/e2e/settings-default-model-catalogue.spec.ts`)

Lock tests use a REAL `proper-lockfile` lock held from the test (or a child process) on a tmp agent dir —
never a mock — so lock-artifact parity with pi is exercised.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Read: existing file | EP | L1 | automated | tmp agent dir, `settings.json` = `{"steeringMode":"all"}` | `GET /api/pi-settings` | 200; `settings.steeringMode === "all"`; `raw` equals file text; `etag` non-empty, ≠ `"absent"` |
| E2 | Read: absent file | EP | L1 | automated | tmp agent dir, no `settings.json` | `GET /api/pi-settings` | 200; `settings` `{}`, `raw` `""`, `etag` `"absent"` |
| E3 | Read: unparseable | EP | L1 | automated | file = `{ "steeringMode": ` | `GET /api/pi-settings` | 200; `parseError` string; `settings` `{}`; `raw` = file text; `etag` = sha256(raw bytes) |
| E4 | Read: BOM | EP | L1 | automated | file = `\uFEFF{"steeringMode":"all"}` | `GET /api/pi-settings` | `settings.steeringMode === "all"`, no `parseError` |
| E5 | Agent-dir override | EP | L1 | automated | `PI_CODING_AGENT_DIR=<tmp>/alt` (also `~/alt` form), sentinel file in `<home>/.pi/agent/settings.json` | read then typed patch | reads/writes `<tmp>/alt/settings.json`; home sentinel byte-identical; `resolvePiAgentDir` returns trimmed, tilde-expanded path, whitespace-only → default |
| E6 | Typed: merge-preserving | EP | L1 | automated | file with `packages`, `retry`, `compaction:{enabled:true,futureKnob:1}` | patch `compaction.reserveTokens=20000`, fresh token | file `compaction` = `{enabled:true,futureKnob:1,reserveTokens:20000}`; `packages`,`retry` deep-equal prior |
| E7 | Typed: null leaf deletes | EP | L1 | automated | file `steeringMode:"all"` | patch `steeringMode:null` | key absent in file |
| E8 | Typed: whole-block null | EP | L1 | automated | file with `compaction` | patch `compaction:null` | 400 naming `compaction`; file byte-identical |
| E9 | Typed: value boundaries | BVA | L1 | automated | `compaction.reserveTokens` ∈ {-1, 0, 1, 1.5, "5", 2^31} | patch each | -1/1.5/"5" → 400 naming the field, file unchanged; 0/1/2^31 → 200 and written |
| E10 | Typed: enum domains | EP | L1 | automated | `steeringMode`/`followUpMode` ∈ {"all","one-at-a-time","ALL",""}; `defaultProjectTrust` ∈ {"ask","always","never","maybe"}; `quietStartup` ∈ {true,false,"header","quiet",1} | patch each | valid → 200; invalid → 400 naming field, nothing written |
| E11 | Typed: mixed valid+invalid | decision-table | L1 | automated | patch `{steeringMode:"all", compaction:{reserveTokens:-1}}` | PUT typed | 400 naming `compaction.reserveTokens`; file byte-identical (valid half NOT applied) |
| E12 | Typed: non-typed pi key | EP | L1 | automated | patch `{shellPath:"/bin/sh"}` | PUT typed | 400; error names `shellPath` and mentions JSON/raw editor; nothing written |
| E13 | Typed: managed keys | decision-table | L1 | automated | patch with each of `defaultProvider` / `defaultModel` / `defaultThinkingLevel` | PUT typed | 400 each; nothing written |
| E14 | Typed: unparseable file | state | L1 | automated | file = truncated JSON, client holds its raw-byte token | patch `steeringMode:"all"` | 400 with `parseError`; file byte-identical |
| E15 | Raw: unknown keys pass | EP | L1 | automated | raw `{"someFutureKey":{"a":1}}`, fresh token | PUT raw | 200; file contains `someFutureKey`; text = 2-space JSON + trailing `\n` |
| E16 | Raw: partial retry ok | EP | L1 | automated | raw `{"retry":{"enabled":true,"maxAgentDelayMs":5000}}` | PUT raw | 200 |
| E17 | Raw: retry rules | BVA + EP | L1 | automated | raw `retry.baseDelayMs` ∈ {0,1}; `retry.provider.timeoutMs` ∈ {0,1}; `retry`=5; `retry`=[]; `retry.provider`=[]; `retry.provider`=5 | PUT raw | 0 / non-object / array → 400 naming the field, nothing written; 1 → 200 |
| E18 | Raw: JSON shape | EP | L1 | automated | raw `{ "a": 1,, }`; raw `[1,2]`; raw `"x"`; raw `null` | PUT raw | 400 each; file byte-identical |
| E19 | Raw: typed-key types in raw | decision-table | L1 | automated | raw `{"steeringMode":"x"}`; `{"compaction":{"reserveTokens":-1}}` | PUT raw | 400 naming field |
| E20 | Raw: command / array keys | EP | L1 | automated | raw `npmCommand:"curl x \| sh"`; `npmCommand:["npm"]`; `enabledModels:[123]`; `enabledModels:["a/b"]`; `packages:[42]`; `packages:["npm:x",{"source":"y"}]`; `shellPath:5`; `shellCommandPrefix:"x"`; `modelThinkingLevels:{"a":"loud"}`; `modelThinkingLevels:{"a":"high"}` | PUT raw | wrong types → 400 naming the key; correct types → 200 |
| E21 | Raw: legacy skills object | EP | L1 | automated | raw `{"skills":{"customDirectories":["~/s"]}}`; raw `{"skills":[1]}` | PUT raw | object → 200; `[1]` → 400 naming `skills` |
| E22 | Raw: size boundary | BVA | L1 | automated | raw body of 256 KiB − 1, 256 KiB, 256 KiB + 1 bytes (valid JSON padding) | PUT raw | ≤ 256 KiB → 200; +1 → 413 with `{success:false,error}` envelope; nothing written; reload fan-out not called |
| E23 | Raw: repair unparseable | state | L1 | automated | file truncated JSON, client holds raw-byte token | PUT raw valid text | 200; file parses |
| E24 | Raw: managed-key substitution | decision-table | L1 | automated | disk `defaultModel:"claude-opus-5-5"`, `defaultProvider:"anthropic"`; raw submits (a) `defaultModel:"other"`, (b) omits `defaultProvider`, (c) same values | PUT raw | file keeps disk values in all cases; `restoredKeys` = (a) `["defaultModel"]`, (b) `["defaultProvider"]`, (c) `[]` |
| E25 | Token: reformat / reorder | EP | L1 | automated | client token T; file rewritten with different whitespace + key order (incl. nested) | typed patch with T | 200 (no 409) |
| E26 | Token: managed keys excluded | EP | L1 | automated | client token T; then only `defaultModel` changed on disk | typed patch with T | 200 |
| E27 | Token: real change | state | L1 | automated | client token T; external write changes `steeringMode` | typed patch with T | 409 `{error:"stale", etag, settings, raw}`; external change still in file |
| E28 | Token: re-baseline | state | L1 | automated | successful patch returns `etag` E | second patch with E | 200 |
| E29 | Token: absent → created | state | L1 | automated | client token `"absent"`; another writer creates the file | typed patch with `"absent"` | 409 |
| E30 | First write creates file | state | L1 | automated | no file, no agent dir, token `"absent"` | typed patch `steeringMode:"all"` | 200; dir + file created with `steeringMode:"all"` |
| E31 | Symlink preserved | EP | L1 | automated | `settings.json` → symlink to `<tmp>/real.json` | typed patch | `lstat(settings.json)` still a symlink; `real.json` contains new value; lock artifact created at `settings.json.lock` (not `real.json.lock`) |
| E32 | File mode preserved | EP | L1 | automated | existing file mode `0600` | typed patch | file mode still `0600` |
| E33 | Mirror: split rules | EP | L1 | automated | dashboard `defaultModel` ∈ {`anthropic/claude-opus-5-5`, `openrouter/deepseek/deepseek-v4.1-flash`, `claude-opus-5-5`, ``} | `PUT /api/config` carrying it | pi `defaultProvider`/`defaultModel` = (`anthropic`,`claude-opus-5-5`) / (`openrouter`,`deepseek/deepseek-v4.1-flash`) / unchanged + `piMirror:{ok:true,skipped:"no-provider-separator"}` / unchanged |
| E34 | Mirror: thinking level | EP | L1 | automated | `defaultThinkingLevel` ∈ {`high`, `max`, ``, `loud`} | `PUT /api/config` | `high`/`max` mirrored; `` → pi unchanged; `loud` → pi unchanged (invalid level never mirrored) |
| E35 | Mirror: unrelated save | EP | L1 | automated | partial `{autoShutdown:true}` only | `PUT /api/config` | pi file byte-identical (mtime unchanged); no `piMirror` in response |
| E36 | Mirror: idempotent | EP | L1 | automated | pi already `anthropic`/`claude-opus-5-5`; save same dashboard value | `PUT /api/config` | pi file byte-identical (no rewrite) |
| E37 | Mirror: unparseable pi file | state | L1 | automated | pi file truncated JSON | `PUT /api/config` with new `defaultModel` | config.json has new value; 200; `piMirror:{ok:false,error:"parse"}`; pi file byte-identical |
| E38 | Drift repair | decision-table | L1 | automated | dashboard `anthropic/claude-opus-5-5` + `high`; pi `claude-opus-5` + `medium` | `POST /api/pi-settings/sync-defaults` | pi = `anthropic`/`claude-opus-5-5`/`high`; reload fan-out NOT called |
| E39 | Retry route: unparseable | state | L1 | automated | pi file truncated JSON | `PUT /api/pi-retry` valid policy | 400 parse error; file byte-identical; no reload |
| E40 | Retry route: values kept | EP | L1 | automated | file with `packages`, `extensions`, `dashboardPluginBridges`, `retry.someFutureKnob` | `PUT /api/pi-retry` | new `retry`; others deep-equal; `someFutureKnob` kept |
| E41 | Never touches project file | EP | L1 | automated | cwd with `.pi/settings.json` sentinel | every write endpoint (typed, raw, sync, retry, mirror) | sentinel byte-identical, mtime unchanged |
| E42 | pi lock parity guard | invariant | L1 | automated | installed `@earendil-works/pi-coding-agent` `dist/core/settings-manager.js` | read source / instantiate pi `SettingsManager.create(cwd, tmpAgentDir)` and write | pi's write takes `<agentDir>/settings.json.lock` with `realpath:false` (lock artifact observed or source pattern asserted); test fails if pi changes lock path/options |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Lock wait does not block other requests | tail-latency (timed) | L1 | automated | real `proper-lockfile` lock on the settings path held for the full retry budget (~200 ms+); one `PUT /api/pi-settings` waiting; concurrent `GET /api/pi-settings` (via `fastify.inject` on the same instance) issued 20 ms after the PUT | concurrent request latency < 50 ms; PUT then returns 503 | single run, repeated 5× (all 5 < 50 ms) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Unified Save converges in either order | state-convergence | L1 | automated | server test: token T; typed patch `steeringMode:"all"` and `PUT /api/config` `defaultModel:"anthropic/claude-opus-5-5"` | fire both concurrently, both orders, 20 iterations | every run: both 200 (no 409); file has `steeringMode:"all"` and `defaultModel:"claude-opus-5-5"` |
| F2 | Overlapping config saves converge | state-convergence | L1 | automated | two `PUT /api/config` with `anthropic/a` and `anthropic/b`, mirror lock artificially slowed for the first | concurrent | after both: pi `defaultModel` == model id of persisted dashboard `defaultModel` |
| F3 | Form edit commits via unified Save | state-transition | L1 | automated | `PiSettingsSection` with injected load/save; registered draft source `page:"sessions"` | change Steering mode, trigger host commit | save called with `{steeringMode}` + base token; after success section not dirty; NO Save button inside section (`queryByRole('button',{name:/save/i})` null) |
| F4 | 409 conflict UX | state-transition | L1 | automated | save rejects with 409 payload | commit | conflict notice + "Reload from disk" button rendered; save called exactly once (no auto-retry); clicking reload calls load and clears dirty |
| F5 | 400 keeps draft | state-transition | L1 | automated | JSON mode text `{ "a": 1,, }` (client) / server 400 errors | commit | per-field errors rendered; source stays dirty; commit throws (host marks failed) |
| F6 | 413 / 503 as failed commit | state-transition | L1 | automated | save rejects 413, then 503 | commit | error shown; source stays dirty |
| F7 | Mode switch while dirty | state-transition | L1 | automated | Form draft dirty | click JSON | discard/stay prompt; stay → Form with draft intact; discard → JSON with last-loaded raw, not dirty |
| F8 | Managed keys read-only (Form) | EP | L1 | automated | loaded settings with the 3 default keys | render Form | values shown as non-editable text (no input/select for them) + note referencing Default model |
| F9 | Managed-key notice (JSON) | EP | L1 | automated | JSON draft changes `defaultModel` value | edit | notice "managed by Default model" visible before save; unchanged draft → no notice |
| F10 | Drift action visibility | decision-table | L1 | automated | (dashboard, pi) ∈ {(`anthropic/x`, `x`+`anthropic`), (`anthropic/x`, `y`), (``, `y`), (`x` no slash, `y`)} | render | action shown only for row 2; click calls `syncPiDefaults` |
| F11 | Mirror warning / skip notice | EP | L1 | automated | `SettingsPanel` config save response `piMirror:{ok:false,error:"busy"}` / `{ok:true,skipped:"no-provider-separator"}` / absent | Save | warning / info notice inside Default Model callout; Save Bar shows saved state; absent → no notice |
| F12 | Section order + notes | EP | L1 | automated | Sessions page render | render `SettingsPanel` Sessions | pi settings section is the next sibling after Retry; "reloads running sessions" and "global only; project may override" notes present |
| F13 | End-to-end editor in the real UI | state-convergence | L3 | automated | docker harness; Settings → Sessions | change Steering mode in Form, Save; read `GET /api/pi-settings` | API reports new value; page not dirty; JSON mode shows it |
| F14 | End-to-end default-model mirror | state-convergence | L3 | automated | docker harness (faux seed); Settings → Sessions Default model picker | select a `provider/id` model, Save; then `GET /api/pi-settings` | pi `defaultProvider`/`defaultModel` equal the selected model's split; drift action not shown |
| F15 | JSON editor ergonomics on mobile | visual/subjective | — | manual-only | phone-width viewport, Monaco editor | human edits a key and saves | [judgment: editor usable / readable at 375 px — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Held lock → 503 (editor) | fault-injection (abort) | L1 | automated | real lock held on settings path beyond budget | typed patch; raw PUT | 503 `{error:"busy"}`; file byte-identical; reload not called |
| X2 | Held lock → 503 (symlink) | fault-injection (abort) | L1 | automated | `settings.json` symlink; lock held on the LINK path | typed patch | 503; link target byte-identical |
| X3 | Held lock → 503 (retry route) | fault-injection (abort) | L1 | automated | lock held beyond budget | `PUT /api/pi-retry` | 503; file byte-identical; no reload |
| X4 | Lock released briefly | fault-injection (delay) | L1 | automated | lock held 60 ms then released | typed patch | 200 (acquired within budget); value written |
| X5 | Stale lock reclaimed | fault-injection (abort) | L1 | automated | `settings.json.lock` dir with mtime 11 s in the past, no holder | typed patch | 200 |
| X6 | tmp write fails | fault-injection (abort) | L1 | automated | `FsDeps.writeFile` throws for the tmp path | typed patch | error result; target byte-identical; no tmp left behind; no reload |
| X7 | Mirror busy | fault-injection (abort) | L1 | automated | lock held beyond budget | `PUT /api/config` new `defaultModel` | 200; config.json updated; `piMirror:{ok:false,error:"busy"}`; pi file unchanged |
| X8 | Reload only on success | decision-table | L1 | automated | 2 fake connected sessions | typed 200, raw 200, then 400/409/413/503 for each endpoint | `reloadedSessions:2` on successes; reload fan-out call count unchanged on every rejection |
| X9 | pi flush after dashboard write | fault-injection (ordering) | L1 | automated | real pi `SettingsManager` on tmp agent dir: `setSteeringMode("one-at-a-time")` (not flushed) | dashboard typed patch `compaction.reserveTokens=20000`, then `await sm.flush()` | file: `steeringMode:"one-at-a-time"` (pi wins its own field) AND `compaction.reserveTokens:20000` (dashboard field kept) |
| X10 | Network guard | EP | L1 | automated | request failing `networkGuard` (non-trusted remote, auth on) | GET / PUT typed / PUT raw / POST sync | rejected with the same status as `PUT /api/config` under the same request; nothing written |
| X11 | Write logs never leak values | invariant | L1 | automated | raw PUT containing `"httpProxy":"http://user:secret@h"` | success + 400 + 409 | captured log lines contain outcome + reload count, never `secret` |

---

## Coverage summary

- Requirements covered: 14/14 (editor: read, typed, raw, managed keys, concurrency, lock, reload, drift
  repair, UI section; settings-panel: mirror, section order; pi-retry-settings: merge/unparseable, lock)
- Scenarios by class: edge 42 · perf 1 · frontend 15 · error 11
- Scenarios by level: L1 66 · L2 0 · L3 2 · manual 1
- Scenarios by disposition: automated 68 · manual-only 1

## New infra needed

- none (new spec files reuse existing harnesses: vitest + `fastify.inject`, RTL, Playwright docker harness)
