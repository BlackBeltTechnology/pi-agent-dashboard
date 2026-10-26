## Context

`discord-announce` (`.github/workflows/publish.yml:914`) runs one shell step: skip when `DISCORD_WEBHOOK_URL` is unset (`publish.yml:930`), `gh release view "$TAG" --json name,url,body > release.json` with `GH_TOKEN` (`publish.yml:934`), an inline `jq` payload cutting `.body` at 3800 chars (`publish.yml:943`), and `curl` (`publish.yml:947`). Its shape is pinned by `packages/shared/src/__tests__/publish-workflow-contract.test.ts:781-813` (D1-D6); D6 asserts the literal `allowed_mentions: { parse: [] }` inside the job block. Discord limits: embed title ≤ 256 chars, description ≤ 4096, ≤ 6000 embed chars per message. v0.10.0 body = 37 114 chars (~10 messages).

## Goals / Non-Goals

Goals: post the whole body; keep gating, best-effort semantics, mention suppression, and the no-cache release-privileged posture.
Non-goals: role pings, crossposting, manual re-post `workflow_dispatch`, Discord server admin.

## Decisions

1. **Node script over inline jq.** `scripts/discord-release-announce.mjs` exports pure `splitBody(body, limit)` + `buildPayloads(release, tag)` (vitest: `scripts/__tests__/discord-release-announce.test.mjs`) and a `main()` guarded by `import.meta.url === pathToFileURL(argv[1])`. Zero deps; uses the runner's Node global `fetch` (Node ≥ 18). No `setup-node`, no cache keys.
2. **Shell keeps the skip + fetch.** The `if [ -z "${DISCORD_WEBHOOK_URL:-}" ]` skip and `gh release view … > release.json` (with `GH_TOKEN`) stay in the run block, so D4/D5 still hold; the script runs in the same working directory. The script also skips when the URL is unset (defence in depth).
3. **Chunking invariant (non-empty body): `splitBody(body).join("") === body`.** Split into segments that each keep their trailing `\n` (so CRLF `\r\n` and a trailing newline survive). Greedily pack segments into chunks ≤ 4000; a segment longer than 4000 is hard-split into ≤ 4000 pieces. `splitBody("")` → `[]`; `buildPayloads` substitutes one `_No release notes._` payload.
4. **One embed per message**, every embed carries `title`, the release `url`, `color`, `description`. Title `Released <name>` / `Released <name> (<i>/<N>)`; `<name>` = release name or tag, shortened with `…` so the title ≤ 256. One embed keeps each message far under 6000.
5. **`?wait=true` sequential posts; 429 → wait `retry_after`, max 5 retries per payload, any single `retry_after` > 60 s aborts**, then exit non-zero. Fits the job's `timeout-minutes: 5` (`publish.yml:918`) for normal releases.
6. **Sparse checkout of the single script** (`actions/checkout@v4`, `sparse-checkout-cone-mode: false`). `actions/checkout` is not a cache, so "Release-privileged jobs do not restore a dependency cache" (`openspec/specs/ci-cd-pipeline/spec.md:611`) holds. `permissions: contents: read`, `continue-on-error: true` unchanged.
7. **D6 follows the payload into the script.** The contract test's D6 asserts the job runs `node scripts/discord-release-announce.mjs` AND that file contains `allowed_mentions: { parse: [] }`; the unit test asserts it on every payload.
8. **Error text never includes the webhook URL** — only Discord's status + response body.

## Risks / Trade-offs

- Long releases post many messages. Accepted: the channel is announcement-only and the user asked for full notes.
- Mid-sequence failure leaves a prefix posted. Recovery: delete the partial messages, then GitHub "Re-run failed jobs" on `discord-announce` (documented in `docs/release-process.md`).
- `actions/checkout` uses the triggering ref: pushed tag (`publish.yml:22-23`) or the dispatching branch (`publish.yml:25`). Both carry the script once merged.
