## Why

OpenSpec readiness is gated on **two different signals by two different surfaces**, so a
whole class of broken projects renders live, non-functional controls:

```
SessionCard.tsx:969     hasOpenspecDir || pending    → show OPENSPEC subcard (live buttons)
SessionList.tsx:1289    initialized    || pending    → show FolderOpenSpecSection
```

Four defects follow:

1. **A partially-initialized project renders live, dead buttons.** When `<cwd>/openspec/`
   exists but `openspec list` fails or `openspec/changes/` is absent, the session card shows
   the full OPENSPEC subcard — Explore / Propose / Archive — while the folder card renders
   nothing (`FolderOpenSpecSection.tsx:44` → `return null`). The buttons dispatch
   `/skill:openspec-explore` (`SessionOpenSpecActions.tsx:311`) into a project that has no
   such skill.

2. **A *valid* OpenSpec project can still have dead buttons, and no signal sees it.**
   `openspec init --tools none` produces a valid `openspec/` — `initialized: true`,
   `openspec list --json` exits 0 — with **zero** `.pi/skills/openspec-*`. Only `--tools pi`
   writes them. Neither `hasOpenspecDir` nor `initialized` distinguishes this.

3. **Readiness is only visible in Settings.** `GET /api/openspec/update-status`
   (`openspec-routes.ts:248`) classifies each known cwd, but is fetched once, on mount, inside
   `OpenSpecProfileSection`. It never reaches the surfaces where the user works.

4. **A directory with no OpenSpec at all is silently hidden.** With OpenSpec globally enabled
   and a profile configured, a directory that never ran `openspec init` renders no affordance
   anywhere — the feature is on, configured, and invisible. The dual problem: not every
   project wants OpenSpec, and there is no way to say so. `openspec.enabled` (`config.ts:117`)
   is a **single global boolean**.

**Verified de-risking finding.** `openspec init` creates `openspec/changes/` and
`changes/archive/`, and `openspec list --json` on a zero-proposal project exits 0 with
`{"changes": []}`. A healthy fresh init is therefore already `initialized: true`, so
`hasOpenspecDir && !initialized && !pending` is **never healthy** — the broken state is fully
determined by signals the server already computes.

## What Changes

- **One server-derived readiness state replaces two ad-hoc client gates.** The server folds
  every input — it already holds all of them, including the signature store that drives
  staleness — and emits `readiness: { state, reason }` on `OpenSpecData`. Clients render; they
  do not derive.

  | state | condition | folder card | session card OPENSPEC subcard |
  |---|---|---|---|
  | `GLOBAL_OFF` | `openspec.enabled === false` | nothing | hidden |
  | `OPTED_OUT` | cwd in `openspec.optOutDirectories` | nothing (re-enable in `⋯` menu) | hidden |
  | `PENDING` | poll in flight | existing spinner | existing placeholder |
  | `ABSENT` | no `<cwd>/openspec/` | `OpenSpec — not set up  [Initialize] [×]` | **hidden** |
  | `BROKEN` | `hasOpenspecDir && !initialized` | warn + `[Repair…]` | **disabled** + reason |
  | `STALE` | missing skills, or signature ≠ current | warn + `[Update]` | **disabled** + reason |
  | `READY` | otherwise | `OpenSpec (N) →` | live |

- **`ABSENT` stops being hidden.** It renders an Initialize call-to-action, because a
  configured-but-invisible feature communicates nothing. Two escapes make that acceptable:
  a per-directory `[×]`, and a global "stop offering" flag for users who never want the offer.

- **`openspec.optOutDirectories: string[]`** — a flat per-cwd opt-out list on the existing
  `OpenSpecPollConfig`. Keys normalized with the same helper pinned directories use
  (`session-group-path.ts` `pathKey`).

- **`openspec.offerInitialization: boolean`** (default `true`) — the fleet-level escape.
  When `false`, `ABSENT` renders nothing anywhere while `BROKEN`/`STALE`/`READY` keep working.
  Distinct from `openspec.enabled`, which disables the feature entirely.

- **New `POST /api/openspec/init`.** Runs the resolved OpenSpec CLI and forces a poll refresh.
  The argv is **exactly**:

  ```
  <resolved-cli> init <cwd> --tools pi --force
  ```

  - `--tools pi` writes `.pi/skills/openspec-*` + `.pi/prompts/opsx-*.md`. **Omitting it
    reproduces defect 2.**
  - `--tools` + `--force` are together sufficient for non-interactivity on the pinned CLI.
  - **No `--profile` flag.** The CLI validates `--profile` to `core|custom` only
    (`dist/core/init.js:150`), while the dashboard's profile may be the alias `"expanded"`.
    Instead the handler calls `healExpandedProfileConfig(cwd)` first — exactly as
    `/api/openspec/update` does (`openspec-routes.ts:230`) — and lets init read the healed
    global config.
  - **No `--no-animation` / `--no-copilot-cloud`.** Those flags **do not exist** in the pinned
    `@fission-ai/openspec@1.6.0` (`dist/cli/index.js:101-104` registers only `--tools`,
    `--force`, `--profile`); commander is strict, so passing them fails every call. They exist
    in 1.8.0 but are cosmetic/no-op there, so omitting them is correct on both versions.
  - The binary MUST be resolved via the tool-registry resolver
    (`packages/shared/src/tool-registry/definitions.ts`) and **never** invoked as bare
    `openspec`, which resolves to a squatted `0.0.0` stub (`fix-worktree-opsx-skills-not-created`).

