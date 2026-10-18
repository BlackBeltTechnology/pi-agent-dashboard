# Test Plan — audit-plugin-bundles-non-secure-context

Stage: design   Generated: 2026-10-18

Hard gate cleared via `ask_user` on 2026-10-18:
- **Q1:** latest click wins for out-of-order plugin copies. The spec delta gained the scenario "Rapid plugin copies resolve out of order".
- **Q2:** "Media capture on an http LAN origin" is scan-only in this change. Its behavioural test belongs to the first change that adds a `navigator.mediaDevices` caller (design D4).

Requirement refs (all in `specs/lan-knock-pairing/spec.md`, MODIFIED "Dashboard works from a non-secure LAN origin"):

| Ref | Scenario |
|---|---|
| S-resume | Resume from Settings on an http LAN origin |
| S-copy | Copy without the clipboard API |
| S-pfail | Plugin Copy action without the clipboard API |
| S-pok | Plugin Copy action falls back in a non-secure context |
| S-race | Rapid plugin copies resolve out of order |
| S-media | Media capture on an http LAN origin |
| S-scan | New plugin code calls a secure-context API bare |
| INV | Invariant: no behaviour change in a secure context (proposal) |

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | S-resume | EP (API absent) | L1 | automated | `crypto.randomUUID` deleted; `crypto.getRandomValues` present | `randomUuid()` from `@blackbelt-technology/dashboard-plugin-runtime`, called 1000× | every value matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`; 1000 distinct values; no throw |
| E2 | INV | EP (API present) | L1 | automated | `crypto.randomUUID` stubbed to return `"11111111-1111-4111-8111-111111111111"` | `randomUuid()` (runtime) | returns exactly the stub value; stub called once; `getRandomValues` not called |
| E3 | INV | EP (API present) | L1 | automated | `navigator.clipboard.writeText` stub resolves | `copyText("x")` (runtime) | resolves `true`; `writeText` called with `"x"`; `document.execCommand` not called; no `<textarea>` left in `document.body` |
| E4 | S-copy | decision-table: clipboard absent × execCommand true | L1 | automated | `navigator.clipboard` undefined; `document.execCommand` stub returns `true` | `copyText("x")` | resolves `true`; `execCommand("copy")` called once; `document.body` has 0 `<textarea>` afterwards |
| E5 | S-copy | decision-table: clipboard rejects × execCommand true | L1 | automated | `writeText` rejects `NotAllowedError`; `execCommand` returns `true` | `copyText("x")` | resolves `true` via fallback; no unhandled rejection |
| E6 | S-copy / S-pfail | decision-table: clipboard absent × execCommand false | L1 | automated | `navigator.clipboard` undefined; `execCommand` returns `false` | `copyText("x")` | resolves `false`; 0 `<textarea>` left |
| E7 | S-copy | decision-table: clipboard absent × execCommand throws | L1 | automated | `navigator.clipboard` undefined; `execCommand` throws | `copyText("x")` | resolves `false` (no throw); 0 `<textarea>` left |
| E8 | S-resume | re-export equivalence | L1 | automated | client module `packages/client/src/lib/util/random-uuid.ts` + `clipboard.ts` after D1 | import `randomUuid` / `copyText` from the client paths and from the runtime barrel | client exports are `===` the runtime exports; existing `random-uuid.test.ts` (E29 spawn dispatch) stays green |
| E9 | S-scan | EP over syntactic forms (fixture self-test) | L1 | automated | in-memory fixture sources, one form each: `navigator.clipboard.writeText(s)`, `navigator?.clipboard`, `navigator["clipboard"]`, `navigator?.["clipboard"]`, `crypto.randomUUID()`, `crypto?.subtle`, `globalThis.crypto.subtle`, `window["navigator"]`, `const { clipboard } = navigator;`, `const { randomUUID } = globalThis.crypto;`, `navigator.mediaDevices`, `m.getUserMedia(x)`, `m?.getUserMedia?.(x)`, `x.getDisplayMedia()` | run the scan matcher on each fixture | every fixture reports ≥ 1 hit |
| E10 | S-scan | EP over non-code forms (fixture self-test) | L1 | automated | fixtures: `// navigator.clipboard.writeText(s)`, `/* crypto.randomUUID() */`, `` const u = `${p}//${h}`; const ok = 1; ``, `const r = /\/\//; const ok = 1;`, `const s = "/*"; const ok = 1;` | scan matcher (parser-based comment stripping) | commented forms → 0 hits; template/regex/string fixtures → 0 hits; a real `navigator.clipboard` call appended after each of the last three → exactly 1 hit |
| E11 | S-scan | root derivation: manifest outside `src/client` | L1 | automated | repo at HEAD | compute scan roots | roots include `quota-plugin/src`, `demo-plugin/src`, `flows-anthropic-bridge-plugin/src`, `grammar-plugin/src`, `roles-plugin/src` and every existing `packages/*/src/client`; exclude each manifest's `server`/`bridge` entry dirs and `dashboard-plugin-runtime/src/{server,bridge,vite-plugin,test-support}`; no root path appears twice (realpath dedupe) |
| E12 | S-scan | root derivation: package without client | L1 | automated | `fixture-policy-plugin`, `keycloak-resolver-plugin`, `mcp-server-plugin` (no `src/client`, no manifest client) | compute scan roots | no ENOENT thrown; none of the three appears in roots |
| E13 | S-scan | red→green on the real tree | L1 | automated | repo after task 1.1, before 3.x | run `secure-context-scan.test.ts` | fails with exactly 2 offenders: `gmail-plugin/src/client/GmailSettings.tsx`, `kb-plugin/src/client/KbTestSearch.tsx`; after 3.1+3.2 → 0 offenders |
| E14 | S-scan | allowlist integrity | L1 | automated | allowlist adds `dashboard-plugin-runtime/src/secure-context.ts` and `client-utils/src/identity/login-flow.ts`, and removes the two client util entries | run the scan | every allowlist entry exists on disk; the two client util paths no longer allowlisted and produce 0 hits (re-exports only) |
| E15 | S-media | scan-only enforcement (Q2) | L1 | automated | fixture `packages/<fixture>/src/client/Mic.tsx` content `navigator.mediaDevices.getUserMedia({audio:true})` (in-memory, via the matcher + root-membership check) | scan | flagged as an offender unless its path is allowlisted |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | S-pfail | state (fail path) | L1 | automated | `KbTestSearch` rendered with one hit (`path: "docs/a.md"`); `navigator.clipboard` undefined; `execCommand` returns `false` | click the hit's Copy | `kb-search-copy-failed` present with `aria-live="polite"`; `kb-search-copied` absent; no throw |
| F2 | S-pok | state (fallback ok) | L1 | automated | same hit; `navigator.clipboard` undefined; `execCommand` returns `true` | click Copy | `await waitFor` → `kb-search-copied` present; `kb-search-copy-failed` absent |
| F3 | INV | regression of existing F9 | L1 | automated | `navigator.clipboard.writeText` stub resolves (existing F9 setup, `KbSourcesSearch.test.tsx:412-421`) | click Copy | `writeText` called with the path; `kb-search-copied` appears via `await waitFor`; indicator cleared after 1500 ms (fake timers) |
| F4 | S-race | state-convergence (latest wins) | L1 | automated | two hits A, B; `copyText` deferred per call (A's promise resolved after B's); A → `false`, B → `true` | click Copy A, then Copy B, resolve B, then resolve A | after both settle: `kb-search-copied` shown for B; no failure indicator for A; indicator still B after A resolves |
| F5 | S-pfail | state (fail path) | L1 | automated | Gmail settings `Copyable` (`value: "gcloud ..."`); `navigator.clipboard` undefined; `execCommand` returns `false` | click Copy | button label text becomes "Copy failed" inside a `role="status"` region; never "Copied"; reverts to "Copy" after 1500 ms (fake timers) |
| F6 | S-pok | state (fallback ok) | L1 | automated | same `Copyable`; `navigator.clipboard` undefined; `execCommand` returns `true` | click Copy | label "Copied" in `role="status"`; reverts to "Copy" after 1500 ms |
| F7 | S-race | state-convergence (latest wins) | L1 | automated | `Copyable`; `copyText` deferred; first call → `false` settles after second call → `true` | click twice, resolve 2nd then 1st | final label "Copied"; never switches to "Copy failed" after the 2nd settled |
| F8 | INV | i18n parity | L1 | automated | `copyFailed` (kb, gmail) and `copied` (gmail) added to `zh-CN` and `hu` maps | run `packages/kb-plugin/src/__tests__/i18n.test.ts` and gmail `client-entry.test.tsx` | both parity tests green; the zh-CN/hu string for each new key is non-empty |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | S-pfail | fault-injection (abort) | L1 | automated | `navigator.clipboard.writeText` rejects `NotAllowedError` **and** `execCommand` throws | click kb Copy | no unhandled rejection (vitest `unhandledRejection` hook stays empty); `kb-search-copy-failed` shown |
| X2 | S-media | out of scope here (Q2) | — | manual-only | no `navigator.mediaDevices` caller exists in any client root | first caller lands (e.g. `add-voice-assistant-dashboard-plugin`) | [judgment: the owning change adds the behavioural "reports unavailable, no throw" test; ship-change records the handoff post-merge] |

### Performance

None. No latency, throughput or memory budget applies (proposal: Discipline Skills).

---

## Coverage summary

- Requirements covered: 8/8 (S-media is scan-enforced by E15; its behavioural half is deferred via X2)
- Scenarios by class: edge 15 · perf 0 · frontend 8 · error 2
- Scenarios by level: L1 24 · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 24 · manual-only 1

## New infra needed

None. All L1. Exemplars to copy from:
- runtime: `packages/dashboard-plugin-runtime/src/__tests__/oauth-flow-client.test.ts`
- copy UI with fallback: `packages/client/src/components/__tests__/CopyButton.test.tsx`
- kb: `packages/kb-plugin/src/client/__tests__/KbSourcesSearch.test.tsx`
- gmail: `packages/gmail-plugin/src/client/__tests__/panel.test.tsx`
- scan: `packages/client/src/components/connectivity/__tests__/secure-context-scan.test.ts`

No rendered-UI e2e is needed, because every observable is a DOM or state fact that jsdom reaches.
