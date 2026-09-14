## Why

The `browser` skill has no guidance for interactive anti-bot challenges (Cloudflare Turnstile, hCaptcha, reCAPTCHA, "Checking your browser…"). An agent that hits one today improvises — retries, opens a fresh `--session`, closes the browser, or spins up a new `--profile` — which throws away the exact session state a site is about to trust and makes the block worse. GitHub issue #643 (item 6) asks for a pause/resume discipline; the rest of that issue targets `agent-browser` upstream and is out of scope here.

## What Changes

- New authored reference `packages/extension/.pi/skills/browser/references/challenge.md`: how to recognise a challenge page (generic definition — content withheld until a human acts — plus a short, non-exhaustive signature list checked via snapshot text, `get url`/`get title`, and `eval` on iframe `src`), what to do (stop driving, surface URL + challenge kind + session name to the user), how the user completes it on the browser the task is *already* on (relay / own-browser: complete in the visible Chrome; bundled headless with a display: the agent runs a session-scoped `close` then re-runs its original `open` with all original flags plus `--headed`; bundled headless with no display: stop and report), and how to resume (same session — now headed — re-snapshot, continue; if the daemon idle-timed out, relaunch the same way). Explicit never-list: solver services, token/cookie injection, copying cookies between identities, proxy rotation, UA/header/device-emulation changes, automation-hiding launch flags, stealth JS.
- `SKILL.md`: Step 1 gains a one-paragraph "challenge encountered" rule pointing at `references/challenge.md` (the adjoining stale "Both references are self-contained" becomes "All references"); Notes marks the file as authored; `metadata.version` → `1.2`.
- `UPSTREAM.md`: "Not vendored" paragraph reworded so `challenge.md` is listed without inheriting the Panerelay parenthetical; `challenge.md` added to refresh-procedure step 4's leave-untouched list.
- `references/own-browser.md` troubleshooting row "Re-run under a fresh `--session` name" gains a parenthetical "(provider-resolution failures only — on a challenge follow `challenge.md`)".
- `browser-skill-registered.test.ts`: `references/challenge.md` added to the required-files list; assert `SKILL.md` contains `references/challenge.md`; assert `UPSTREAM.md` contains `challenge.md` (first assertion that file reads `UPSTREAM.md`).
- `references/challenge.md.AGENTS.md` sidecar (new); `SKILL.md.AGENTS.md` row updated (exists already).

Not in scope (redirected upstream in the #643 reply): browser fingerprint coherence, identity diagnostics, canonical `BrowserIdentityProfile`, launch-override inventory — the dashboard has no launch layer; `agent-browser` owns those.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `default-browser-skill`: ADDED requirement — the skill SHALL instruct the agent to pause on an interactive challenge, keep the same session identity (name / profile / CDP target — never switch), hand completion to the user, and resume that session; SHALL NOT introduce solving/bypass. `Composite skill structure` is deliberately left untouched — `add-browser-relay` already carries a MODIFIED delta on it; this change adds a file the way `own-browser.md` was added (ADDED requirement, no layout edit).

## Impact

- `packages/extension/.pi/skills/browser/` — `SKILL.md`, `UPSTREAM.md`, new `references/challenge.md`, new `references/challenge.md.AGENTS.md`, `SKILL.md.AGENTS.md`.
- `packages/extension/src/__tests__/browser-skill-registered.test.ts`.
- No server, client, shared, or runtime code. No new dependency. Ships via the existing `pi.skills[]` / `files[]` registration — no package.json change.
- Relationship to `add-browser-relay`: no ordering dependency at the spec level (ADDED vs MODIFIED on different requirements). Both changes touch `SKILL.md` and `browser-skill-registered.test.ts` textually — whichever lands second rebases a few lines. (Relay does not touch `UPSTREAM.md`; its `dashboard-relay.md` has no not-vendored entry — relay's gap, flagged there separately.) `challenge.md` names `references/dashboard-relay.md` as one of the "user can see the browser" paths *when present*; the text is correct before and after relay lands.
- Known trade-off: the `Composite skill structure` layout list will not mention `challenge.md` after archive (relay's MODIFIED delta owns that list). Follow-up: add the row once relay archives.

## Discipline Skills

- `review-code` — non-trivial guidance change; review the reference text for contradictions with `web.md` (`close --all` cleanup advice, `--session` semantics) and `own-browser.md` ("fresh `--session`" troubleshooting row) before commit.
- No `security-hardening` trigger: no untrusted input, secrets, or new surface. The never-list is a guidance boundary, not code.
