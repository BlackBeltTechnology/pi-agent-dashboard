# Test Plan — resolve-archived-attached-proposal

Stage: design   Generated: 2026-10-01

Hard gate passed: every Triple slot is concrete in the spec deltas. Concrete values used:
- 5 min TTL
- 30 s retry
- 3 chips + `+N`
- 1-day date tolerance
- route shapes
- readiness gate names

No clarifications were needed.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | resolution: active wins | decision-table | L1 | automated | `attachedProposal="add-auth"`; `openspecMap[cwd]` initialized with change `add-auth`; archive fetch spy | `resolveAttachment` | `{kind:"active", cwd}`; fetch spy called 0 times |
| E2 | resolution: archived in place | decision-table | L1 | automated | cwd known without `add-auth`; archive(cwd) = [`2026-09-30-add-auth`] | resolve | `{kind:"archived", entry.name:"2026-09-30-add-auth", cwd: session.cwd}` |
| E3 | resolution: removed worktree → mainPath | decision-table | L1 | automated | `cwd=/repo/.worktrees/os-add-auth` with final placeholder `initialized:false, readiness:ABSENT`; `mainPath=/repo` known without `add-auth`; archive(/repo) has `2026-09-30-add-auth` | resolve | `{kind:"archived", cwd:"/repo"}` |
| E4 | resolution: active in mainPath | decision-table | L1 | automated | cwd ABSENT placeholder; `/repo` known with active `add-auth` | resolve | `{kind:"active", cwd:"/repo"}` |
| E5 | resolution: nothing found | decision-table | L1 | automated | cwd + mainPath known without the name; both archives `[]` | resolve | `{kind:"missing"}` |
| E6 | resolution: exact-name match + escaping | EP | L1 | automated | name `add-auth`, archive [`2026-09-30-add-auth-v2`]; name `a.b`, archive [`2026-09-30-a-b`] | resolve each | both `{kind:"missing"}` |
| E7 | disambiguation: on/after start | BVA | L1 | automated | entries `2026-05-01-add-auth`, `2026-09-30-add-auth`; `startedAt` = local 2026-09-20 | resolve | entry `2026-09-30-add-auth` |
| E8 | disambiguation: tz tolerance | BVA | L1 | automated | entries `2026-09-29-add-auth`, `2026-05-01-add-auth`; `startedAt` = local 2026-09-30 00:30 | resolve | entry `2026-09-29-add-auth` |
| E9 | disambiguation: fallback newest | BVA | L1 | automated | entries `2026-05-01-x`, `2026-06-01-x`; `startedAt` = 2026-09-20 | resolve | entry `2026-06-01-x` |
| E10 | resolution: unsettled = unresolved | state-transition | L1 | automated | no `openspecMap` entry for cwd (then a `pending:true` placeholder) | resolve | `{kind:"unresolved", reason:"loading"}` both times; archive fetch spy 0 calls |
| E11 | resolution: disabled folder | decision-table | L1 | automated | cwd placeholder readiness `OPTED_OUT` (and separately `GLOBAL_OFF`) | resolve | `{kind:"unresolved", reason:"disabled"}` |
| E12 | resolution: mainPath gated = unavailable | decision-table | L1 | automated | cwd ABSENT; mainPath placeholder readiness `OPTED_OUT`; archive(/repo) has `2026-09-30-x` | resolve | `{kind:"archived", cwd:"/repo"}` (step skipped, not blocked) |
| E13 | resolution: active beats archived | decision-table | L1 | automated | cwd active `add-auth` AND archive(cwd) has `2026-05-01-add-auth` | resolve | `{kind:"active"}` |
| E14 | resolution: mainPath === cwd skips steps 2/4 | EP | L1 | automated | `gitWorktree.mainPath === cwd`, cwd known without name, archive(cwd) `[]` | resolve | `{kind:"missing"}`; exactly 1 archive fetch (cwd) |
| E15 | cache: dedupe | EP | L1 | automated | 20 hooks `useArchiveEntries("/repo")` mounted together; fetch mock deferred | mount | fetch called exactly once; all 20 receive same entries |
| E16 | cache: signature invalidation | state-transition | L1 | automated | cached `/repo` with activeSig `["add-auth","b"]` | active set becomes `["b"]`; read | a 2nd fetch issued |
| E17 | cache: TTL boundary | BVA | L1 | automated | cached `/repo` listing, unchanged sig, fake timers | read at 4:59, then at 5:00 | 0 refetch at 4:59; 1 refetch at 5:00 |
| E18 | cache: lazy | EP | L1 | automated | 5 sessions all resolving `active` | render cards | archive fetch spy 0 calls |
| E19 | reconcile: ended attached folder | EP | L1 | automated | ended session attached to `add-auth`, unpinned `/proj`, no other session | App `renderedCwds` memo → `useOpenSpecReconcile` | `openspec_get` sent for `/proj` exactly once while unsettled |
| E20 | reconcile: worktree pair | EP | L1 | automated | rendered ended session `cwd=/repo/.worktrees/os-x`, `mainPath=/repo`, plus a 2nd session in `/repo` | reconcile run | `openspec_get` for `/repo/.worktrees/os-x` once and `/repo` once (deduped) |
| E21 | reconcile: archive route candidates | EP | L1 | automated | archive route `/repo` active; non-rendered ended session A `cwd=/repo/.worktrees/os-x`, attached `x`; archive(/repo) has `2026-09-30-x` | reconcile run | `renderedCwds` contains `/repo` and `/repo/.worktrees/os-x` |
| E22 | route builder | EP | L1 | automated | cwd `/a b/ü`, entry `2026-09-30-x`, artifact `design` | `buildArchiveArtifactUrl` then parse | path `/folder/<encodeFolderPath>/openspec/archive/2026-09-30-x/design`; round-trip yields same cwd/entry/artifact |
| E23 | preview route guard | decision-table | L1 | automated | URL `/folder/<enc>/openspec/archive/2026-09-30-x` | render shell routes | archive list renders; OpenSpec preview NOT mounted |
| E24 | deep-link fallback | EP | L1 | automated | URLs with unknown entry `2026-01-01-nope`, and known entry + artifact `design` absent | render | archive list for that cwd renders; no reader |
| E25 | back-target depth | state-transition | L1 | automated | current URL = archive deep link, empty history | `computeParent` | returns `/` (depth-2 `/folder/:cwd/openspec/*` rule) |