- **A new known-directory validation set.** `knownCwds()` (`openspec-routes.ts:149`) filters to
  `hasOpenSpecRoot(cwd)` — initialized projects only — so it **excludes exactly the
  directories init exists to target.** Init validates against `union(session cwds, pinned
  dirs)` *without* that filter. `/api/openspec/update` currently validates nothing at all
  (`openspec-routes.ts:223` takes `body.cwd` verbatim); init does not inherit that gap.

- **Init records the update signature.** `setOpenSpecUpdateSignature` is today called only in
  the update handler, so a freshly-initialized project reports `unknown` forever. Init records
  it, mirroring update.

- **`unknown` is no longer a stale trigger.** `unknown` means never-measured, not out-of-date.
  Only `needs-update` (a recorded signature that differs) marks `STALE`. Belt-and-braces with
  the signature write above: either fix alone would prevent a successful Initialize from
  immediately presenting as `STALE`.

- **Worktrees are exempt from the missing-skills trigger.** `.pi/skills/openspec-*` is
  gitignored (`.pi/.gitignore`), so it never checks out into a worktree even when the main
  checkout is healthy. A worktree cwd SHALL NOT be marked `STALE` for missing skills alone.

- **Folder actions menu gains re-enable** for an opted-out directory.

### Out of scope

- Repairing from the session card — every non-READY state routes to the folder card.
- Per-cwd workflow *profiles*. Enablement is per-cwd; the profile stays global.
- Auto-initialization. Initialization is always explicit.
- Fixing the missing cwd validation on the pre-existing `/api/openspec/update`. Noted, not
  touched — it predates this change.

## Capabilities

### New Capabilities

- `openspec-readiness`: the server-derived per-cwd readiness state machine — its inputs
  (including the new `hasOpenSpecSkills` stat), the seven states with precedence, the
  `optOutDirectories` / `offerInitialization` config, and `POST /api/openspec/init` with its
  exact argv and validation set.

### Modified Capabilities

- `openspec-folder-section`: the `!initialized → return null` gate is replaced by
  readiness-driven variants; `ABSENT`, `BROKEN`, `STALE` each render a one-line pill with the
  action that resolves them.
- `session-card-subcards`: the OPENSPEC subcard gates on `readiness.state` and gains a
  **disabled** render path whose single control targets the surface that can actually
  remediate the reported reason.
- `openspec-profile-config`: init records a signature; `unknown` is not stale.
- `folder-actions-menu`: the `DIRECTORY` group gains a conditional "Enable OpenSpec for this
  folder" item while the cwd is opted out.

## Discipline Skills

- `security-hardening` — `POST /api/openspec/init` spawns a CLI that **writes into the user's
  repository** at a caller-supplied path, with `--force` (auto-cleans legacy files). Review
  targets: the validation set, argv-as-array, `--force` blast radius on both the Initialize
  and Repair paths, and concurrent-invocation guarding.
- `scenario-design` — the seven-state matrix crossed with opt-out, global-off, fleet-off,
  worktree exemption, and the init-failure paths.
- `doubt-driven-review` — applied; five critical defects found and corrected pre-commit.
  Re-applied after this revision.
- `review-code` — client + server + shared config change before commit.

## Impact

- **Code**:
  - `packages/shared/src/config.ts` — `optOutDirectories`, `offerInitialization` + parsing
  - `packages/shared/src/types.ts` — `OpenSpecData.hasOpenSpecSkills`, `OpenSpecData.readiness`
  - `packages/server/src/directory-service.ts` — skills stat, readiness fold, opt-out gate
  - `packages/server/src/routes/openspec-routes.ts` — `POST /api/openspec/init`, new validation
    set, signature-on-init, `unknown` semantics
  - `packages/client/src/components/openspec/FolderOpenSpecSection.tsx` — non-ready variants
  - `packages/client/src/components/session/SessionCard.tsx` — gate + disabled path
  - `SessionList.tsx:1289`, `ComposerSessionActions.tsx:221` — gate consumers
- **Wire**: `OpenSpecData` gains two optional fields — additive. A stale client ignores them
  and behaves exactly as today; a new client against an old server sees `readiness:
  undefined` and MUST fall back to today's gate, never to a false disabled state.
- **Config**: both new keys are additive with safe defaults.
- **Performance**: readiness is folded in the existing poll pass, so no new client fetch and
  no new endpoint load. This is strictly cheaper than surfacing update-status to every card.
- **A11y**: the disabled subcard is *inert* — controls removed from the tab order, reason as
  visible text rather than a `title`.
- **Known risk — nag wall.** Mitigated by the compact one-line pill, per-folder `[×]`, and the
  global `offerInitialization: false`.
- **Known risk — `--force`.** Applies to Initialize *and* Repair. Repair requires a confirm
  dialog naming the directory; Initialize requires a confirm when the target already contains
  legacy OpenSpec files.
- **Known risk — concurrent init.** Two simultaneous calls would race the CLI's cleanup and
  template copy. The endpoint serializes per cwd.
- **Known risk — invisible server-side writes.** Init mutates the repo with no transcript. The
  endpoint returns stdout/stderr and the client surfaces it.
- **Known risk — CLI version drift.** The argv is valid on the pinned 1.6.0 and on 1.8.0, but
  the change carries a startup-verifiable minimum-version assumption.
- **Risk**: medium-high. New config keys, a server-side CLI spawn into user repositories, and
  a change to the first thing a user sees on every unconfigured directory.
