# Test Plan — add-session-scoped-init-trust

Adversarial scenarios derived from `specs/worktree-init-hook/spec.md` (MODIFIED TOFU requirement) + `design.md`. Stage: proposal/design. No spec gaps — every Triple fills. `disposition` is the fold/defer source of truth.

Legend: **level** L1 = vitest unit · L3 = Playwright e2e (docker harness, derived port). **disp** = automated | manual-only.

## Trust store — `packages/server/src/worktree-init-trust.ts` (exemplar: `__tests__/worktree-init-trust.test.ts`)

| # | class | technique | level | disp | Triple (input · trigger · observable) |
|---|---|---|---|---|---|
| S1 | edge-case | state | L1 | automated | in-memory session store empty · `recordTrust(root, h, "session")` · `isTrusted(root,h)===true` AND `worktree-init-trust.json` is not created / does not contain the key |
| S2 | edge-case | state | L1 | automated | clean stores · `recordTrust(root, h, "project")` then reload persisted store from disk · persisted map contains key AND `isTrusted===true` after reload |
| S3 | edge-case | decision-table | L1 | automated | key present ONLY in session set, absent from disk · `isTrusted(root,h)` · returns `true` (OR-combine; disk miss + memory hit) |
| S4 | edge-case | decision-table | L1 | automated | clean stores · `recordTrust(root, h)` called with scope arg omitted/undefined · behaves as `project` — persisted file written, `isTrusted===true` |
| S5 | error-handling | state-transition | L1 | automated | session grant recorded · module/process re-initialized (fresh in-memory Set, disk untouched) · `isTrusted===false` AND persisted store still lacks the key |
| S6 | edge-case | equivalence | L1 | automated | session grant recorded via `configRoot="./repo"` · query `isTrusted` with the absolute form of the same dir · returns `true` (both stores key via identical `path.resolve`-based `trustKey`; no false negative) |
| S7 | error-handling | state-transition | L1 | automated | session grant for `hashA` · compute `hashB=hookDefHash(editedHook)` (gate/command/prompt/model changed) · `isTrusted(root,hashB)===false` until recorded for `hashB` |

## Init route — `packages/server/src/routes/git-routes.ts` `POST /init` (exemplar: `__tests__/routes-git-worktree-init.test.ts`)

| # | class | technique | level | disp | Triple (input · trigger · observable) |
|---|---|---|---|---|---|
| S8 | error-handling | decision-table (negative) | L1 | automated | untrusted hook, `confirmHash===hash` but `scope="Session"` (wrong case) / `"permanent"` / `""` / non-string · POST /init · response `{success:false, code:"bad_request"}`, `recordTrust` NOT called, `runInitHook` NOT called |
| S9 | edge-case | decision-table | L1 | automated | untrusted hook, `confirmHash===hash`, `scope="session"` · POST /init · `recordTrust(root,hash,"session")` called, hook runs, nothing written to `worktree-init-trust.json` |
| S10 | edge-case | decision-table | L1 | automated | untrusted hook, `confirmHash===hash`, scope field absent · POST /init · `recordTrust` records `project` (persisted), hook runs |
| S11 | error-handling | state | L1 | automated | hook untrusted in BOTH stores, no `confirmHash` · POST /init · response `{success:false, code:"init_untrusted", data:{hook,hash}}`, hook NOT run |
| S12 | edge-case | state | L1 | automated | external non-git dir (`resolveConfigRoot(cwd)===cwd`), untrusted hook, confirm with `scope="session"` · POST /init · session grant keyed by `cwd`, hook runs, `worktree-init-trust.json` unchanged |
| S13 | error-handling | state | L1 | automated | `autoInitWorktreeOnSpawn` ON, spawned checkout hook untrusted in both stores · auto-init path evaluated · auto path does NOT call init with forged trust; run only proceeds via manual confirmed path |

## Client confirm dialog — `WorktreeInitButton.tsx` (exemplar: `tests/e2e/worktree-init-feedback.spec.ts`, derived harness port)

| # | class | technique | level | disp | Triple (input · trigger · observable) |
|---|---|---|---|---|---|
| S14 | frontend-quirk | state-transition | L3 | automated | untrusted-hook worktree row · click Initialize · dialog shows Cancel + two affirmative actions labeled "Trust until dashboard restarts" and "Always trust"; clicking the session action drives the init chip to `done` (hook ran) |
| S15 | frontend-quirk | decision-table | L3 | automated | same dialog · click "Always trust" · init chip reaches `done` AND (probe) the grant is persisted (survives a status re-probe styled as trusted) |
| S16 | subjective-ux | — | — | manual-only | rendered dialog copy · human reads both labels · the session label communicates ephemerality ("until dashboard restarts") without implying per-tab scope, and the two choices are unambiguous — subjective copy judgment, no automatable signal |

## New infra needed

None. All three levels have existing exemplars; no new harness.