### Performance

No latency or throughput budget in the spec. Request fan-out is functional and covered by E15, E18, E19 and E20.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | archived header (desktop) | decision-table | L1 | automated | session resolves archived, entry artifacts [proposal, design, tasks]; status `idle` AND `ended` | render `SessionOpenSpecActions` | badge text `Archived 2026-09-30`; letters P,D,T in that order; `⋯` items == [Detach]; no lifecycle bar, no primary button (both statuses) |
| F2 | missing header | EP | L1 | automated | resolves missing | render | `Not found` badge with title "Not in active changes or archive (pull may be needed)"; `⋯` == [Detach] |
| F3 | unresolved header | EP | L1 | automated | resolves unresolved (loading / disabled / error) | render | name only; no badge; `⋯` == [Detach] |
| F4 | active elsewhere | decision-table | L1 | automated | ended session `cwd=/repo/.worktrees/os-x` resolves active with `cwd=/repo` | render card | `In main checkout` badge; letters link to `/folder/<enc /repo>/openspec/x/<artifact>`; no Apply/Continue/Archive; `⋯` == [Detach] |
| F5 | letter navigation | state-transition | L1 | automated | archived header on unselected sidebar card | click `D` letter | `navigate` called (push) with `/folder/<enc cwd>/openspec/archive/2026-09-30-add-auth/design`; card select handler not called |
| F6 | mobile header chip | decision-table | L1 | automated | mobile viewport, archived resolution | render `SessionHeader` | `mobile-header-attached-chip` contains name, `Archived` badge, letters; no Detach inside the chip; `MobileAttachButton` popover lists Detach |
| F7 | mobile action menu | decision-table | L1 | automated | mobile, archived resolution, all workflows enabled | open `MobileActionMenu` | no Continue/Apply/Archive/Verify/Explore rows |
| F8 | running session flips live | state-transition (convergence) | L3 | automated | harness session attached to fixture change `e2e-archive-flip` in `sample-git` | docker exec `mv openspec/changes/e2e-archive-flip openspec/changes/archive/<today>-e2e-archive-flip` | card converges to `Archived <today>` badge with no page reload; never shows `Not found` in between |
| F9 | archive browser chips | decision-table | L1 | automated | `/repo` archive with `2026-05-01-x`, `2026-09-30-x`; 5 sessions resolving to `2026-09-30-x` (1 cwd match, 4 mainPath matches) | render `ArchiveBrowserView` | `2026-09-30-x` row: 3 chips + `+2`; `2026-05-01-x` row: 0 chips |
| F10 | chip navigation | state-transition | L1 | automated | entry row with chip for session A | click chip | navigate to A's session route; reader NOT opened |
| F11 | deep-link Back restores session | state-transition | L3 | automated | harness session with archived attachment (seeded archive dir) | click letter `P`, then browser Back | reader shows proposal of archived entry; after Back URL is `/session/<id>` and session view renders |
| F12 | list-launched Back unchanged | state-transition | L1 | automated | archive browser with search `auth` | open entry reader, click Back | list renders with search value `auth` retained |
| F13 | detach on archived | EP | L1 | automated | archived header | `⋯` → Detach | WS `{type:"detach_proposal", sessionId:"s1"}` sent |
| F14 | visual polish of badges/chips | visual/subjective | — | manual-only | desktop card, mobile 360px header, archive rows | human looks | [judgment: badge contrast, truncation, chip spacing look right in all 4 themes] |
| F15 | live data sanity | visual/subjective | — | manual-only | real dashboard with ended sessions attached to archived changes (e.g. `fix-chat-burst-tool-stop`) | human opens sidebar + archive browser | [judgment: archived sessions show date + letters; archive rows show the right sessions] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | cache: error + retry | fault-injection (abort) | L1 | automated | `/api/openspec-archive` returns 500 | resolve, then read at +29 s and +30 s (fake timers) | `{kind:"unresolved", reason:"error"}`; `useArchiveListing().error` set; no refetch at 29 s; refetch at 30 s |
| X2 | openspec_get lost reply | fault-injection (abort) | L1 | automated | `openspec_get` never answered | 15 s timeout elapses | attachment stays `unresolved{loading}` (never `missing`); a new `openspec_get` is sent on the next reconcile pass |
| X3 | slow archive fetch | fault-injection (delay) | L1 | automated | archive fetch resolves after 2 s | render card, advance timers | before resolve: bare header with no `Not found`; after: `Archived` badge |
| X4 | reader for unknown mainPath | fault-injection (abort) | L1 | automated | `/api/file` 403 `unknown cwd` for the archive artifact | open deep link | reader shows its error state (existing access-grant path), no crash; Back works |

---

## Coverage summary

- Requirements covered: 13/13 (resolution ×4, attach-combo ×4, archive-browser ×3, url-routing ×2; the MODIFIED requirements are covered via their new clauses)
- Scenarios by class: edge 25 · perf 0 · frontend 15 · error 4
- Scenarios by level: L1 40 · L2 0 · L3 2
- Scenarios by disposition: automated 42 · manual-only 2

## New infra needed

- none. L3 reuses the docker harness and the `sample-git` fixture, plus out-of-band `docker exec` seeding (as `archive-fold.spec.ts` does). It needs a new fixture change `e2e-archive-flip` in `sample-git/openspec`.
