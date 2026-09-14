## Context

See proposal.md — Why. The skill is a composite of `SKILL.md` (routing) plus per-recipe references under `references/`. Two of those (`web.md`, `electron.md`) are vendored snapshots of upstream `agent-browser` content and get overwritten on refresh per `UPSTREAM.md`; `own-browser.md` sets the precedent for an authored reference that survives refresh. `add-browser-relay` (in progress) adds `references/dashboard-relay.md` as the preferred logged-in path and already carries a MODIFIED delta on the `Composite skill structure` requirement.

Constraints:
- Guidance only. The dashboard owns no browser launch layer; identity, headless mode, and session persistence are `agent-browser` flags. Per `agent-browser --help` (0.33.2): `--session <name>` is documented only as "isolated session" (or `AGENT_BROWSER_SESSION` env) — help documents **no** persistence for it; persistence is documented only on `--restore [name]` (key defaults to the session name), `--profile <dir>`, and `--state <path>`; `--namespace` isolates daemon sockets and restore dirs; `--headed` shows the window; a session's daemon exits after `--idle-timeout` (default 1h); `close` is session-scoped, `close --all` kills every session. Session identity is per-invocation — a bare `agent-browser session` prints the *env/default* name, not the one a task passed via `--session`.
- Must not conflict with `add-browser-relay` at archive time.
- Must not be overwritten by an upstream skill refresh.

## Goals / Non-Goals

Goals:
- One authoritative place that says "challenge → pause, keep session, hand to user, resume same session".
- Work correctly whether or not `add-browser-relay` has landed.

