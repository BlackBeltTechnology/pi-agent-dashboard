# Test Plan — add-browser-challenge-pause

Stage: design   Generated: 2026-09-14

Guidance-only change: the shipped artefact is skill text. Automatable observables are file-presence + substring assertions on the packaged skill (L1, `packages/extension/src/__tests__/browser-skill-registered.test.ts` pattern). Agent *behaviour* under the rule is LLM judgment with no harness → `manual-only`, deferred post-merge per `ship-change`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Challenge reference files present | EP (file layout) | L1 | automated | packaged skill dir `packages/extension/.pi/skills/browser/` | existing required-files loop in `browser-skill-registered.test.ts` | `references/challenge.md` exists, size > 0 |
| E2 | Challenge reference files present | EP (substring) | L1 | automated | `SKILL.md` source | existing SKILL.md substring describe block | contains `references/challenge.md`; `metadata.version` line matches `"1.2"` |
| E3 | Challenge reference files present + UPSTREAM not-vendored | EP (substring) | L1 | automated | `UPSTREAM.md` source (first time the test reads it) | new assertion | contains `challenge.md` in the "Not vendored" paragraph AND in the refresh step-4 leave-untouched line (two regexes) |
| E4 | Requirement body — never-list | decision-table (required-token presence) | L1 | automated | `references/challenge.md` source | new assertion | contains each rule token: `close --all`, `--headed`, `--restore`, `AutomationControlled`, `Never`; does NOT contain any solver-vendor host from a short fixed deny-list (`2captcha`, `anti-captcha`, `capsolver`, `capmonster`) |
| E5 | Requirement body — precedence over recipe troubleshooting | EP (substring) | L1 | automated | `references/own-browser.md` line with `fresh `--session`` | new assertion | that table row also contains `challenge.md` |
| E6 | Requirement body — SKILL.md hook location | EP (substring) | L1 | automated | `SKILL.md` source | new assertion | the `references/challenge.md` mention sits inside the `## Step 1` section (regex between `## Step 1` and `## Notes`), and Notes lists it as authored |
| E7 | Composite skill ships via files[] (no package.json change) | BVA (packlist boundary) | L1 | automated | `packages/extension/package.json` `files[]` | `npm pack --dry-run --json` in the extension package (see `scripts/__tests__/kb-packaging.test.mjs` for the pack-and-list pattern) | tarball lists `.pi/skills/browser/references/challenge.md` and does NOT list `challenge.md.AGENTS.md` |

### Performance

_None — no runtime code path._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Challenge detected mid-task | state-transition | — | manual-only | pi session with `/browser`, bundled headless `--session chk`, `open https://nowsecure.nl` | Turnstile interstitial appears | [judgment: agent halts, reports URL + kind + session name `chk`, issues no `close --all` / new session / new profile] |
| F2 | Signature text on an ordinary page | EP (negative) | — | manual-only | `open https://developers.cloudflare.com/turnstile/` (docs page mentioning "Verify you are human") | agent reads page | [judgment: agent continues the task; no halt] |
| F3 | Challenge in a headless bundled-browser session | state-transition (legal edge) | — | manual-only | F1 state, user at the machine | user answers "yes, I'm here" | [judgment: agent runs `agent-browser --session chk close` then `agent-browser --session chk --headed open https://nowsecure.nl`; after user completes + confirms, agent re-snapshots session `chk` and continues; never closes it again] |
| F4 | User completes where they can see the browser | state-transition (legal edge) | — | manual-only | task on own-browser / relay route, challenge appears | user completes in visible Chrome, confirms | [judgment: agent re-snapshots same page, continues, no relaunch issued] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Headless session on a host without a display | fault-injection (capability absent) | — | manual-only | task run inside docker harness session (no display) | challenge appears, user answers "not at that machine" | [judgment: agent stops, reports human-needed-on-visible-host, offers relay/own-browser or desktop host; issues no `--headed`, no Xvfb, no bypass] |
| X2 | Daemon exited during the pause | fault-injection (delay) | — | manual-only | F1 state; kill the `chk` daemon (`agent-browser --session chk close`) while "user is away" | user confirms completion → agent resumes | [judgment: agent tolerates failed `close`, relaunches `chk` headed with original flags, does not switch names] |
| X3 | Challenge reappears after resume | state-transition (illegal edge: retry loop) | — | manual-only | F3 state; site re-challenges immediately (`nowsecure.nl` reload) | agent re-snapshots post-resume | [judgment: agent stops and reports "site not accepting session"; no second relaunch, no identity switch, no `--user-agent`/`--args`] |

---

## Coverage summary

- Requirements covered: 1/1 (all 9 scenarios of the ADDED requirement touched; body clauses E4–E6)
- Scenarios by class: edge 7 · perf 0 · frontend 4 · error 3
- Scenarios by level: L1 7 · L2 0 · L3 0
- Scenarios by disposition: automated 7 · manual-only 7

## New infra needed

- none — E1–E6 extend `browser-skill-registered.test.ts`; E7 reuses the `npm pack --dry-run` pattern from `scripts/__tests__/kb-packaging.test.mjs` (may live as a new `describe` in the same extension test or as a sibling `.test.ts`; check-first).
