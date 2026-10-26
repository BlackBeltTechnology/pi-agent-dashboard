## Why

The `discord-announce` job in `.github/workflows/publish.yml` truncates the GitHub Release body at 3800 characters, so the community Discord `#releases` channel never receives a full changelog. Real releases blow past that cap: v0.10.0's body is 37 114 characters, so ~90 % of its notes would be dropped. The `DISCORD_RELEASE_WEBHOOK` secret was also never set, so the job has silently skipped every release so far. The community Discord is now set up with a dedicated `#releases` announcement channel and the secret is configured, so the announcement must carry the full notes.

## What Changes

- New `scripts/discord-release-announce.mjs`: reads `gh release view --json name,url,body` output and posts the **full** body to the Discord webhook, split on line boundaries into ≤ 4000-char embeds, one embed per message, continuation titles numbered `(i/N)`. `allowed_mentions: { parse: [] }` on every message. Unset webhook → skip, exit 0 (unchanged). Exports pure `splitBody` + `buildPayloads` for unit tests.
- `.github/workflows/publish.yml` `discord-announce` job: replace the inline `jq` truncating payload + `curl` with a sparse checkout of the script + `node scripts/discord-release-announce.mjs release.json "$TAG"`. Trigger, gating (`github-release` success, non-prerelease), `continue-on-error: true`, `permissions: contents: read`, no cache: all unchanged.
- `packages/shared/src/__tests__/publish-workflow-contract.test.ts`: discord-announce D6 asserts the script invocation (mention suppression moves to the script's unit test); add a no-cache/no-setup-node assertion.
- `docs/release-process.md`: document full-body posting (drop the "truncated at 3800 chars" statement) and partial-failure recovery.
- `scripts/AGENTS.md`, `.github/workflows/publish.yml.AGENTS.md`: rows for the new script/test; discord-announce description updated.

- Ship-gate repair: drop two unused `export`s added by `663d538a3` (`EVENT_STREAM_HEARTBEAT_MS`, `AgentEventListener`) that pushed the nightly-only knip ratchet over baseline on develop.

Non-goals: role pings on release, auto-crossposting the announcement channel, a manual re-post `workflow_dispatch`, any Discord server administration (done out-of-band).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `release-notes`: adds a requirement that the community Discord announcement carries the complete GitHub Release body, split across messages, never truncated, with mentions suppressed.

## Impact

- Code: `scripts/discord-release-announce.mjs` (new), `scripts/__tests__/discord-release-announce.test.mjs` (new), `.github/workflows/publish.yml` (`discord-announce` job steps only), `packages/shared/src/__tests__/publish-workflow-contract.test.ts` (D6).
- Docs: `docs/release-process.md`, `scripts/AGENTS.md`, `.github/workflows/publish.yml.AGENTS.md`.
- CI: `discord-announce` stays best-effort (`continue-on-error: true`) and release-privileged-without-cache (ci-cd-pipeline "Release-privileged jobs do not restore a dependency cache" still holds: `actions/checkout` is not a cache).
- Runtime: a long release posts N messages (v0.10.0 → ~10). Discord webhook rate limits (HTTP 429) are honoured via `retry_after`.
- Secrets: `DISCORD_RELEASE_WEBHOOK` read via env only; never echoed.

## Discipline Skills

- `security-hardening`: the job reads a webhook secret and posts untrusted release text; mention suppression and no secret echo are asserted.
- `review-code`: inline review before commit.
- No `performance-optimization` / `observability-instrumentation` trigger (no latency budget, no new endpoint).
