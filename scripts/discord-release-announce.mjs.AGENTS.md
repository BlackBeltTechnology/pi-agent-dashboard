# discord-release-announce.mjs — index

Posts full GitHub release body to Discord webhook. No truncation. Called by `.github/workflows/publish.yml` `discord-announce` job.

CLI: `DISCORD_WEBHOOK_URL=… node scripts/discord-release-announce.mjs <release.json> [tag]`. `release.json` = `gh release view <tag> --json name,url,body`. Unset `DISCORD_WEBHOOK_URL` → log skip, exit 0.

Exports:
- `splitBody(body, limit=4000)` — chunks ≤ limit, break after newline when line fits, hard-split longer line. Invariant (non-empty): `splitBody(b).join("") === b` (CRLF + trailing newline kept). `splitBody("")` → `[]`.
- `buildPayloads(release, tag)` — 1 embed/message: `title`, `url`, `color`, `description`. Titles `Released <name>`, continuations `Released <name> (i/N)`. Name = release name or tag, shortened with `…` → title ≤ 256. Empty body → one `_No release notes._` payload. `allowed_mentions: { parse: [] }` on every payload.
- `postPayloads(payloads, url, { fetch, sleep })` — sequential `?wait=true`. 429 → wait `retry_after`, max 5 retries/payload; `retry_after` > 60 s aborts. Other non-2xx → throws `Discord webhook failed: <status> <body>`. Error text never includes webhook URL.

Tests: `scripts/__tests__/discord-release-announce.test.mjs`. Contract: `packages/shared/src/__tests__/publish-workflow-contract.test.ts` D6 (script invocation + `allowed_mentions` literal), D7 (no cache/setup-node).

See change: discord-release-full-changelog.
