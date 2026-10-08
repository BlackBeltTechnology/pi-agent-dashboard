# Test Plan — ask-agent-file-access-in-chat

Stage: design   Generated: 2026-09-29

Hard gate: no unfillable Triple slot. Values used: gate timeout 120 s (one budget
for both prompts), repeat suppression 120 s, settled-confirm redeem window 5 s,
in-root p95 < 1 ms after probe settles, checkout probe bound = the
`file-read-containment` probe timeout.

Requirement refs: `APC-n` = `specs/agent-path-confinement` requirement n
(1 gating, 2 roots, 3 ask-in-session, 4 always-allow, 5 fail-closed,
6 config, 7 latency/observability); `PAG-M` = modified denial-binding
requirement, `PAG-A` = added agent-grant requirement; `SAR-R` = modified rollup
requirement, `SAR-T` = added toast requirement.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | APC-1 | EP | L1 | automated | cwd `/w/repo`, target `src/a.ts` | `decidePathAccess` read | verdict `in-root`, no prompt |
| E2 | APC-1 | EP (traversal) | L1 | automated | cwd `/w/repo`, target `../other/x.txt` | decide read | canonical `/w/other/x.txt`, verdict `ask` |
| E3 | APC-1 | EP (tilde) | L1 | automated | cwd `/w/repo`, target `~/.ssh/id_rsa`, home `/h` | decide read | canonical `/h/.ssh/id_rsa`, verdict `ask`, `sensitive=true` |
| E4 | APC-1 | EP (`@` marker) | L1 | automated | target `@/etc/hosts` | decide write | canonical `/etc/hosts`, verdict `ask` |
| E5 | APC-1 | BVA (string prefix) | L1 | automated | cwd `/w/repo`, target `/w/repo-old/a.txt` | decide read | verdict `ask` (not in-root) |
| E6 | APC-1 | EP (symlink escape) | L1 | automated | `/w/repo/link` → `/w/other` (tmp fixture) | decide write `/w/repo/link/f.txt` | canonical `/w/other/f.txt`, verdict `ask` |
| E7 | APC-1 | EP (non-existent) | L1 | automated | target `/w/repo/new/dir/f.txt` (dirs absent) | decide write | canonical = realpath(`/w/repo`) + `new/dir/f.txt`, verdict `in-root` |
| E8 | APC-1 | parity table | L1 | automated | fixtures `~/x`, `@/etc/x`, `@~/x`, NBSP name, `../`, absolute | gate resolver vs pi `dist/core/tools/path-utils.js` `resolveToCwd` | identical strings for every fixture |
| E9 | APC-1 | parity (win32 flavour) | L1 | automated | injected `path.win32`, `C:\w\repo`, targets `..\x`, `D:\x`, `\\srv\share\x`, `c:\W\REPO\a` | decide read | `D:\x` and UNC → `ask`; case-variant of cwd → `in-root` on case-insensitive volume |
| E10 | APC-1 | EP (non-gated tool) | L1 | automated | tool `bash` input `cat /w/other/x` | handler | returns `undefined`, no UI call |
| E11 | APC-2 | EP (checkout root) | L1 | automated | cwd `/w/repo/packages/a`, probe resolves `/w/repo` | decide read `/w/repo/README.md` | `in-root` |
| E12 | APC-2 | fault (probe timeout) | L1 | automated | probe exceeds bound | decide read `/w/repo/README.md` from `packages/a` | falls back to cwd-only → `ask` |
| E13 | APC-2 | decision table (built-ins) | L1 | automated | loaded skill dir `/h/.pi/agent/skills/x` | read `SKILL.md`; edit `SKILL.md` | read `in-root`; edit `ask` |
| E14 | APC-2 | EP (tmpdir) | L1 | automated | `os.tmpdir()/pi-test.log` | write | `in-root` |
| E15 | APC-2 | EP (grant subtree) | L1 | automated | store holds `/w/other` | read `/w/other/docs/a.md`; read `/w/other2/a.md` | first `in-root`; second `ask` |
| E16 | APC-2 | state (revoke) | L1 | automated | store holds `/w/other`, then file rewritten without it (mtime bump) | next decide read `/w/other/a.md` | `ask` |
| E17 | APC-2 | EP (malformed store) | L1 | automated | `access-grants.json` = `{not json` | decide read `/w/other/a.md` | `ask`, no throw |
| E18 | APC-4 | decision table (offer) | L1 | automated | combos: grantable×{store match, mismatch, no identity frame}, ungrantable (`~/notes.txt`), sensitive (`~/.ssh/x`) | build options | `Always allow` only for grantable+match; others `Allow once`/`Deny` + note text |
| E19 | APC-4 | EP (no ancestor) | L1 | automated | gated `/w/other/docs/a.md` | build options | only directory named is `/w/other/docs` |
| E20 | APC-3 | state (allow once) | L1 | automated | out-of-root read | answer `Allow once`, then same read again | 1st handler → `undefined`; 2nd raises a new prompt |
| E21 | APC-5 | BVA (suppression window) | L1 | automated | deny `/w/other/a.txt` at t=0 (fake clock) | read `/w/other/b.txt` at t=119 s and t=121 s | 119 s → block `recently-denied`, no UI call; 121 s → prompt |
| E22 | APC-5 | EP (suppression scope) | L1 | automated | deny `/w/newproj1/a.txt` (absent dir) in session S | S writes `/w/newproj2/b.txt`; T reads `/w/newproj1/a.txt` | both prompt |
| E23 | APC-5 | decision table (suppression vs sensitive) | L1 | automated | deny `~/.ssh/a` | read `~/.ssh/b` within 120 s | block `recently-denied`, no prompt |
| E24 | PAG-A | EP (subject derivation) | L1 | automated | request path `/w/other/docs/a.md`, subject `/w/other/docs` | server handles `path_grant_request` | stored subject = realpath `/w/other/docs`, `scope:"project"`, `via:"agent-prompt"`, origin = session |
| E25 | PAG-A | decision table (binding) | L1 | automated | entries: wrong session, unknown promptId, used promptId, expired, cancelled, path mismatch, subject mismatch | `path_grant_request` | each → `path_grant_result ok:false`, store unchanged |
| E26 | PAG-A | state (replay) | L1 | automated | confirm seen at t=0 (TTL 120 s), replayed at t=100 s | grant request at t=125 s | refused (expired; replay did not extend) |
| E27 | PAG-A | BVA (settled window) | L1 | automated | confirm `prompt_dismiss` at t=0 | grant request at t=4.9 s / t=5.1 s | 4.9 s accepted; 5.1 s refused |
| E28 | PAG-A | EP (subject swap) | L1 | automated | confirm named `/w/other/docs`; dir replaced by symlink → `/w/secret` | grant request | refused, store unchanged |
| E29 | PAG-A | EP (forbidden) | L1 | automated | path `/h/notes.txt` (home) | grant request | refused |
| E30 | PAG-M | regression | L1 | automated | existing HTTP grant route without denial id | POST grant | still refused exactly as today |
| E31 | APC-4 | EP (store id) | L1 | automated | two servers ensure `grant-store-id` concurrently (temp dir) | both start | file created once (`O_EXCL`); both announce the same token |
| E32 | APC-6 | decision table (config) | L1 | automated | `{enabled:true}`×env `off`; `{enabled:false}`×env unset; malformed value | handler on out-of-root read | env off → `undefined`; disabled → `undefined`; malformed → default enabled |
| E33 | PAG-A | compat | L1 | automated | grant list containing `via:"agent-prompt"` and an unknown `via:"x"` | render Access list | agent row labelled "Agent prompt" + session; unknown row shows generic prompt origin |
| E34 | APC-1 | import guard | L1 | automated | client source tree | scan imports | no client file imports `forbidden-subjects` / `canonical-subject` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | APC-7 | tail-latency | L1 | automated | 10 000 in-root `decidePathAccess` calls (settled probe, 200-entry grant store) | p95 < 1 ms; 0 server messages sent | one run |
| P2 | APC-7 | tail-latency | L1 | automated | 10 000 handler calls with gate disabled | p95 < 0.05 ms; no fs syscalls (spy) | one run |
| P3 | APC-7 | fault (server unreachable) | L1 | automated | `sendToServer` rejects / never resolves | in-root read handler | returns `undefined` with no await on server |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | APC-3 | state-convergence | L3 | automated | faux scenario `tool-read-outside` reads `/etc/hostname` | send `[[faux:tool-read-outside]] go` | chat card in that session shows path + `Allow once`/`Deny`; no app-wide modal (`role=dialog` from grant host absent) |
| F2 | APC-3 | state-convergence | L3 | automated | F1 card open in two tabs | tab A answers `Allow once` | tab B card removed; tool result row renders file content |
| F3 | APC-4 | state-transition | L3 | automated | faux `tool-read-outside-grantable` reading `/srv/fixtures-outside/a.txt` | choose `Always allow`, confirm | grant appears in Settings ▸ Access labelled "Agent prompt"; a second faux read of a sibling file renders no card |
| F4 | APC-4 | state-transition | L3 | automated | as F3 | choose `Always allow`, then cancel confirm | tool result shows blocked reason `denied`; Access list unchanged |
| F5 | SAR-R | state-convergence | L3 | automated | session A blocked on F1 card, viewing session B | observe folder header | needs-you rollup shows "1"; A's card still shows `read` as current tool |
| F6 | SAR-R | state-transition (reconnect) | L3 | automated | as F5 | drop + restore the bridge WS (`page.routeWebSocket` / harness restart of bridge link) | rollup still "1" after reconnect; card still answerable |
| F7 | SAR-T | state-convergence | L3 | automated | viewing B, A raises a gate prompt | — | non-modal toast names A with Open; clicking Open selects A; toast gone after answer |
| F8 | SAR-T | EP | L3 | automated | viewing A | A raises gate prompt | no toast |
| F9 | APC-6 | state | L3 | automated | Settings ▸ Security | toggle gate off, re-run F1 faux | no card; file read succeeds |
| F10 | APC-3 | visual/subjective | — | manual-only | gate card in chat (light + dark theme, mobile width) | human review | [judgment: path legible, sensitive warning noticeable, no allow option visually dominant] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | APC-5 | fault (deny) | L1 | automated | operator answers `Deny` | handler | `{block:true}` reason contains `denied`; log line `outcome=denied` |
| X2 | APC-5 | fault (dismiss) | L1 | automated | `select` resolves `undefined` | handler | `{block:true}` reason `denied` |
| X3 | APC-5 | fault (delay → timeout) | L1 | automated | no answer; fake clock 120 s | handler | `{block:true}` reason `timeout`; PromptBus `cancel(promptId)` called once |
| X4 | APC-5 | fault (shared budget) | L1 | automated | select answered `Always allow` at 100 s, confirm never answered | handler | blocks at 120 s (`timeout`), confirm cancelled; no grant request sent |
| X5 | APC-5 | fault (no UI) | L1 | automated | `ctx.hasUI === false` | handler on out-of-root read | `{block:true}` reason `no-ui`; no UI method called |
| X6 | APC-5 | fault (internal error) | L1 | automated | `ctx.cwd` getter throws | handler | `{block:true}` reason `error`; does not propagate |
| X7 | APC-4 | fault (grant write fails) | L1 | automated | `path_grant_result ok:false error:"cap"` | after confirm | handler returns `undefined` (runs once); card note "not saved: cap"; log `allowed-always` + failure |
| X8 | APC-4 | fault (migration) | L1 | automated | identity frame from server A (match), grant request answered by server B (no entry) | after confirm | `ok:false` → runs once, not saved |
| X9 | APC-5 | concurrency | L1 | automated | two out-of-root calls in one session issued concurrently to the handler | both pending | only one prompt open at a time (mutex); second asks after first settles |
| X10 | SAR-R | fault (disconnect) | L1 | automated | server tracks gate prompt, bridge disconnects | disconnect, then replay burst with same prompt | `awaitingFileAccess` false after disconnect, true after replay; `currentTool` unchanged across both |
| X11 | SAR-R | fault (sibling start) | L1 | automated | gate prompt pending | `tool_execution_start` for sibling `grep` | `awaitingFileAccess` stays true; `currentTool` = `grep` |
| X12 | APC-5 | fault (TUI only) | — | manual-only | no dashboard attached, interactive TUI | agent reads out-of-root path | [judgment: select shown in terminal, answer honoured, no Always allow offered] |
| X13 | APC-4 | fault (remote store) | — | manual-only | bridge attached to a dashboard on another machine via SSH forward | out-of-root read | [judgment: no Always allow; note "can't be remembered here" shown — needs two machines] |
| X14 | APC-1 | multi-OS | L2 | automated | Windows QA VM | run extension path-gate + shared canonical-subject vitest suites natively | suites pass on win32 |

## Coverage summary

- Requirements covered: 11/11 (APC-1..7, PAG-M, PAG-A, SAR-R, SAR-T)
- Scenarios by class: edge 34 · perf 3 · frontend 10 · error 14
- Scenarios by level: L1 48 · L2 1 · L3 9 · — 3
- Scenarios by disposition: automated 58 · manual-only 3

## New infra needed

- Faux catalog entries in `qa/fixtures/faux-scenarios.ts`: `tool-read-outside`
  (read `/etc/hostname`) and `tool-read-outside-grantable` (read files under a
  harness-created `/srv/fixtures-outside/`), plus that directory in the docker
  test image.
- Windows QA hook to run the two vitest suites (X14) — extend the existing
  Windows qa runner rather than a new VM job.
