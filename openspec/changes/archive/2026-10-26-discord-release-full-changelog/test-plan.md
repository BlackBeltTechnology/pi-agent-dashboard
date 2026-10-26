# Test Plan — discord-release-full-changelog

Stage: design   Generated: 2026-10-26

No clarifications needed: every Triple resolved from spec.md + design.md.

Levels: `L1` = vitest `scripts/__tests__/discord-release-announce.test.mjs` (pure fns + injected `fetch`/`sleep`, no network); `ci` = workflow-shape contract `packages/shared/src/__tests__/publish-workflow-contract.test.ts` (discord-announce D1-D6).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | full notes / short body | EP (nominal) | L1 | automated | release `{name:"v1.2.3", url, body:"## Added\n- a\n- b"}` | `buildPayloads(release)` | 1 payload; embed title `Released v1.2.3`, `url` = release url, description = body |
| E2 | full notes / 4000 cap | BVA | L1 | automated | multi-line body of exactly 4000 chars; same body + 1 char (4001) | `splitBody(body, 4000)` | 4000 → 1 chunk; 4001 → 2 chunks, each ≤ 4000, `join("")` = body |
| E3 | full notes / long body | EP (large) | L1 | automated | 600 lines × ~50 chars (~30 000 chars) | `buildPayloads(release)` | N > 1 payloads in order; each description ≤ 4000; descriptions `join("")` = body; payload i≥2 title `Released v1.2.3 (i/N)`; every embed has release `url` |
| E4 | full notes / overlong line | BVA | L1 | automated | single line of 9000 `x` | `splitBody(body, 4000)` | chunks lengths `[4000, 4000, 1000]`; `join("")` = body |
| E5 | full notes / exact round-trip | EP (mixed) | L1 | automated | body mixing short lines, one 5000-char line, CRLF `\r\n` endings, trailing `\n` | `splitBody(body, 4000)` | every chunk ≤ 4000; `join("")` === body byte-exact (CRLF + trailing newline kept) |
| E6 | full notes / empty body | BVA (min) | L1 | automated | body `""` | `splitBody("")`; `buildPayloads({...release, body:""})` | `splitBody` → `[]`; `buildPayloads` → 1 payload, description `_No release notes._` |
| E7 | full notes / unnamed release | EP | L1 | automated | name `""`, tag `v9.9.9` | `buildPayloads(release, "v9.9.9")` | title `Released v9.9.9` |
| E8 | full notes / title limit | BVA (max) | L1 | automated | name of 300 chars, body forcing N = 3 | `buildPayloads(release)` | every title ≤ 256 chars; shortened name ends with `…`; suffix ` (2/3)` intact |
| E9 | no pings | EP | L1 | automated | body with `@everyone`, `@here`, `<@123>`, `<@&456>`, ~12 000 chars | `buildPayloads(release)` | every payload has `allowed_mentions` deep-equal `{ parse: [] }` |
| E10 | no pings / workflow shape (D6) | contract | ci | automated | `.github/workflows/publish.yml` + `scripts/discord-release-announce.mjs` | contract test extracts `discord-announce` block | block contains `node scripts/discord-release-announce.mjs`; script file contains `allowed_mentions: { parse: [] }` |
| E11 | best-effort + no-cache posture | contract | ci | automated | `discord-announce` job block | contract test D1-D5 + new no-cache assertion | D1-D5 still pass (needs, `if` gating incl. prerelease, `continue-on-error: true`, secret via env, unset-secret skip); block contains no `actions/cache`, `setup-node`, or `cache:` key |

### Performance

None: no latency/throughput budget in spec.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | best-effort / unset secret | fault-injection (missing config) | L1 | automated | `DISCORD_WEBHOOK_URL` unset | run script as subprocess with a valid `release.json` | exit 0; stdout contains `skipping`; no network attempted |
| X2 | best-effort / webhook failure | fault-injection (abort) | L1 | automated | injected `fetch` returns 500 `{"message":"boom"}` on payload 2 of 3 | `postPayloads(payloads, url, {fetch, sleep})` | rejects with error containing `500` and `boom`; error text excludes webhook URL/token; payload 3 never sent (fetch called 2×) |
| X3 | best-effort / 429 retry | fault-injection (delay) | L1 | automated | injected `fetch`: payload 1 → 429 `{retry_after:0.01}` then 200 | `postPayloads` | payload 1 sent twice, then payload 2; `sleep` called once with ≥ 10 ms; order preserved |
| X4 | best-effort / 429 cap | fault-injection (repeat) | L1 | automated | injected `fetch` always 429 `{retry_after:0.01}` | `postPayloads` | rejects after 6 calls (1 + 5 retries); no 7th call |
| X5 | best-effort / 429 long wait | BVA (above max) | L1 | automated | injected `fetch` 429 `{retry_after:120}` | `postPayloads` | rejects immediately; `sleep` never called |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | full notes / real render | visual | — | manual-only | next non-prerelease tag | Release workflow `discord-announce` | [judgment: `#releases` shows `Released <tag>` + numbered continuations, readable Markdown, no pings] |

---

## Coverage summary

- Requirements covered: 3/3 (full notes, no pings, best-effort)
- Scenarios by class: edge 11 · perf 0 · frontend 0 · error 5 · manual 1
- Scenarios by level: L1 14 · ci 2 · manual 1
- Scenarios by disposition: automated 16 · manual-only 1

## New infra needed

- none (X2-X5 require the script to export `postPayloads(payloads, url, { fetch, sleep })`; `main()` delegates to it)
