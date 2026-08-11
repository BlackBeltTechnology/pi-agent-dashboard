## Context

The server infers a session's OpenSpec change from its forwarded tool-event stream. `detectOpenSpecActivity(toolName, args)` (in `packages/shared/src/openspec-activity-detector.ts`) pattern-matches tool arguments; `event-wiring.ts` (~880-940) then stamps `openspecChange` and, for active operations, `attachedProposal` + an auto-rename.

The detector receives **no `cwd`**. Its inputs are model-authored tool arguments — untrusted, arbitrary strings. Two of its patterns are therefore cwd-blind by construction:

- `CHANGE_PATH_RE` = `/openspec\/changes\/([^/]+)\//` — unanchored, so it matches the segment inside **any** path string, absolute or relative, including an absolute path into another repository on disk.
- `CLI_NEW_CHANGE_RE` / `CLI_ARCHIVE_RE` / `CLI_CHANGE_FLAG_RE` — match an `openspec` invocation anywhere in a command string, including after a `cd` into another repository.

Downstream, `isValidOpenSpecChangeSlug` validates only the *shape* of the captured token. Nothing validates its *locality*. The observed failure: a session in `pi-agent-dashboard` ran `cd /Project/pi-dashboard-subagents && npx openspec new change fix-stale-pi-handle-on-reactivation` and was attached + renamed to a change that has never existed in its own repository.

Two assets already exist and are deliberately reused rather than reinvented:

- `openSpecChangeExistsInCache(directoryService, cwd, changeName)` — already imported at the call site, reads the in-memory poll cache, never triggers a fresh poll. It is currently applied only to the *previously attached* name (the deleted-proposal bypass), never to the newly detected one. Note it **fails open**: `if (!data || !data.initialized) return true`. Correct for a bypass predicate, unacceptable as a gate — see D6.
- `cwd-session-containment` — boundary-correct path containment that already handles the sibling-prefix trap (`/repo-other` is not inside `/repo`). **Caveat, verified:** its implementation `isPathInside` lives in `packages/server/src/session/active-sessions-in-cwd.ts`, and `packages/shared` does not depend on `packages/server` (its only dependency is `bonjour-service`). Since D3 puts the containment check *inside* the shared detector, the helper must be **relocated into `packages/shared`** and re-imported by its existing server callers. This is a real code move, not free reuse — see D3 and the Impact list.

The neighbouring canvas detector, reading the identical event stream, already documents the target posture: *"cwd comes from server session state, never the model (anti-traversal)."*

## Goals / Non-Goals

**Goals**

- No session is auto-attached to a change that is **positively known** not to exist in its own project. The qualifier is load-bearing and honest: on an unpopulated cache the gate cannot know, and by D6 it allows. See R-COLD.
- The `openspecChange` activity stamp obeys the same locality rule as the attach.
- The **system** — detector plus gate — cannot be induced to attach a change belonging to another root by path or command-string content. Stated at system level deliberately: the detector alone is evadable (see R-EVADE), which is why D1 and not D3 is the load-bearing guard.
- The user is told when a detected change was rejected for locality, rather than silently losing the signal — except where the absence is expected rather than foreign (D4a).

**Non-Goals**

- Changing manual attach (browser handler, REST `POST /api/session/:id/attach-proposal`). Those accept any name from a server-curated list and are user-intentional. Out of scope.
- Retroactively repairing sessions that already carry a foreign attachment. Preventive only.
- Supporting deliberate cross-repository attachment as a feature. If that is ever wanted it is a separate, explicit capability — not an inference.
- Multi-root / OpenSpec store awareness. `openspec store list` is empty in practice here; a store-registered root is future work (see Open Questions).

## Decisions

### D1 — Gate on existence in the session cwd, not on parse cleverness

Auto-attach requires `openSpecChangeExistsInCache(directoryService, session.cwd, changeName)`. This is the load-bearing guard: it is a positive assertion about the session's own repository and cannot be defeated by any command-string shape.

