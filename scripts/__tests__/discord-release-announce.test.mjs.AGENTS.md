# __tests__/discord-release-announce.test.mjs — index

Vitest for `scripts/discord-release-announce.mjs` (test-plan #E1-#E9, #X1-#X5). Direct import of `splitBody`, `buildPayloads`, `postPayloads`; CLI via `spawnSync`.

- `splitBody`: 4000/4001 BVA, 9000-char line → `[4000,4000,1000]`, CRLF + overlong line + trailing newline byte-exact `join("")`, `""` → `[]`.
- `buildPayloads`: short body 1 payload, long body numbered `(i/N)` + url on every embed, empty → `_No release notes._`, tag fallback, 300-char name → titles ≤ 256 with `…`, `allowed_mentions` `{parse: []}` every payload.
- `postPayloads` (injected `fetch`/`sleep`): 500 stops after payload 2, error excludes webhook id/token; 429 retried in order; 6 calls then reject; `retry_after` 120 aborts without sleep.
- CLI: unset `DISCORD_WEBHOOK_URL` → exit 0, stdout `skipping`.

See change: discord-release-full-changelog.
