## 1. Announce script

- [x] 1.1 Add `scripts/discord-release-announce.mjs`: exports `splitBody(body, limit)` (for non-empty `b` the invariant `splitBody(b).join("") === b` holds, segments keep trailing newline, segments longer than limit are hard-split, `splitBody("")` returns an empty array), `buildPayloads(release, tag)` (one embed per payload with title, url, color, description; empty body yields one `_No release notes._` payload; name falls back to tag and is shortened with `…` so title is at most 256 chars; `allowed_mentions` is `{ parse: [] }`), and `postPayloads(payloads, url, { fetch, sleep })` (sequential `?wait=true` posts, HTTP 429 retried after `retry_after` up to 5 times, abort when `retry_after` exceeds 60 seconds, other failures throw with Discord status and body but never the webhook URL); `main()` reads `<release.json> [tag]`, skips with exit 0 when `DISCORD_WEBHOOK_URL` is unset, delegates to `postPayloads`

## 2. Workflow

- [x] 2.1 In `.github/workflows/publish.yml` `discord-announce`: add an `actions/checkout@v4` step with sparse checkout of `scripts/discord-release-announce.mjs`; in the run block keep the unset-secret skip and `gh release view "$TAG" ... > release.json` with `GH_TOKEN`, and replace the inline `jq` payload and `curl` with `node scripts/discord-release-announce.mjs release.json "$TAG"` in the same working directory; do not add `setup-node` or any cache key; keep `needs`, `if`, `continue-on-error: true`, `permissions: contents: read`; update the job comment block
- [x] 2.2 Update `packages/shared/src/__tests__/publish-workflow-contract.test.ts` discord-announce D6 to assert the job runs `node scripts/discord-release-announce.mjs` and that `scripts/discord-release-announce.mjs` contains `allowed_mentions: { parse: [] }`, and add an assertion that the block contains no `actions/cache`, `setup-node`, or `cache:` key

## 3. Tests (folded from test-plan.md)

Unit tests live in `scripts/__tests__/discord-release-announce.test.mjs` (vitest, import the script's exports; harness exemplar: see `scripts/__tests__/check-pi-settings-paths.test.mjs` for direct-import style and `scripts/__tests__/assert-bundled-plugins-complete.test.mjs` for subprocess style). Contract tests extend the existing discord-announce describe block (harness exemplar: see `packages/shared/src/__tests__/publish-workflow-contract.test.ts` D1-D6 using `extractJobBlock`).

- [x] 3.1 Short body posts as one payload (test-plan #E1): input release name v1.2.3 with a 3-line body · trigger `buildPayloads(release)` · observable 1 payload, title `Released v1.2.3`, embed url equals release url, description equals body
- [x] 3.2 4000-char boundary (test-plan #E2): input multi-line body of exactly 4000 chars and the same plus 1 char · trigger `splitBody(body, 4000)` · observable 4000 gives 1 chunk, 4001 gives 2 chunks each at most 4000 and `join("")` equals body
- [x] 3.3 Long body posts in full with numbered titles (test-plan #E3): input 600 lines of about 50 chars · trigger `buildPayloads(release)` · observable N above 1 payloads, each description at most 4000, descriptions `join("")` equal body, payload i of 2..N titled `Released v1.2.3 (i/N)`, every embed carries the release url
- [x] 3.4 Overlong single line is hard-split (test-plan #E4): input one line of 9000 `x` · trigger `splitBody(body, 4000)` · observable chunk lengths 4000, 4000, 1000 and `join("")` equals body
- [x] 3.5 Exact round-trip with CRLF and trailing newline (test-plan #E5): input body mixing short lines, one 5000-char line, CRLF endings and a trailing newline · trigger `splitBody(body, 4000)` · observable every chunk at most 4000 and `join("")` is byte-identical to body
- [x] 3.6 Empty body placeholder (test-plan #E6): input body empty string · trigger `splitBody("")` and `buildPayloads` · observable `splitBody` returns an empty array and `buildPayloads` returns 1 payload with description `_No release notes._`
- [x] 3.7 Unnamed release uses tag (test-plan #E7): input empty name and tag v9.9.9 · trigger `buildPayloads(release, "v9.9.9")` · observable title `Released v9.9.9`
- [x] 3.8 Title fits 256 chars (test-plan #E8): input 300-char name with a body forcing 3 payloads · trigger `buildPayloads(release)` · observable every title at most 256 chars, shortened name ends with `…`, suffix ` (2/3)` intact
- [x] 3.9 Mentions suppressed on every payload (test-plan #E9): input about 12000-char body containing `@everyone`, `@here`, `<@123>`, `<@&456>` · trigger `buildPayloads(release)` · observable every payload `allowed_mentions` deep-equals `{ parse: [] }`
- [x] 3.10 Contract D6 follows the script (test-plan #E10): input publish.yml and the script file · trigger contract test on the discord-announce block · observable block contains `node scripts/discord-release-announce.mjs` and the script contains `allowed_mentions: { parse: [] }`
- [x] 3.11 Contract keeps best-effort and no-cache posture (test-plan #E11): input discord-announce job block · trigger contract tests D1-D5 plus the new no-cache assertion · observable D1-D5 pass and the block has no `actions/cache`, `setup-node`, or `cache:` key
- [x] 3.12 Unset webhook skips (test-plan #X1): input `DISCORD_WEBHOOK_URL` unset with a valid release.json · trigger run the script as a subprocess · observable exit 0, stdout contains `skipping`, no network attempted
- [x] 3.13 Webhook failure stops and hides the URL (test-plan #X2): input injected fetch returning 500 with body `{"message":"boom"}` on payload 2 of 3 · trigger `postPayloads(payloads, url, { fetch, sleep })` · observable rejects with text containing `500` and `boom`, text excludes the webhook URL and token, fetch called exactly 2 times
- [x] 3.14 Rate limit is retried in order (test-plan #X3): input injected fetch returning 429 with `retry_after` 0.01 then 200 for payload 1 · trigger `postPayloads` · observable payload 1 sent twice then payload 2, sleep called once with at least 10 ms
- [x] 3.15 Rate-limit retry cap (test-plan #X4): input injected fetch always returning 429 with `retry_after` 0.01 · trigger `postPayloads` · observable rejects after 6 fetch calls, no 7th call
- [x] 3.16 Long rate-limit wait aborts (test-plan #X5): input injected fetch returning 429 with `retry_after` 120 · trigger `postPayloads` · observable rejects immediately, sleep never called
- [x] 3.17 Real release renders in Discord (test-plan: manual-only, #M1): on the next non-prerelease tag, check `#releases` shows `Released <tag>` plus numbered continuations, readable Markdown, no pings

## 4. Docs

- [x] 4.1 `scripts/AGENTS.md`: add rows for `discord-release-announce.mjs` and `__tests__/discord-release-announce.test.mjs`
- [x] 4.2 `.github/workflows/publish.yml.AGENTS.md`: update the discord-announce description (sparse checkout and node script, full body split, no 3800 cap)
- [x] 4.3 `docs/release-process.md` (via DocScribe): replace "body truncated at 3800 chars" with full-body split posting, name the script, and document partial-failure recovery (delete partial messages, re-run the failed job)

## 5. Ship-gate repair (pre-existing on develop)

- [x] 5.1 Restore the knip dead-code ratchet to baseline (exports 232 > 231, types 190 > 189 on develop since `663d538a3`): drop the unused `export` from `EVENT_STREAM_HEARTBEAT_MS` in `packages/server/src/routes/agent-event-stream-routes.ts` and from `AgentEventListener` in `packages/server/src/agent-events/agent-event-hub.ts` (both file-internal only)