*Alternative considered:* rely purely on hardening the regexes. Rejected — regex hardening is an arms race against arbitrary model-authored strings, and any miss silently re-opens the hole. Existence is the invariant we actually care about.

*Consequence:* the check consults the poll cache. A change created seconds ago may not be cached yet, producing a transient miss. Accepted — see R1.

### D2 — Gate the `openspecChange` stamp on the same check

`openspecChange` is written **before** the attach branch. Gating only the attach leaves the activity badge advertising a foreign change — the visible symptom would persist. Both stamps share one locality precondition.

*Alternative considered:* gate the attach only, treating `openspecChange` as harmless telemetry. Rejected — it is rendered on the card, so it is not telemetry.

### D3 — Thread `cwd` into the detector as defence in depth

`detectOpenSpecActivity(toolName, args, cwd)` gains a session-`cwd` parameter:

- Path matches: the matched path must be contained by `cwd` using the boundary-correct helper. Relative paths are resolved against `cwd` before the containment test.
- CLI matches: **conservative** guard — if the command contains a `cd`/`pushd` to a path outside `cwd` **anywhere** in the command string, CLI detection is disabled for that command entirely. The predicate is positional-insensitive on purpose: reasoning about whether a relocation precedes the `openspec` token requires parsing `&&` / `;` / `|` / subshell nesting, which is exactly the shell-semantics guessing this decision exists to avoid. The spec scenarios are written to the same positional-insensitive rule.

**The helper must move.** `isPathInside` currently lives in `packages/server/src/session/active-sessions-in-cwd.ts`; `packages/shared` cannot import from `packages/server`. Relocate `isPathInside` into `packages/shared` and re-point its existing server callers (`active-sessions-in-cwd.ts` and its test, plus `git-routes.ts` via that module). Do **not** duplicate it — two copies of a boundary predicate is precisely how the sibling-prefix trap gets reintroduced in one of them.

*Why conservative over targeted* (the alternative: only reject when the `cd` target is a different OpenSpec root): the targeted variant needs a filesystem probe per detection to decide whether the target *is* a root, on a hot event path, and still has to guess at `&&` / `;` / subshell / `pushd` / variable-expansion semantics. The conservative rule needs no probe and fails toward *not inferring*. The cost — a genuinely local `openspec` command that first `cd`s **outside** the repo loses auto-detection — is acceptable because D1 already protects correctness; D3 exists to stop the *stamp* from being wrong, not to be the only line of defence.

*Consequence:* D3 is not sufficient alone — a same-named change in another checkout still parses, and the `cd` scan is evadable (R-EVADE) — which is precisely why D1 is the primary gate.

### D4 — Surface the rejection through the existing notify channel

On rejection, emit one notify entry via `handleNotify(sessionId, entry)` — already defined in `event-wiring.ts`, the same module — with `level: "info"` and a message naming the change and the reason, e.g. `Detected OpenSpec change "<name>" outside this folder — not attached.` The entry requires a freshly minted `notifyId` (`NotifyLogEntry` = `{ notifyId, message, level? }`); mint it with `crypto.randomUUID()` as the existing normalization path does.

*Alternatives considered:*
- *Client-side `noticeSessionIds`.* Rejected — that set is derived from `sessionStates` and means "last turn returned reasoning with no answer". Overloading it conflates two unrelated conditions on the same card affordance.
- *A new `DashboardSession` field.* Rejected — a new persisted field, its broadcast, and its client rendering for a transient advisory is disproportionate when a durable, capped, already-rendered transcript channel exists.

`notifyLog` is the right shape: transcript history, retained across session end and browser refresh, capped at `NOTIFY_LOG_CAP` (50), and explicitly **not** wired into `hasPendingPromptRequests` / `hasPendingAsk` / `currentTool` — so it cannot make a session look busy or block the reaper.

