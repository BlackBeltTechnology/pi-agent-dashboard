# Test Plan — settings-default-model-without-session

Stage: design   Generated: 2026-08-12

Hard gate cleared: three unfillable observable slots (in-flight state, refetch concurrency,
fetch timeout) were resolved with the user and folded into the spec delta as a new requirement
before this catalog was written. No `[NEEDS CLARIFICATION]` markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Union of catalogue + session models | decision-table | L1 | automated | catalogue `[A]`, sessions `{}` | build default-model options | options === `[A]` (zero-session case resolves to catalogue) |
| E2 | Union of catalogue + session models | decision-table | L1 | automated | catalogue `[A]`, session s1 `[B]` | build default-model options | options === `[A,B]`, length 2, no duplicate fqid |
| E3 | Session entry wins on collision | decision-table | L1 | automated | catalogue row `openai/gpt-5` no `name`; session row `openai/gpt-5` `name:"GPT-5"`, `metadataSource:"catalog"` | build options | exactly one `openai/gpt-5`; its `name === "GPT-5"` and `metadataSource === "catalog"` |
| E4 | Union of catalogue + session models | decision-table | L1 | automated | catalogue `[]`, session s1 `[B]` (env-credentialed provider) | build options | options === `[B]` — env-credentialed model still offered |
| E5 | Union of catalogue + session models | decision-table | L1 | automated | catalogue `[A]`, sessions s1 `[A]`, s2 `[A]` | build options | exactly one `A` (dedupe across multiple sessions) |
| E6 | Mapper: provider from row field | EP | L1 | automated | row `{provider:"openrouter", id:"openrouter/meta-llama/llama-3-70b"}` | map row | `{provider:"openrouter", id:"meta-llama/llama-3-70b"}` |
| E7 | Mapper: provider from row field | BVA (pathological) | L1 | automated | row `{provider:"my/proxy", id:"my/proxy/some-model"}` | map row | `{provider:"my/proxy", id:"some-model"}` — not split on first slash |
| E8 | Mapper: vision derivation | EP | L1 | automated | row `input:["text","image"]` | map row | `vision === true` |
| E9 | Mapper: vision derivation | EP | L1 | automated | row `input:["text"]` | map row | `vision === false` |
| E10 | Mapper: vision derivation | BVA (absent slot) | L1 | automated | row with no `input` property | map row | returns normally, `vision === undefined`, no throw |
| E11 | Mapper: field projection | decision-table | L1 | automated | row with `thinkingLevelMap`, `maxTokens`, `cost`, `reasoning`, `contextWindow` | map row | result has `reasoning` + `contextWindow`; has NO `metadataSource`, `supportedThinkingLevels`, `thinkingLevelMap`, `maxTokens`, `cost` |
| E12 | Proxy editors read the catalogue alone | decision-table | L1 | automated | catalogue `[A]`, session s1 `[B]` | build proxy-section options | proxy options === `[A]`; default-model options === `[A,B]` (two distinct values from one build) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Bounded catalogue timeout | threshold | L1 | automated | fetch stub that never resolves | unavailable callout rendered at ≤ 10s + scheduler tolerance, using fake timers | single fetch |
| P2 | Union build cost | micro-perf (timed unit) | L1 | automated | catalogue 500 rows × 10 sessions × 200 rows | union build p95 < 50ms, no quadratic blowup (Set-keyed dedupe) | 100 iterations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Loading state | state-transition | L1 | automated | fetch pending | render Sessions settings page | loading state present; empty state absent; unavailable callout absent |
| F2 | Loading state clears | state-transition | L1 | automated | fetch pending → resolves 200 non-empty | response arrives | converges to options rendered; loading state gone |
| F3 | Last-response-wins | state-convergence | L1 | automated | R1 issued then R2 issued; R2 resolves first, R1 second | both responses land | converges to R1's payload (last response, not last request) |
| F4 | Zero-session usability | state-transition | L3 | automated | docker harness with dashboard up and NO pi session connected | open `/settings/sessions`, open the Default Model control | control is populated and a model can be selected + saved; reload shows the saved `defaultModel` |
| F5 | Session arrives while Settings open | state-convergence | L3 | automated | Settings open with zero sessions; then a pi session connects and pushes `models_list` | session connects | options converge to the union — catalogue rows retained, session rows added, no duplicate rows |
| F6 | Callout placement + readability | visual/subjective | — | manual-only | Sessions settings page with the catalogue unavailable | human looks at the page | [judgment: callout reads clearly and sits sensibly beside the control — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Catalogue-unavailable callout | fault-injection (abort) | L1 | automated | `GET /api/models` → `503 {code:"MODEL_PROXY_RUNTIME_MISSING"}` | render Sessions settings page | unavailable callout rendered |
| X2 | Catalogue-unavailable callout | fault-injection (abort) | L1 | automated | fetch rejects with a network error | render page | unavailable callout rendered (not the empty state) |
| X3 | Catalogue-unavailable callout | fault-injection (abort) | L1 | automated | `GET /api/models` → `500` | render page | unavailable callout rendered — non-503 failures are covered too |
| X4 | Empty is not an error | fault-injection (boundary) | L1 | automated | `200 {object:"list", data:[]}` | render page | empty state rendered; unavailable callout NOT rendered |
| X5 | Degradation preserves session models | fault-injection (abort) | L1 | automated | catalogue fetch fails; session s1 has `models_list` `[B]` | render Default Model control | options === `[B]` — the union degrades to the session side, control stays usable |
| X6 | Bounded timeout | fault-injection (delay) | L1 | automated | fetch never settles | 10s elapse (fake timers) | unavailable callout rendered; loading state cleared |
| X7 | Refetch on API-key save | fault-injection (ordering) | L1 | automated | API-key save resolves 200; registry still pre-refresh so catalogue response omits the new provider | save succeeds | exactly one new `GET /api/models` is issued, triggered by the save response — no fixed delay/`setTimeout` in the trigger path |
| X8 | Refetch on OAuth completion | state-transition | L1 | automated | OAuth / device-code authorization completes successfully | completion callback fires | a new `GET /api/models` is issued |
| X9 | Refetch on provider removal | state-transition | L1 | automated | custom provider `Q` removed, save resolves 200 | save succeeds | new `GET /api/models` issued; `Q`'s models absent from options unless a live session still reports them |

---

## Coverage summary

- Requirements covered: 7/7 (union source · proxy-editor source · shared mapper · refetch triggers · loading+timeout+concurrency · unavailable callout · modified provider-save requirement)
- Scenarios by class: edge 12 · perf 2 · frontend 6 · error 9 — total 29
- Scenarios by level: L1 25 · L2 0 · L3 2 · manual-only 1 (+ `—`)
- Scenarios by disposition: automated 28 · manual-only 1

## New infra needed

None. L1 rows extend the existing vitest suites (`packages/client/src/components/__tests__/SettingsPanel.test.tsx`, a new shared mapper test beside `packages/shared/src/__tests__/`); L3 rows extend the existing Playwright suite against the docker harness port from `.pi-test-harness.json`. No qa/ VM smoke rows — nothing here is process/install/multi-OS.
