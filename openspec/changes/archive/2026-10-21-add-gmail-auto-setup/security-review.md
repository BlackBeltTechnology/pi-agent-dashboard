# Security review — add-gmail-auto-setup (task 7.1, test-plan #M2)

Scope: secret paths, private + ephemeral instance, downloads cleanup, loopback-only start, input validation, CDP client, redirect guard. Reviewer: `Audit` subagent (`@review`), read-only; fixes by the implementer.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | blocking | Only `POST setup/run` checked "genuinely local"; `GET/continue/takeover/DELETE` passed the network guard for authenticated or trusted-network remotes (a remote could answer the links decision with its own links, take over the profile or cancel the run). | All five setup routes now require a genuinely local caller (403 `remote_dashboard`). Tests: `setup-routes.test.ts` "setup run routes are genuinely-local only". |
| 2 | non-blocking | `cdpUrl` from the service dialled without validation. | `isLoopbackCdpUrl` (`ws:` + loopback host) gate in `run.ts`; else handoff `launch-failed` @ project and the instance is disconnected. Test in `setup-run.test.ts`. |
| 3 | non-blocking | CDP connect/open had no timeout: a Chrome that never answers wedged the single run slot. | `withTimeout(stepLimitMs)` around connect + page open → handoff `browser_closed`. Test in `setup-run.test.ts`. |
| 4 | non-blocking | Sign-in `login_hint` email in the browser audit ring. | False positive: `AuditRing` strips query + fragment of every URL detail (`audit.ts` `stripUrlQueryAndFragment`). |
| 5 | non-blocking | `DOWNLOAD_RE` unanchored (`client_secret_x.json.bak` matched). | Anchored `^client_secret_[^/\\]*\.json$`. |
| 6 | non-blocking | Masking covers only `GOCSPX-`. | Accepted: only Desktop `installed` clients are stored and Google issues `GOCSPX-` secrets for them; revisit if the format changes. |
| 7 | non-blocking | `ws` client: default `maxPayload`, no per-call timeout. | Accepted for a single local run; connect is bounded by #3, each step by the 60 s step limit. |

Verified safe without findings: run view carries no secret and no instance id; handoff reasons are fixed codes; step logs are masked; private instance tabs never reach `browser_relay_status` or viewers; client `Target.createBrowserContext/disposeBrowserContext` denied; takeover is atomic; the downloaded JSON is deleted on every path; `projectId`/`ownerEmail`/links validated (suffix, userinfo, port and case bypasses rejected).

Open high findings: none.