*Precision on "writes no session state":* `handleNotify`'s docstring says it writes none, but the path is `handleNotify` → `appendNotify` → `sessionManager.update(sessionId, { notifyLog })` (`browser-gateway.ts`), and `update` fires `onChange` (`memory-session-manager.ts`). So it *does* persist the log and trigger the debounced meta write. The properties the spec actually requires — no `currentTool`, no unread stamp, no reorder, no pending-ask contribution — hold because `onChange` is persistence-only and reorder/broadcast are performed elsewhere. This change inherits that behaviour unchanged from the existing notify call site; it is stated here so a future reader does not take the docstring literally.

### D4a — Suppress the notice when the evidence looked local

The canonical local flow trips the gate: `openspec new change <name>` **creates** the change and forwards the tool event immediately, while the poll cache — already initialized — does not yet list it. That is a positive absence, so D1/D6 reject, and the attach lands one poll cycle later. The rejection is correct and MUST stand (this is the incident's exact command shape). But telling the user the change is "outside this folder" would be **factually wrong** for the most common trigger.

Suppressing only *creation-CLI* detections is insufficient, and the reason is the whole point of this decision. The create is immediately followed by writes to `openspec/changes/<name>/proposal.md` and `tasks.md`. Those are **path** detections (`CHANGE_PATH_RE`), not creation-CLI ones, and they land inside the same stale-cache window. A creation-only rule lets them through: the user gets the false "outside this folder" notice anyway, *and* the emitted notice records a dedupe key (D5) that silences the later genuinely-foreign notice for that name. The two decisions would defeat each other.

**Decision — suppress on locality of evidence, not on pattern kind.** Maintain a per-session set of change names whose detection evidence *looked local* in this session:

- a change-creating CLI pattern (`CLI_NEW_CHANGE_RE`), or
- a path detection whose matched path was contained by a candidate root.

A rejection whose name is in that set is silent. Every other rejection notifies per D4.

The justification generalises beyond the create flow. After D3, evidence that is *provably* foreign — an out-of-root path, an outside-`cd` command — never reaches the gate at all; the detector already dropped it. So a gate rejection carrying local-looking evidence is overwhelmingly **cache staleness**, not foreignness, and is not worth telling the user about. What survives to notify is the residue: names reaching the gate on evidence that was neither provably local nor caught by D3 — D3 evasions (R-EVADE) and collisions (R-COLLISION), which is exactly the population worth surfacing.

*Alternatives considered:*
- *Neutral wording for all rejections* ("not found in this folder yet"). Rejected — dilutes the one message that matters into routine noise on a flow that self-heals.
- *Drop the notice entirely* (silent reject + server log). Genuinely tempting given how much of the rejection population is stale-cache noise, and it would delete D4a/D5 and their whole failure surface. Rejected to keep a user-visible signal for the residue above; the log line is retained regardless.
- *Suppress creation-CLI only.* Rejected — the defect described above.

### D6 — Treat the cache as tri-state; reject only on a positive absence

`openSpecChangeExistsInCache` collapses "not in this repo" and "cache not populated yet" into one boolean, and answers `true` for both. Reusing it verbatim as the gate would leave the hole open on every cold cache.

The gate therefore resolves three states:

| Cache state | Meaning | Gate |
|---|---|---|
| initialized, name present | change is local | **allow** |
| initialized, name absent | positively foreign | **reject** + notice |
| no data / `initialized === false` | unknown | **allow** (no notice) |

Rejection requires a *positive* absence from an initialized cache. This closes the observed failure — in that incident the `pi-agent-dashboard` cache was initialized and the change was genuinely absent — while never blocking on ignorance.

*Alternative considered:* fail closed on unknown. Rejected — the cache is cold at startup and for every newly-seen directory, so it would break legitimate attaches routinely, and availability loss is a worse trade than a narrow timing window that the next poll closes.

*Implementation note:* do not change `openSpecChangeExistsInCache` itself — the deleted-proposal bypass depends on its fail-open answer. Add a distinct tri-state helper.

### D7 — Resolve against the session cwd **and** its worktree main path

Verified counter-example: session `019fead7` runs in `.worktrees/os-harden-mutation-harness-restore` and is legitimately attached to `harden-mutation-harness-restore`, but that change directory exists **only in the main checkout** — the worktree's own `openspec/changes/` does not contain it (its branch predates the change). A gate keyed on the session `cwd` alone would falsely reject it.

The gate accepts the change when it is present in the cache for **either** the session `cwd` **or** `session.gitWorktree.mainPath`.

This is a **union of candidate roots**, deliberately *not* a mirror of `resolveSessionGroupPath`. That function returns a *single* path by precedence (`pin > gitWorktree.mainPath > cwd`) and a pin makes it ignore `mainPath` entirely; the gate instead considers every root the session could legitimately belong to. The union is strictly more permissive than the grouping rule, which is correct for an availability-preserving guard — but the two are different operations and must not be described as the same one.

Both lookups are cache reads; neither triggers a poll. Tri-state per D6 composes as: reject only when **every** candidate root is initialized and none contains the name.

*Alternative considered:* session `cwd` only. Rejected — demonstrably breaks the repo's own primary workflow, where nearly every OpenSpec change is implemented from a worktree.

### D8 — Make "worktree state reported" an explicit signal, not an inference from `gitWorktree`

`gitWorktree` is populated from the bridge's periodic `git_info_update`, not at registration — so a freshly spawned worktree session has **no** `mainPath` for the first reporting interval. Under a naive D7 its candidate set is `[worktree cwd]` alone, whose cache *is* initialized and does *not* list a main-only change → the gate would reject a legitimately local change and emit a spurious notice on every fresh worktree session.

**The obvious repair does not work — verified.** `git-worktree-compose.ts` does produce a three-way wire value (`GitWorktreeInfo` / `null` / `undefined`), but that distinction is destroyed before it reaches session state:

- `DashboardSession.gitWorktree` is typed `gitWorktree?: GitWorktreeInfo` — there is no `null` in the type (`packages/shared/src/types.ts`).
- `event-wiring.ts` collapses it: `gitUpdates.gitWorktree = composedWorktree ?? undefined` — wire `null` becomes in-memory `undefined`.
- No code path anywhere writes `gitWorktree: null` into session state.

So at the gate, `undefined` means **both** "bridge reported: not a worktree" and "bridge has not reported yet". Treating that single value as an *unknown root* would make the gate allow unconditionally for **every non-worktree session** — including `019fec3d`, the incident this change exists to fix. Inferring the split from `gitWorktree` alone is therefore not merely imprecise; it silently defeats the change.

**Decision:** add an explicit `gitWorktreeReported?: boolean` to `DashboardSession`, set to `true` whenever the bridge supplies the `gitWorktree` field at all — that is, whenever `composeWorktreePayload` returns something other than `undefined`, covering both the `GitWorktreeInfo` and the cleared-`null` case.

**A session is treated as worktree-resolved when `gitWorktreeReported` is true OR `isGitRepo === false`.** The second disjunct is load-bearing and was missed on the first pass: both bridge emitters bail out when `gatherGitInfo(cwd)` returns undefined, which is exactly what happens for a **non-git** cwd — so a non-git session *never* receives a `git_info_update` and `gitWorktreeReported` would never flip. Without the disjunct, every non-git session stays permanently "unreported" and the gate is a permanent no-op for it. `isGitRepo` is stamped synchronously at `session_register`, and `isGitRepo === false` is a definitive "cannot be a worktree". Note it is `boolean | undefined` — only an explicit `false` counts; `undefined` (probe error) leaves the session unresolved.

Candidate roots are then:

| resolved? | `gitWorktree` | Meaning | Candidate roots |
|---|---|---|---|
| yes | `GitWorktreeInfo` | worktree, main path known | `{ cwd, mainPath }` |
| yes | absent | reported non-worktree, or `isGitRepo === false` | `{ cwd }` — reject-capable |
| no | `GitWorktreeInfo` | restored from `.meta.json`, bridge silent | `{ cwd, mainPath }` **+ unknown root** → allows |
| no | absent | not yet reported | `{ cwd }` **+ unknown root** → allows |

The rule is orthogonal, which removes an ambiguity the earlier 3-row table had: **a present `mainPath` always contributes its root**, and resolvedness independently controls whether an *unknown* root is added. Row 3 is the post-restart case — `session-scanner` restores `gitWorktree` from `.meta.json` while the un-persisted flag is still falsy — and it must not be left to an implementer to guess.

The incident case is preserved: once the bridge reports, `019fec3d` has `gitWorktreeReported = true` with no `gitWorktree`, so its candidate set is `{ cwd }` and the gate rejects.

**Store-only.** `gitWorktreeReported` is a server-internal inference and MUST NOT be added to the object passed to `broadcastSessionUpdated` — that helper forwards its entire updates object to clients, so including the flag would ship a new client-visible field and falsify the proposal's "no schema change".

*Alternatives considered:*
- *Drop the unknown-root injection entirely* (roots = `cwd` + `mainPath`-when-present, reject on unreported). Correct but pays a transient false rejection on every fresh worktree session; rejected in favour of an accurate signal.
- *Preserve the wire `null` into session state* by widening `DashboardSession.gitWorktree` to `GitWorktreeInfo | null | undefined`. Most faithful to the wire, but changes a widely-read type and its broadcast/client consumers for a purely server-side inference. Rejected — larger blast radius than a dedicated boolean.

*Residual, accepted:* the flag is in-memory, so for a brief window after a **server restart** git-repo sessions read as unreported and the gate allows. This is the same shape as R-COLD and bounded by the first `git_info_update` tick; non-git sessions are covered immediately by the `isGitRepo === false` disjunct. Do not persist the flag to `.meta.json` — a stale persisted `true` would be worse than a transient `false`, since it would assert a worktree fact the current process has not observed.

### D9 — Apply the same candidate-root resolution to the deleted-proposal bypass

The existing branch-4 bypass asks `openSpecChangeExistsInCache(directoryService, session.cwd, attached)` — **cwd only**. Under exactly the D7 condition, a worktree session *manually* attached to a main-only change reports `attachedStillExists = false` on every detection, so the attachment is judged auto-tracked and any newly detected change silently re-attaches and renames, with **no replace dialog**. This is pre-existing, not caused by this change, but it is the same defect D7 exists to fix, on the parallel path.

The bypass therefore adopts the same candidate-root resolution (D7 + D8). Fixing it here rather than deferring keeps one definition of "does this change belong to this session's project" in the module instead of two that disagree.

This modifies observable branch-4 behaviour and so carries a spec delta. Note the bypass keeps its **fail-open** disposition on an unknown cache (an unknown root means "still exists", preserving today's semantics); only the set of roots consulted widens. `openSpecChangeExistsInCache` itself is not retired — the tri-state resolver from D6 supplies the roots, and the bypass collapses the tri-state to a boolean with `unknown → exists`.

**Direction-of-safety check.** The widening is monotonic toward `attachedStillExists = true`: consulting more roots can only make an attachment *harder* to classify as deleted. It can therefore move a session out of branch 4 (silent re-attach) into branch 3 (replace dialog) — never the reverse — so it cannot suppress a dialog the user should have seen.

**But the direction that *is* dangerous is the fail-open one**, and it is why D8 had to be fixed first. Had `undefined` been treated as an unknown root for non-worktree sessions, `attachedStillExists` would have been permanently `true` for them, branch 4 would **never** fire, and the existing `Deleted attached proposal bypasses dialog` requirement would be regressed — a genuinely archived attachment would raise a replace dialog the current contract forbids. With D8's explicit signal, a reported non-worktree session resolves over `{ cwd }` only and branch 4 fires exactly as today.

### D5 — Deduplicate the notice per session + change name

A session working cross-repository can emit the triggering tool call many times per turn. Without dedupe a single loop could consume the whole 50-entry cap and evict real notifications. Emit at most once per `(sessionId, changeName)` pair.

**Record the dedupe key only when a notice is actually emitted.** Any suppressed rejection (D4a) MUST NOT record one. Otherwise a session that creates `foo` locally — silently rejected — would have its one meaningful later notice about a genuinely foreign `foo` swallowed. The dedupe set therefore tracks *notices sent*, never *rejections seen*; these are different populations and conflating them is what makes D4a and D5 defeat each other.

*Lifetime, stated precisely* (the reviewers flagged "same lifetime as the session" as undefined against register / unregister / reap): the set is keyed by `sessionId` and **cleared on session unregister**, alongside the sibling per-session maps in `event-wiring.ts`. Two consequences this pins down:

- A reaped-and-re-registered session is **not** permanently silenced for a name it rejected in a previous life.
- The set cannot leak one string per (ended session × rejected change) for the server's uptime. Note the sibling maps (`replayingSessions`, `stampedLiveEpoch`, `lastActivityBroadcastAt`) are *not* currently pruned on end; do not copy that pattern — add the cleanup.

In-memory only; a server restart may re-emit once, which is acceptable.

## Risks / Trade-offs

- **[R-COLD — the gate does not run on a cold cache, or before worktree state resolves]** D6 answers *allow* for an uninitialized cache, and D8 answers *allow* while the session is worktree-unresolved. So on server startup, for every newly-seen directory, and for the first git-info interval of a **git-repo** session, a slug-shaped foreign name still attaches. Stated plainly because these are the residual bypasses and the Goals are scoped around them: **the locality invariant holds only once the cache is initialized AND worktree state has resolved.** → Accepted deliberately, not solved: failing closed on either axis breaks legitimate attaches routinely. The cache window is bounded by the first successful poll of that directory. The worktree window is bounded by the first `git_info_update` tick **for git-repo sessions only** — a non-git session never receives one, which is precisely why D8 admits `isGitRepo === false` as a second resolution path; without it that window would never close.
- **[Poll-cache lag on a local create]** `openspec new change <name>` in the session's own repo is rejected until the next poll, because the initialized cache does not yet list it → D4a suppresses the misleading notice for creation-type detections. Recovery requires **both** the next poll **and** a subsequent openspec-patterned tool event to re-fire detection — "one poll cycle" is the lower bound, not a guarantee; if the agent's next actions are unrelated tool calls the attach is delayed further. Do **not** trigger a fresh poll from this path — it is a hot event handler. This is the change's sharpest trade-off; if the window proves painful the fix is a shorter poll interval or targeted invalidation, not a weaker gate.
- **[R-COLLISION — existence proves locality, not identity]** The gate tests `changes.some(c => c.name === changeName)`. It proves a slug exists locally; it cannot prove the detected activity referred to the *local* one. Two repos both containing `add-auth` (human-chosen slugs collide routinely): a session in `/repo-a` that touches `/repo-b`'s `add-auth` and evades D3 would attach to `/repo-a`'s unrelated `add-auth` — satisfying the invariant literally while defeating its intent → Mitigated only by D3's path containment, which is the sole identity-bearing check. Not fully solvable without threading the matched path through to the gate; accepted, and recorded so nobody reads D1 as stronger than it is.
- **[R-EVADE — the `cd` scan is defeatable]** D3's guard is a regex over a command string; subshells `(cd /repo-b; openspec new change x)`, `eval`, `bash -c`, `$PWD`/variable targets, and symlinked segments all evade it → By design D3 is defence in depth, never the load-bearing guard; D1 is. This is why the corresponding Goal is stated at *system* level, not detector level.
- **[Fresh worktree window]** A worktree session before its first `git_info_update` has no `mainPath` → D8's explicit `gitWorktreeReported` flag makes the gate allow during that window rather than falsely rejecting. The flag MUST be set on *every* bridge report including the cleared-`null` case; if it is set only when a `GitWorktreeInfo` object arrives, non-worktree sessions never become reject-capable and the gate silently degrades to a no-op for them — the exact failure this decision replaced. Cover that case with a test, not a comment.
- **[Lost auto-detection for outside-`cd` workflows]** A session that `cd`s **outside** its repo before invoking `openspec` loses CLI-based detection under D3's conservative rule → D1 still permits the attach via other detection paths (path reads, skill reads); the failure mode is "no inference", never "wrong inference". A `cd` *within* the repo is unaffected — D3 suppresses only on an outside target.
- **[Shared-package signature change]** `detectOpenSpecActivity` has exactly **one** production consumer (`event-wiring.ts`), but its test suite lives in a *different* package (`packages/extension/src/__tests__/openspec-activity-detector.test.ts`), so the required-parameter change still crosses a package boundary → Make `cwd` a **required** parameter so TypeScript fails closed at every call site. Every existing detector test needs a `cwd` fixture; note the fixtures use absolute paths like `/Users/dev/project/...`, and on a case-insensitive filesystem a mismatched fixture/cwd pair can silently flip a test's meaning — assert the expected outcome, not merely "no throw".
- **[Notice noise]** Even deduped, a genuinely cross-repo agent gets a notice it cannot act on → `level: "info"`, non-blocking, one per change name, and suppressed entirely for creation-type detections per D4a.
- **[Regression surface]** Under D6 an unstubbed cache reads as *unknown* → *allow*, so existing auto-attach tests (e.g. `auto-attach-slug-defense.test.ts`, which stubs no `getOpenSpecData`) keep passing unchanged. The real work is **new reject-path coverage**, not retrofitting stubs onto old tests. Treat a test that must be weakened to pass as a signal to re-read the gate, not to loosen it.

## Migration Plan

1. Relocate `isPathInside` from `packages/server/src/session/active-sessions-in-cwd.ts` into `packages/shared`, re-pointing its existing server callers. Behaviour-preserving move; the `cwd-session-containment` scenarios must still pass unchanged.
2. Land the shared detector signature change and update all call sites in the same commit (required parameter — no staged rollout possible), including the cross-package test suite in `packages/extension`.
3. Land the server gates (D1/D2/D6/D7/D8), the branch-4 bypass widening (D9), and the notify emission (D4/D4a/D5).
4. Rebuild path: `packages/shared` + `packages/server` → `curl -X POST http://localhost:8000/api/restart` (jiti, no build step). The `packages/extension` change is test-only, so no `npm run reload` is required.
5. No data migration. No schema change. Sessions already carrying a foreign attachment are unaffected and keep it until manually detached via `POST /api/session/:id/detach-proposal`.
6. Rollback: revert the commits and restart. No persisted state is written by this change beyond ordinary `notifyLog` entries, which are harmless if orphaned.

## Open Questions

> Two questions raised during drafting were resolved by direct verification against the running system and are now decisions D6 (cache tri-state) and D7 (worktree main path). The worktree case was a genuine false-rejection that would otherwise have shipped.

- **OpenSpec stores.** `openspec status` reports a `planningHome` that may be a registered store rather than the repo root, and `openspec --store <id>` targets standalone repos. If a session legitimately works against a store outside its `cwd`, D1 rejects it. `openspec store list` is currently empty on this machine, so this is unreachable today — but the gate should probably consult the resolved planning home rather than raw `cwd` when stores are in play. Deferred; flag if store usage lands first.
- Should a rejected detection also be recorded for diagnostics (server log line) independent of the user-facing notice? Cheap to add, useful when triaging "why did my session not attach".
