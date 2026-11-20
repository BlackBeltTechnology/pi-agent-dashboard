## 1. #1104 — automation `plugin_action` admits `payload.cwd` (server)

- [ ] 1.1 Write failing tests in `packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts` (inject `knownCwds`/admit seam as `routes-cwd-admission.test.ts` does): `create` with unadmitted cwd → warn, no `<cwd>/.pi/automation` created; `create` folder-scope without/empty/non-string cwd → refused, nothing written under `process.cwd()`; `create` admitted cwd → written; `create` `scope:"global"` no cwd → written under home; `run` unadmitted cwd → no scan/no run; indeterminate admission → refused + token released.
- [ ] 1.2 Update the existing test "run reaches the engine core" (cwd `/w/repo`, unadmitted today) to use an admitted cwd.
- [ ] 1.3 `packages/automation-plugin/src/server/index.ts` (`case "create"` ~:216, `case "run"` ~:187): call `admitRouteCwdParam` with the same `knownCwds` / `admitOptions` as the `stop` branch (~:194-208); `required: scope !== "global"` for create, `false` for run; use `adm.cwd` for the base (drop the `process.cwd()` fallback in create); `adm.release()` in `finally`; log `automation <action>: cwd not admitted` on refusal.
- [ ] 1.4 Run the new tests green; confirm REST suite `routes-cwd-admission.test.ts` unchanged.

## 2. #1104 — CodeQL baseline

- [ ] 2.1 Update `packages/shared/src/__tests__/codeql-baseline-gates.test.ts` (`#E32`, `validateF1Reason`, `F1_FILE`) first (red): entries for `automation-writer.ts` must not be `accepted-risk:` nor cite `#1104`; allow only `false-positive:` naming the admission gate.
- [ ] 2.2 Run the local CodeQL ratchet (`node scripts/codeql-local.mjs`, see `docs/code-quality.md`): remove the five `automation-writer.ts` entries in `codeql-baseline.json` (~:164-198) if the alerts no longer reproduce; otherwise re-triage each via the script as `false-positive:` with `gate: admitRouteCwdParam packages/automation-plugin/src/server/index.ts:<line>` (and `routes.ts`). Never hand-edit the baseline outside the script.
- [ ] 2.3 Delegate to DocScribe (caveman style; main agent does not edit `docs/`): `docs/code-quality.md:610` (drop the F1 accepted-risk line) and any F1 mention in `docs/codeql-baseline.json.AGENTS.md`.
- [ ] 2.4 Leave a note on GitHub #1104 once merged (alerts stay open until the post-merge dismissal tracked on #1059).

## 3. #1115 — YOLO verdict before recent-denial (extension) — D2 confirmed (owner, 2026-11-20)

- [ ] 3.1 Write failing tests in `packages/extension/src/path-gate/__tests__/` (handler tests; fake `now`, stub `yoloDecide`): timeout then YOLO live+auto-allow within 120 s → proceeds with `yolo-allowed`; explicit Deny then `yoloDecide`→`refused` → `yolo-refused`; sensitive target after a denial under live YOLO → `recently-denied` and `yoloDecide` NOT called; ungrantable subject same; `yoloDecide`→`decline` with suppression active → `recently-denied`; no UI → `no-ui`; no YOLO link → unchanged `recently-denied`.
- [ ] 3.2 `packages/extension/src/path-gate/handler.ts` (~:298-329): move the pre-mutex `isSuppressed` check after the YOLO block; only run YOLO when grantable, non-sensitive (existing guard) and keep the check unconditionally when YOLO is skipped or yields `decline`. Leave the in-mutex re-check (`ask()` ~:122) untouched.
- [ ] 3.3 Update the `handler.ts` / `suppression.ts` header comments and the `packages/extension/src/path-gate/AGENTS.md` rows (YOLO branch order).
- [ ] 3.4 Delegate to DocScribe: `docs/security/tool-call-guards.md` (Always allow + YOLO section) — order of suppression vs YOLO.
- [ ] 3.5 Confirm no collision with active `harden-agent-tool-guards` edits of `decide.ts`/`roots.ts` (different files); rebase if it lands first.

## 4. #1103 — `service exec` signal forwarding (server)

- [ ] 4.1 Write failing tests in `packages/server/src/__tests__/cli-service.test.ts` (stub child via `spawnChild`, add `deps.killGraceMs` and a `deps.signalSource` EventEmitter seam, no real process signals): SIGTERM forwarded, lease released after child exit, status = child's; SIGINT and SIGHUP forwarded; child ignoring the signal gets SIGKILL after the grace, then lease release; second signal → immediate SIGKILL; listeners removed after exit (`listenerCount` back to baseline); no signal → behaviour unchanged (E45/X6/X5 still green).
- [ ] 4.2 `packages/server/src/services/cli-service.ts` `execVerb` (~:351-394): register SIGTERM/SIGINT/SIGHUP handlers right after spawn; forward via `child.kill(sig)`; arm a grace timer (default 5000 ms, `deps.killGraceMs`) → `child.kill("SIGKILL")`; second signal → `SIGKILL`; in the exit path `clearTimeout`, remove handlers, then the existing `clearInterval` + lease release (also on the `error` path). Keep `stdio:"inherit"`.
- [ ] 4.3 Update the stale comment in `packages/obs-studio-plugin/src/server/bridge.ts:9-10` ("exec forwards no signals"); add a `BridgeManager` test only if the comment change needs one (no behavioural change there).
- [ ] 4.4 Add one real-process test (spawn `node -e` child ignoring SIGTERM via the actual `execVerb`, guarded like `cli-signal-forwarding.test.ts`) proving no surviving child pid; skip on win32.
- [ ] 4.5 Delegate to DocScribe: `docs/` service-exec/CLI page row for the signal contract (find via `grep -ri 'service exec' docs/`).

## 5. Verify and land

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`
- [ ] 5.2 `npm run quality:changed`; run `review-code` (and `doubt-driven-review` on 3.2 before it stands).
- [ ] 5.3 Rebuild/verify: `npm run reload` (path-gate, extension); `npx tsx .pi/skills/implement/scripts/restart-server.ts` (automation plugin, cli-service); `curl -s http://localhost:8000/api/health | jq .mode`.
- [ ] 5.4 Manual smoke: WS `create` for an unpinned folder is refused (server log) and writes nothing; `pi-dashboard service exec <id> -- node -e "process.on('SIGTERM',()=>{});setInterval(()=>{},1e3)"` then `kill -TERM <exec pid>` → child gone within ~5 s, lease released.
- [ ] 5.5 `npx openspec validate harden-path-and-process-guards --strict` and `node scripts/check-conventions.mjs`.
