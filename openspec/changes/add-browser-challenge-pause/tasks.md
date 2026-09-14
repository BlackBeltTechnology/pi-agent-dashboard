## 1. Tests first (red) — automated rows from test-plan.md

Exemplar for 1.1–1.6: `packages/extension/src/__tests__/browser-skill-registered.test.ts` (required-files loop + SKILL.md substring block). Exemplar for 1.7: `scripts/__tests__/kb-packaging.test.mjs` (`npm pack --dry-run --json` pattern). Run `npx vitest run packages/extension/src/__tests__/browser-skill-registered.test.ts` after each and verify the new case fails before section 2.

- [ ] 1.1 Add `references/challenge.md` to the required-files loop in `browser-skill-registered.test.ts` — input: packaged skill dir · trigger: existing loop · observable: file exists, size > 0 (test-plan #E1)
- [ ] 1.2 In the SKILL.md frontmatter describe block assert the source contains `references/challenge.md` and `metadata.version` matches `"1.2"` — input: `SKILL.md` · trigger: substring assert · observable: both regexes match (test-plan #E2)
- [ ] 1.3 New describe reading `UPSTREAM.md`: assert `challenge.md` appears in the "Not vendored" paragraph and in the refresh step-4 leave-untouched line — input: `UPSTREAM.md` · trigger: two regexes · observable: both match (test-plan #E3)
- [ ] 1.4 New describe reading `references/challenge.md`: assert presence of `close --all`, `--headed`, `--restore`, `AutomationControlled`, `Never`; assert absence of `2captcha`, `anti-captcha`, `capsolver`, `capmonster` — input: reference source · trigger: token assertions · observable: all present / all absent (test-plan #E4)
- [ ] 1.5 Assert the `own-browser.md` table row containing `fresh \`--session\`` also contains `challenge.md` — input: `references/own-browser.md` · trigger: line-scoped regex · observable: match (test-plan #E5)
- [ ] 1.6 Assert the `references/challenge.md` mention in `SKILL.md` lies between `## Step 1` and `## Notes`, and that Notes lists `challenge.md` as authored — input: `SKILL.md` · trigger: section-sliced regex · observable: both match (test-plan #E6)
- [ ] 1.7 Packlist test (new describe in the same file or sibling `browser-skill-packlist.test.ts`; see `scripts/__tests__/kb-packaging.test.mjs`): run `npm pack --dry-run --json` in `packages/extension` — input: `files[]` · trigger: pack · observable: tarball lists `.pi/skills/browser/references/challenge.md` and not `challenge.md.AGENTS.md` (test-plan #E7)

## 2. Authored reference

- [ ] 2.1 Write `packages/extension/.pi/skills/browser/references/challenge.md` with sections: what counts as a challenge (generic definition — content withheld until a human acts — plus short non-exhaustive signature list: `challenges.cloudflare.com`, `hcaptcha.com`, `google.com/recaptcha`, "Verify you are human", "Checking your browser"; check via `read`, snapshot text, `get url`, `get title`, Bash `agent-browser eval` on `iframe[src]`; signature text on a page still serving content is NOT a challenge); pause (stop driving; do NOT `close --all`, switch `--session`/`--profile`/provider, or re-navigate hoping it passes; report URL + kind + the session name the agent has been passing — NOT a bare `agent-browser session`, which prints the env/default name); this file takes precedence over recipe troubleshooting; complete — branch on current route: relay/own-browser/Electron-CDP → user completes in visible window; decide the display branch by asking the user "are you at the machine running the browser?" (never `$DISPLAY`); bundled headless + display → agent runs, from Bash, session-scoped `close` (same `--session`/`--namespace` flags, never `--all`; tolerate failure if daemon already exited) then relaunches with all original flags + `--headed` + `open <challenged URL captured via get url at pause>` (no persistence flag ⇒ empty cookies — say so; closing `default` also drops the MCP `browser` tool page of this task); bundled headless + no display (Docker/SSH) → stop, report, offer relay/own-browser or desktop host, no virtual display; resume (same session, now headed, re-snapshot, continue, never close it again; daemon idle-timed out → relaunch same way); reappears-after-resume (stop, report, no loop); never-list (solvers, token/cookie injection, cookie copy between identities, proxy rotation, UA/header/`set device` changes, automation-hiding `--args`, stealth JS). Verify 1.4 passes and read it against every scenario in `specs/default-browser-skill/spec.md`.
- [ ] 2.2 Add `references/challenge.md.AGENTS.md` sidecar (caveman index row: AUTHORED, purpose, See change: add-browser-challenge-pause); verify `kb_search --doc-type agents challenge` returns it after reindex.

## 3. Wire into SKILL.md, UPSTREAM.md, own-browser.md

- [ ] 3.1 `SKILL.md` Step 1: fix the stale "Both references are self-contained" → "All references" in the sentence the new paragraph joins; add a short paragraph — if at any point the page is an interactive anti-bot challenge, stop and follow `references/challenge.md`; do not retry or switch session/profile. Notes: extend the vendoring bullet so `challenge.md` is listed as authored alongside `own-browser.md`. Bump `metadata.version` to `1.2`. Verify 1.2 and 1.6 pass.
- [ ] 3.2 `UPSTREAM.md`: reword the "Not vendored — do not overwrite on refresh" paragraph to list `references/challenge.md` without the Panerelay parenthetical applying to it, and add it to step 4 of the refresh procedure ("Leave own-browser.md, challenge.md and check-panerelay.sh untouched"). Verify 1.3 passes.
- [ ] 3.3 Update `SKILL.md.AGENTS.md` row (mention Step 1 challenge hook, `See change: add-browser-challenge-pause`); verify row present by grep.
- [ ] 3.4 `references/own-browser.md` troubleshooting row "Re-run under a fresh `--session` name": append "(provider-resolution failures only — on a challenge follow `challenge.md`)". Verify 1.5 passes.

## 4. Verify

- [ ] 4.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` — all green, including 1.1–1.7.
- [ ] 4.2 `npm run reload`, then in a pi session invoke `/browser` and confirm the loaded SKILL.md shows the challenge paragraph (observable: skill text references `references/challenge.md`).
- [ ] 4.3 Run `review-code` on the diff (check `challenge.md` against `web.md` `close --all`/`--session` text and the `own-browser.md` row); then `node scripts/check-conventions.mjs` on this change's `proposal.md`.

## 5. Manual verification (test-plan: manual-only) — deferred post-merge per ship-change

- [ ] 5.1 Halt on Turnstile: `/browser`, `agent-browser --session chk open https://nowsecure.nl` — agent halts, reports URL + kind + session `chk`, no `close --all` / new session / new profile (test-plan #F1, test-plan: manual-only)
- [ ] 5.2 No false halt on docs page: `open https://developers.cloudflare.com/turnstile/` — agent continues (test-plan #F2, test-plan: manual-only)
- [ ] 5.3 Headed relaunch + resume: from 5.1, answer "I'm here" — agent runs `--session chk close` then `--session chk --headed open …`; after completion + confirm, agent re-snapshots `chk` and continues, never closes again (test-plan #F3, test-plan: manual-only)
- [ ] 5.4 Visible-browser completion: own-browser/relay route, challenge appears — user completes, agent re-snapshots same page, no relaunch (test-plan #F4, test-plan: manual-only)
- [ ] 5.5 No display: docker harness session, answer "not at that machine" — agent stops, reports, offers relay/desktop host, no `--headed`/Xvfb (test-plan #X1, test-plan: manual-only)
- [ ] 5.6 Daemon gone during pause: kill `chk` daemon while away, then confirm — agent tolerates failed `close`, relaunches `chk` headed with original flags (test-plan #X2, test-plan: manual-only)
- [ ] 5.7 Reappearing challenge: from 5.3, reload re-challenges — agent stops and reports, no second relaunch, no UA/`--args` change (test-plan #X3, test-plan: manual-only)
