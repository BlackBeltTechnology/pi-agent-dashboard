## 1. Server: cwd-keyed active-run registry

- [ ] 1.1 Add a `Map<cwd, RunState>` (phase, startedAt, lastLine, logTail, code?, expiresAt?) alongside the existing requestId registry in `packages/server/src/worktree-init.ts` / `worktree-init-registry.ts`
- [ ] 1.2 On `POST /init`, register/replace the cwd entry as `{ phase: "running", startedAt }`
- [ ] 1.3 On each progress line, update `lastLine` + bounded `logTail` (≤4KB tail, reuse existing capture) and fan out to cwd subscribers (keep requestId fan-out for back-compat)
- [ ] 1.4 On exit, set terminal phase + `code?` + `expiresAt = now + TTL` (~60s); evict expired entries lazily on read or via a sweep
- [ ] 1.5 Tests: register on start; running visible; done/failed sets code + TTL; expired entry evicted

## 2. Server: active-inits endpoint + cwd-addressable progress

- [ ] 2.1 Add `GET /api/git/worktree/active-inits` in `routes/git-routes.ts` returning running + non-expired terminal entries
- [ ] 2.2 Support `worktree_init_subscribe`/`unsubscribe` by `cwd` (in addition to requestId); progress/done/failed messages carry `cwd`
- [ ] 2.3 Add the `active-inits` response type + `cwd` field to worktree-init messages in `packages/shared/src/browser-protocol.ts`
- [ ] 2.4 Tests: endpoint reflects running + terminal-within-TTL; cwd subscriber receives fan-out; unknown cwd → empty

## 3. Client: friendly status chip (manual button)

- [ ] 3.1 Replace the raw running `<pre>` tail + failure `<pre>` in `WorktreeInitButton.tsx` with: status chip (`Initializing… · {elapsed}`) + slim bar + ghost `lastLine` + collapsed `<details>` log
- [ ] 3.2 Failure chip: `✕ Init failed · exit{code} · {short cmd}` + `↻ Retry` + opt-in log (sticky; never auto-dismiss)
- [ ] 3.3 Success: flash `✓ Initialized` (~2s) then collapse; button disappears on gate flip
- [ ] 3.4 Subscribe by `cwd` instead of the client-minted requestId
- [ ] 3.5 Tests: running renders chip not `<pre>`; log hidden until toggled; failure sticky + Retry; success flash then collapse

## 4. Client: spawn / auto-init feedback (D1)

- [ ] 4.1 Render the init sub-state on the spawn placeholder / session card for the new cwd (running / done-flash / failed-sticky)
- [ ] 4.2 Drop the discarded-requestId pattern in `lib/auto-init-worktree.ts` — the run is picked up via cwd registry; keep the TOFU trusted-only gate unchanged
- [ ] 4.3 Tests: auto-init on spawn shows the sub-state; failed auto-init is visible + retryable (the currently-silent case); untrusted hook still does not auto-run

## 5. Client: boot rehydration + concurrent stack

- [ ] 5.1 On boot (`App.tsx`), fetch `active-inits` and render the correct chip/card state per cwd; re-subscribe running cwds
- [ ] 5.2 Terminal-within-TTL rehydrates as done-flash / failed-sticky
- [ ] 5.3 Concurrent surface: collapse N running cwds into one summary stack (header + ≤4 rows + `+N more`); fade when all settle; failed row holds it open
- [ ] 5.4 Tests: refresh mid-run rehydrates running + streams; refresh just-after-fail shows failed-sticky; two runs stack; cross-tab shows same state

## 6. Security + observability review

- [ ] 6.1 `security-hardening`: confirm the opt-in log reuses the bounded stderr tail (no new capture); no secret-bearing env echoed; TOFU gate intact on the auto path
- [ ] 6.2 `observability-instrumentation`: verify `active-inits` + progress report accurate state across ws reconnect (running → reconnect → still running)
- [ ] 6.3 `doubt-driven-review`: walk the registry lifecycle (start/progress/exit/TTL/drop-on-close/concurrent) before commit

## 7. Docs + end-to-end

- [ ] 7.1 Update the per-file rows for touched files in the directory `AGENTS.md` tree (server worktree-init, client WorktreeInitButton, auto-init, bus) per Documentation Update Protocol
- [ ] 7.2 FAQ entry: "What feedback do I get while a worktree initializes?" (delegate `docs/` writes to a subagent, caveman style)
- [ ] 7.3 Run full suite (`npm test 2>&1 | tee /tmp/pi-test.log`), fix failures
- [ ] 7.4 Manual: enable auto-init, spawn a trusted worktree → card sub-state shows running→done; force a hook failure → failed-sticky + Retry; refresh mid-init → rehydrates (requires live browser verification)
