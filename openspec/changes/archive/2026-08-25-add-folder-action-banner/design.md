## Context

Change 3 of the four-way directory-card split (`openspec/changes/archive/2026-08-09-add-folder-actions-menu/design.md`, decisions D4–D7). Change 1 landed the folder actions menu and explicitly left `FolderActionBar` in place; this change is what empties and deletes it.

Current state, verified in source:

- **`GET /api/git/worktree/init-status`** (`packages/server/src/routes/git-routes.ts:344-376`) returns one of four shapes: `{hasHook:false, configured:false}` (no reachable config root), `{hasHook:false, configured:<exists>}` where `configured` is literally `fs.existsSync(join(configRoot, ".pi", "settings.json"))`, `{hasHook:true, trusted:false}` (TOFU — the repo's `gate` bash is deliberately *not* executed until trusted), or `{hasHook:true, needsInit, trusted:true}`.
- **`configured` is only ever computed when `hasHook === false`.** A repo that declares a `worktreeInit` hook never reports setup state at all.
- The client fail-open path (`git-api.ts:253-261`) returns `{hasHook:false}` with `configured` **absent**, and `ProjectInitButton` gates on `configured === false` strictly — absent means "render nothing". Fail-open is already the established convention; this change must preserve it.
- **`hookDefHash` / `isTrusted`** (`worktree-init-trust.ts`) key trust on `repoRoot + sha256(canonical(worktreeInit))`. A hook edit revokes trust, and the endpoint then reports `{hasHook:true, trusted:false}` *without* evaluating the gate.
- The call-to-action controls today live inline on the git row: `ProjectInitButton`, `WorktreeInitButton`, the init chip, and `Clean up broken (N)` in `FolderActionBar.tsx`.

**The decisive fact for D5**: the `project-init` skill's scaffold set is **profile- and choice-dependent**. Both shipped profiles (`coding`, `docs`) write `AGENTS.md`, `.pi/settings.json` and `prompts/*`. Everything else is an interactive opt-in — DOX is asked on every profile (`profile.json#dox` only sets the default), OpenSpec init runs only when `OPENSPEC_INIT`, and the KB is optional. There is no single artifact list a `stat` can check.

## Goals / Non-Goals

**Goals:**

- One full-width tier-0 banner owns every directory-card call to action; the git row becomes facts-only.
- Project setup becomes re-runnable on a partially-configured directory — the state today's spec declares unreachable.
- Separate the *security* question (hook trust revoked) from the *freshness* question (templates moved on) with two different surfaces.
- Delete `FolderActionBar`.

**Non-Goals:**

- Template-drift **detection** (D7). This change declares `setupOutdated?: boolean` and renders its badge; nothing emits it yet.
- Changing hook gating semantics (`needsInit`, TOFU, gate caching) — only where its UI renders.
- Any status-capsule or slot-pill work.
- Making the banner configurable/dismissible.

## Decisions

### D-A: `configured: boolean` → a per-artifact checklist, with exactly ONE required artifact

The wire shape becomes a list of `{ id, present, required }` entries. The decisive question is what `required` means, because `required` is what makes a banner appear.

**Required = `.pi/settings.json`, and nothing else.** Every other artifact — `AGENTS.md`, `.pi/prompts/*`, `openspec/`, the DOX seed, the KB config — is **optional**: present in the tally, never in the banner.

**This deviates from archived D5**, which specified a three-state banner including a partial "Setup incomplete · 3/5" rung. That rung cannot survive this change's own invariant 2 (*tier 0 means the folder cannot proceed*). Two counterexamples kill it:

- A repo with `.pi/settings.json`, a trusted hook and running sessions but no `AGENTS.md` — common in projects that adopted pi before `AGENTS.md` existed, or that keep docs elsewhere — is *demonstrably proceeding*, yet would carry a permanent tier-0 banner with a `Complete →` action that re-runs the whole interactive interview to add one file.
- A `docs`-profile project that correctly declined OpenSpec would read "incomplete" forever, with an action that can only re-offer what the user already refused.

An earlier draft of this decision claimed a "profile-invariant core" of `AGENTS.md` + `.pi/settings.json` eliminated that class. It does not — it only shrinks it, and the first counterexample above sits squarely inside the surviving set. `.pi/settings.json` is the only artifact whose absence genuinely means "this is not a pi project and pi cannot act here".

Consequence, stated plainly: **the banner has exactly two setup states — "not a pi project yet" or nothing.** "Setup incomplete" becomes a menu-only state carried by the `n/N` tally, which is informational and never escalates. This is a smaller feature than D5 described, and a correct one.

*Alternative rejected:* persist the chosen profile at init time and check its specific artifact set. Better fidelity, but it needs a new persisted per-directory record — exactly the infrastructure D7 pushes out of scope — and it would report nothing for every directory configured before the record existed.

### D-A2: The checklist is stat'ed at `configRoot`, not at `cwd`

`resolveConfigRoot` (`git-operations.ts:909`) returns `resolveMainPath(cwd)` for **any** git repo — so for a worktree row the config root is the *main* checkout, not the row's own directory. A non-git directory resolves to itself only if it already has `.pi/settings.json`, with no upward walk.

The checklist therefore stats at `configRoot`, matching the existing `configured` computation exactly (`git-routes.ts:364`). Stating this is load-bearing: an implementer who stats at `cwd` gives every worktree row a permanent "not a pi project" banner, because a worktree does not carry its own `.pi/settings.json`.

When `configRoot` is `null` (non-git directory with no settings), the checklist reports zero present — the genuine "not a pi project" case.

### D-B: The checklist is computed for **every** state, including `hasHook: true`

Today `configured` is skipped whenever a hook exists. Keeping that would make a hook-declaring repo unable to report a missing `AGENTS.md`. The checklist is therefore computed unconditionally, and `hasHook`/`needsInit`/`trusted` remain orthogonal to it. This is a widening of what the endpoint does per call — see the perf note in Risks.

### D-C: Banner precedence is a fixed severity ladder, and at most one banner renders

`init failure > hook re-trust > init needed > not a pi project`

One banner per directory. Rationale: tier 0 means "cannot proceed", and stacking two blocking claims on one card defeats the purpose of promoting them out of the git row. Failure outranks re-trust because a failed run already happened to the user; re-trust outranks a plain init-needed because it blocks the hook from running at all.

**`Clean up broken (N)` is NOT in the ladder — it leaves tier 0 entirely.** This deviates from archived D4, which moved it into the banner alongside the init controls. Broken sessions are ended sessions whose cwd is gone: housekeeping. The folder is not blocked, so by invariant 2 it does not belong in tier 0 — and ranking it above a genuinely blocking rung (as an earlier draft did) would let a non-blocking state pre-empt a blocking one. It becomes an item in the folder actions menu's existing `DIRECTORY` group.

The menu placement deliberately uses a group change 1 already shipped, so this change does not depend on change 4's `MAINTENANCE` group landing first.

*Alternative rejected:* render all qualifying banners stacked — reintroduces the vertical-cost problem D6's demotion was designed to solve. *Alternative rejected:* keep cleanup in the banner at the bottom of the ladder — preserves D4's letter while breaking invariant 2, which is the rule D4 itself was written to serve.

### D-D: Fail-open is inherited verbatim, and extended to the checklist

A probe error reports the checklist as **unknown**, not as all-absent, and an unknown checklist renders **no banner**. This mirrors `git-api.ts`'s existing fail-open and `ProjectInitButton`'s strict `=== false` gate. The rule to preserve: *the absence of information never renders a blocking claim.* A stale client that cannot interpret a new payload must also degrade to no banner.

During the transitional step where both `configured` and the checklist ship, **the checklist wins whenever it is present**; `configured` is consulted only in its absence. Without that precedence rule the two sources can disagree mid-migration and the banner flickers between states.

### D-D2: The banner renders only on project-root rows

A row whose directory is neither a git root nor an explicitly pinned/workspace-added directory SHALL NOT get a "not a pi project" banner. Today an arbitrary non-git scratch directory renders a small inline button in that state; promoting the same false positive to a full-width tier-0 surface amplifies a defect rather than fixing one. The inline control's tolerance for a weak signal does not transfer to tier 0.

### D-E: Two surfaces for two different questions (D6)

| Question | Mechanism | Surface |
|---|---|---|
| Does the hook need running? | the project's own `gate` bash, `needsInit` | banner action |
| Is the hook still trusted? | `hookDefHash` TOFU | **banner**, `--severity-warning-*`, `[Review…]` |
| Are setup files current with the templates? | nothing yet (D7) | **menu badge only**, never a banner |

Trust revocation is blocking *and* carries a security decision, so it earns tier 0. Template drift is optional, non-blocking, and would fire on **every folder simultaneously** after a pi upgrade — precisely the flood that would make tier 0 worthless. Keeping it out of tier 0 is also what resolves the vertical-cost risk the archived plan left open.

### D-F: Banner placement is defined for both card shapes

Below the git row when one exists; directly below the folder header row when it does not. The archived plan flagged this as an open question ("one element, two visual positions"); it is resolved by anchoring to *the bottom of the identity block* rather than to the git row specifically.

### D-G: Colours and glyphs come from existing systems

Banner surfaces use `--severity-{info,warning,error}-{bg,fg,border}`, which `index.css` designates the colour source of truth **for banner surfaces** — this is the one place the severity family is correct (unlike the status capsule, which needed `--status-*`). No new token.

Glyphs: project setup `mdiTextBoxCheckOutline` (replacing `mdiFolderPlusOutline`, which read as "add a folder" beside the card's own `mdiFolderOpen`), run init hook `mdiScriptTextPlayOutline` (replacing `mdiCogPlayOutline`, which collided with `mdiCog`), init failed `mdiAlertCircleOutline`, cleanup `mdiBroom`. Per D8's correction, distinctness is verified against **what the rendered card shows**, not against a repo-wide glyph inventory.

## Risks / Trade-offs

- **[A wrong `required` list turns every quiet folder into a permanent banner]** → Mitigated by D-A's profile-invariant core and by gating the banner on required-only. This is the change's highest-stakes decision; it gets its own verification task.
- **[Breaking wire change: `configured` → checklist]** → Client and server ship together. Mitigated by D-D: a client that cannot interpret the payload renders no banner, so the failure mode is a missing prompt, never a false one.
- **[D-B widens the probe: a `stat` set now runs on every init-status call, including hook-declaring repos]** → Accepted; it is a handful of `existsSync` calls against paths already resolved by `resolveConfigRoot`. The probe fires per mount and per explicit refetch (`useInitStatus`), not on a timer — so the multiplier is visible-folder count, not a polling rate. Note the **caching asymmetry** this introduces: `evaluateGateCached` caches the gate result, while the checklist re-stats on every fetch. Reusing the gate's cache key is **wrong**: `gateCache` is written only inside `evaluateGateCached`, which runs only on the trusted-hook branch, and is invalidated only by `POST /api/git/worktree/init`. A no-hook directory is exactly the case that raises a setup banner, so it would never gain an entry nor ever be invalidated. A *dedicated* checklist cache is rejected as well: its only correct invalidation trigger is "a project-init session completed in this directory", and `SessionManager` (`memory-session-manager.ts`) emits no lifecycle event to subscribe to — inventing one is cross-cutting work this change does not scope. **The checklist is therefore uncached**, which is also the simplest thing that is correct.
- **[Tier-0 vertical cost]** → Mitigated by D-E (drift demoted out of tier 0), D-A (required-only gating) and D-C (one banner per card). If it still bites, cap at one banner + "+N more" — recorded, not implemented.
- **[Deleting `FolderActionBar` while `folder-action-bar` the *spec* survives]** → The spec capability also carries the `+Session` / `+Worktree` / elevated-spawn requirements, which physically live in `folder-action-bar/spec.md` and have no other home. Only its two Initialize requirements are removed; the capability is **not** retired. The proposal must not say "removed entirely".
- **[`WorktreeInitButton` has no stated fate]** → It is **re-hosted inside the banner**, not deleted: it owns the trust-confirm dialog and the run call. Only `ProjectInitButton` and `FolderActionBar` are deleted. Left ambiguous, it becomes an unrendered orphan.
- **[Glyph distinctness is asserted, not demonstrated]** → D-G claims verification against the rendered card but shows no inventory. `mdiAlertCircleOutline` in particular is a high-collision glyph. The enumeration is a task, not a claim.

## Migration Plan

1. Server: compute the checklist unconditionally; keep emitting `configured` alongside it for one step so nothing breaks mid-migration.
2. Client: consume the checklist; build the banner; route the existing init progress/failure feedback into it.
3. Move `Clean up broken` into the folder actions menu's `DIRECTORY` group; re-host `WorktreeInitButton` in the banner; delete `FolderActionBar` and `ProjectInitButton`.
4. Keep emitting `configured` for the whole of this change, marked deprecated. Dropping it is a **follow-up**, not a step here — the transitional-precedence rule (checklist wins) must describe a state that actually ships, or it is untestable.
5. CHANGELOG the payload change and the deprecation.

Rollback: revert. No persisted state is written, no migration to undo. A rolled-back client sees `configured` again only if step 4 has not shipped — which is why step 4 is last and separate.

## Open Questions

1. **What does the banner show while an init run is in flight?** D-C's ladder covers terminal states, but "running" is not a rung. Leaning: running replaces the banner's content in place rather than being a separate rung, so a run started from the banner does not make the banner jump.
2. **Does the `n/N` menu tally need a breakdown on hover?** With the banner reduced to a binary, the tally is now the only surface for partial setup. A bare `3/5` may not be actionable without naming what is missing.

Resolved since the first draft: prompt files are **optional**, not required (D-A reduced the required set to one artifact, so the question of how to stat a profile-specific prompt set no longer gates a banner). The `Complete →` action is likewise gone — with no partial banner there is nothing for it to complete, which also retires the concern that it would re-run the entire interactive interview to add one file.