Non-Goals:
- Detecting challenges programmatically (no script, no server endpoint, no gateway message).
- Any fingerprint, UA, locale, viewport, or profile-identity logic (upstream; see #643 reply).
- Behavioural E2E of the pause (file-presence test only, matching the existing spec pattern).

## Decisions

1. **Separate authored reference (`references/challenge.md`), not inline in `web.md`.**
   `web.md` is vendored; an upstream refresh would silently drop the rule. `own-browser.md` already proves the authored-reference pattern and `UPSTREAM.md` has the "do not overwrite" list to extend. Alternative — a `## Challenges` addendum inside `web.md`'s Pi Dashboard addenda block — rejected: the addenda survive refresh only by manual care in step 4 of the refresh procedure, and the rule applies to *every* recipe (web, electron, own-browser, relay), not just web.

2. **SKILL.md hook lives in Step 1, not Step 0b.**
   Step 0b is pre-launch routing; a challenge appears mid-execution regardless of route. A short paragraph in "Step 1 — Read the matched recipe and execute" ("if at any point the page is an interactive challenge, stop and follow `references/challenge.md`") is route-agnostic. Alternative — a fourth routing row — rejected: it is not a recipe choice.

3. **Completion happens on the browser the task is already on; never switch mid-task.**
   Two branches keyed on the current route, not a preference order:
   - *Relay / own-browser* (user already sees Chrome): ask the user to complete it in that window; re-snapshot; continue. Session untouched.
   - Branch predicate: the agent is already pausing to talk to the user, so it *asks* "are you at the machine running the browser?" instead of inferring from `$DISPLAY` (empty on macOS, set under `ssh -X`). Cheapest correct signal.
   - *Bundled headless, display available*: the user cannot see it, and a running daemon cannot flip headless→headed in place, so the **agent** (it holds `Bash(agent-browser:*)`; the MCP `browser` tool shares the same daemon/session, so Bash is the relaunch surface either way) runs a session-scoped `close` (tolerating failure if the daemon already idled out) with the same `--session`/`--namespace` flags it launched with (never `--all`), then re-runs its original launch flags verbatim plus `--headed`, opening the *challenged* URL captured via `get url` at pause time (not the task's start URL). "Repeat the original flags" is the rule rather than an enumeration (`--restore`, `--profile`, `--state`, `--namespace`, `--cdp`, …) so nothing is dropped. The headed browser under the same name is the working browser for the rest of the task; the agent does not close it again. Cookie continuity across that relaunch exists only when a persistence flag was already in use — acceptable: a task that needed login state should already be on relay/own-browser per Step 0b, and the challenge clearance the user just earned lives in the headed browser the agent keeps driving. The session name is whatever the agent has been passing (`--session` / `AGENT_BROWSER_SESSION`; `default` if neither) — the agent knows its own launch command; it must not query a bare `agent-browser session`, which reports the env/default name.
   - *Bundled headless, no display* (Docker harness, SSH, service host): `--headed` cannot work. Stop, tell the user the site needs a human on a host with a visible browser, offer relay/own-browser or a desktop host. No virtual display, no bypass.
   Alternatives: always relaunch headed — rejected per user decision (2026-09-14), wastes the relay; switch to relay mid-task — rejected, changes identity, which is exactly what the site is testing. The reference names `references/dashboard-relay.md` as one of the visible-browser paths *if that file exists*, so the text is correct before and after `add-browser-relay` lands.

4. **ADDED requirement only; `Composite skill structure` untouched.**
   `add-browser-relay` MODIFIES that requirement (file list + allowed-tools). A second MODIFIED delta on the same requirement would race at archive and one would lose the other's edits. The required-files scenario lives inside the new requirement under a distinct name (`Challenge reference files present`) to avoid a duplicate scenario heading post-archive. Accepted drift: the layout list omits `challenge.md` until a follow-up after relay archives.

5. **Detection = generic definition + short concrete list marked non-exhaustive, gated on content being withheld.**
   The definition ("the page asks a human to prove they are one *before* showing the requested content") is the actual test; the signature list (iframe hosts, interstitial phrases) is how the agent notices. Snapshots inline iframe *content*, not necessarily the host, so the reference tells the agent to check `get url`, `get title`, snapshot text, and `eval` on `iframe[src]` — not snapshot alone. The withheld-content gate prevents false halts on docs/forums that merely mention CAPTCHAs. Alternative — vague only — rejected: agents under-trigger on vague rules.

6. **Never-list stated in the reference, not enforced in code.**
   The spec forbids solvers, injection, cookie copying, proxy rotation, `--user-agent`, automation-hiding launch flags (`--args --disable-blink-features=AutomationControlled` is literally the CLI's help example), and stealth JS. Nothing enforces this mechanically — the skill grants `Bash(agent-browser:*)`. Enforcement is the rule text plus review.

7. **Test extends the existing file-presence test.**
   `browser-skill-registered.test.ts` already iterates a required-files list and asserts SKILL.md substrings. Add `references/challenge.md`, a `SKILL.md` contains `references/challenge.md` assertion, and a `UPSTREAM.md` contains `challenge.md` assertion. No harness fixture (user decision).

## Risks / Trade-offs

- [Agent ignores the rule under pressure and retries anyway] → the rule is placed in the execute step that every route passes through, phrased as a hard stop with an explicit do-not list; `review-code` checks the wording.
- [Headed relaunch of a bare `--session` starts with empty cookies] → by design (see Decision 3); the reference says so plainly and points login-state tasks at relay/own-browser. If the CLI later persists sessions by default, the reference loses one sentence.
- [Daemon idle-timeout (1h) fires while the user is away] → explicit scenario: relaunch the same name headed; never switch names.
- [`--profile <dir>` relaunch fails on the user-data-dir lock] → the close-then-relaunch order releases the lock before the headed launch.
- [Session-scoped `close` on `default` also drops the `browser` MCP tool's page (same daemon)] → accepted; SKILL.md Notes already says one surface per task and `--session` for isolation. The reference repeats that closing `default` affects both surfaces of *this* task only.
- [Test required-files list, spec layout list, and on-disk tree are three sources of truth] → accepted drift, pre-existing (`own-browser.md` absent from the test today); relay task 7.30 reconciles the test; the layout-list follow-up is noted in the proposal.
- [Same challenge re-triggers after resume → agent loops] → explicit "reappears after resume" scenario: stop, report, no retry.
- [`add-browser-relay` renames `dashboard-relay.md`] → reference names it "when present"; a rename is a one-token edit.
- [Both changes edit `SKILL.md`, `browser-skill-registered.test.ts`] → disjoint lines; second-to-land rebases. Documented in proposal Impact.
- [Recipe troubleshooting contradicts the rule (`own-browser.md` "fresh `--session`", `web.md` `close --all`)] → requirement states `challenge.md` takes precedence on a challenge; own-browser row gets a parenthetical (authored file); `web.md` is vendored and left alone.
- [Signature list becomes a de-facto detector that people extend indefinitely] → keep it to ~5 entries with the non-exhaustive marker; growth belongs upstream.

## Migration Plan

Additive. Ships with the next extension publish; `npm run reload` picks it up in live sessions. Rollback = delete `challenge.md`, revert the three one-line edits, drop the test rows.
