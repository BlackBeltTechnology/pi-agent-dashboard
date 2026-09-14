## ADDED Requirements

### Requirement: Interactive challenge pauses the task and preserves the session

The skill SHALL ship `references/challenge.md`, an authored (not vendored) reference that instructs the agent what to do when a page presents an interactive anti-bot challenge (Cloudflare Turnstile, hCaptcha, reCAPTCHA, browser-check interstitials, or equivalent) that withholds the requested content. `SKILL.md` SHALL reference it from the execute step, and `UPSTREAM.md` SHALL list it among the files an upstream refresh must not overwrite.

On a challenge, the agent SHALL stop driving the page, SHALL surface the URL and the blocking condition to the user, SHALL hand completion to the user on the browser the task is already using, and SHALL resume that same browser session (same `--session` name, same `--profile`, or same connected CDP target) after the user reports completion. The agent SHALL NOT switch to a different session name, profile, or browser provider mid-task, SHALL NOT run `close --all` or close sessions other than the task's own, and SHALL NOT re-navigate to the challenged URL hoping it passes. A session-scoped `close` and a re-`open` of the challenged URL are permitted only as the headed relaunch described below. On a challenge, `references/challenge.md` takes precedence over any recipe's troubleshooting advice (e.g. own-browser's "re-run under a fresh `--session`", which addresses provider resolution, not challenges).

The reference SHALL NOT describe or link to CAPTCHA-solving services, challenge-token or clearance-cookie injection, copying cookies between browser identities, proxy rotation, user-agent / header / device-emulation changes made in response to a challenge, launch flags whose purpose is to hide automation (e.g. `--disable-blink-features=AutomationControlled`), or JavaScript whose purpose is to falsify automation signals.

#### Scenario: Challenge detected mid-task

- **WHEN** the page withholds the requested content and `read`, a snapshot, `get url`, `get title`, or a Bash `agent-browser eval` of iframe `src` attributes matches a challenge signature listed in `references/challenge.md` (the list is marked non-exhaustive; e.g. an iframe from `challenges.cloudflare.com`, `hcaptcha.com`, or `google.com/recaptcha`, or text such as "Verify you are human" / "Checking your browser")
- **THEN** the agent SHALL halt interaction with that page, report the URL, challenge kind, and — for bundled-browser tasks — the session name it has been driving (the `--session` value or `AGENT_BROWSER_SESSION` it used; `default` if neither) to the user, and SHALL NOT issue `close --all`, a different `--session`, a different `--profile`, or a different provider for that task

#### Scenario: Signature text on an ordinary page

- **WHEN** challenge-signature text appears on a page that is still serving the requested content (documentation, forum post, search result)
- **THEN** the agent SHALL NOT treat it as a challenge and SHALL continue the task

#### Scenario: User completes the challenge where they can see the browser

- **WHEN** the task runs through the dashboard relay, the own-browser recipe, or an Electron/CDP-connected window (the user already sees the browser window)
- **THEN** the agent SHALL ask the user to complete the challenge in that window and, on confirmation, re-snapshot the same page and continue the task in the same session

#### Scenario: Challenge in a headless bundled-browser session

- **WHEN** the task runs in the bundled headless browser and the user confirms they are at the machine running the browser (the agent SHALL ask rather than infer from `$DISPLAY`, which is empty on macOS)
- **THEN** the agent SHALL itself, from Bash (the MCP `browser` tool shares the same daemon and session), run a session-scoped `close` with the same session/namespace flags it launched with (a failed `close` because the daemon already exited is tolerated), then re-run its original launch flags verbatim plus `--headed` with `open <challenged URL as reported at pause time>`; SHALL ask the user to complete the challenge in the visible window and confirm; and SHALL then continue driving that same session — now headed — for the remainder of the task, SHALL NOT close it again, and SHALL NOT start a different session name. The reference SHALL state that a session launched without `--restore`/`--profile`/`--state` starts the headed relaunch with empty cookies

#### Scenario: Headless session on a host without a display

- **WHEN** the task runs in the bundled headless browser and the user says they are not at that machine (Docker harness, SSH, service context)
- **THEN** the agent SHALL stop, report that the site requires a human on a host with a visible browser, and offer the relay / own-browser route or running the task from a desktop host; it SHALL NOT attempt `--headed`, a virtual display, or any bypass

#### Scenario: Daemon exited during the pause

- **WHEN** the user's completion takes longer than the daemon idle timeout and the session is gone on resume
- **THEN** the agent SHALL relaunch the same session headed as above (original flags + `--headed`) and SHALL NOT switch names or providers

#### Scenario: Challenge reappears after resume

- **WHEN** the same challenge is presented again immediately after resuming
- **THEN** the agent SHALL stop and report to the user that the site is not accepting the session, and SHALL NOT loop on retries or switch identity

#### Scenario: Challenge reference files present

- **WHEN** the bridge extension package is installed
- **THEN** `references/challenge.md` SHALL exist and be non-empty under the skill directory, `SKILL.md` SHALL contain the string `references/challenge.md`, and `UPSTREAM.md` SHALL name `challenge.md` as not vendored
