# Design — add-openspec-init-affordances

## Context

Two surfaces, two gates, one middle state that falls between them. Four empirical findings
ground every decision below. **F3 in the first draft of this document was wrong** — it was
verified against `npx @fission-ai/openspec@latest` (1.8.0) rather than the version the
tool-registry resolver actually resolves (the pinned `node_modules` copy, **1.6.0**). That
error propagated into a mandated argv that would have failed on every call. It was caught by
adversarial review before commit; the findings below are re-verified against the pinned CLI.

**F1 — a healthy zero-proposal project is already `initialized: true`.**

```
$ openspec init . --tools none --force
$ find .
./openspec/specs  ./openspec/changes  ./openspec/changes/archive  ./openspec/config.yaml
$ openspec list --json
{ "changes": [], "root": { ... } }        # exit 0
```

`directory-service.ts:499` short-circuits to `initialized: false` only when
`openspec/changes/` is absent, and init creates it. So
`hasOpenspecDir && !initialized && !pending` is structurally impossible for a healthy project
— a sound, already-computed signal for `BROKEN`.

**F2 — `--tools pi` is the difference between working and dead buttons.** It writes
`.pi/skills/openspec-*/SKILL.md` and `.pi/prompts/opsx-*.md`.
`SessionOpenSpecActions.tsx:311` dispatches `/skill:openspec-explore`; with `--tools none` the
project is valid and every button is inert. No current signal sees this.

**F3 (corrected) — the pinned CLI accepts only three init flags.**
`node_modules/@fission-ai/openspec` is **1.6.0**. `dist/cli/index.js:101-104` registers
exactly `--tools <tools>`, `--force`, `--profile <profile>` — grep for `no-animation` and
`no-copilot-cloud` returns **0 hits**, and commander is strict, so passing them errors.
`--tools` + `--force` are together sufficient for non-interactivity. Both flags also exist in
1.8.0 but are cosmetic there, so the minimal argv is correct on both.

**F3b — `--profile` cannot carry this dashboard's profile value.** `dist/core/init.js:150`
throws `Invalid profile "X". Available profiles: core, custom`. The dashboard's profile may be
the alias `"expanded"`, which the repo persists as `custom` + the expanded workflow set
(`openspec-routes.ts:202`, `fix-openspec-expanded-profile-update`). Passing
`--profile expanded` hard-fails.

**F4 — bare `openspec` on PATH is a trap.** `tool-registry/definitions.ts` exists because bare
`openspec` resolves to a squatted `0.0.0` stub that initializes nothing.

## Goals / Non-Goals

**Goals**
- One readiness derivation, consumed by every surface. No surface invents its own gate again.
- Every non-READY state is visible and carries the one action that resolves it.
- A user can decline OpenSpec per-directory and fleet-wide.
- A subcard whose buttons cannot work never renders as if they can.

**Non-Goals**
- Repairing from the session card. The session card reports; the folder card acts.
- Per-cwd workflow profiles.
- Auto-init.
- Fixing the pre-existing missing validation on `/api/openspec/update`.

## Decisions

### D1 (revised) — Readiness is derived server-side; clients render `state` + `reason`

The first draft derived readiness client-side, arguing that a server-side fold would couple
the config stream to the `openspec_update` broadcast stream. Adversarial review disproved
that, and re-examination confirms it: **the server already holds every input.**

| input | server-side source |
|---|---|
| `openspec.enabled`, `optOutDirectories`, `offerInitialization` | dashboard config |
| `hasOpenspecDir`, `initialized`, `pending` | `directory-service.ts` poll |
| `hasOpenSpecSkills` | new stat, same pass |
| staleness | `preferencesStore` signature vs `currentGlobalSignature` |

**Correction after cycle-2 review.** The row above overstated one input. `directory-service.ts`
receives `preferencesStore` (line 286) and so holds the *recorded* signature, but the *current*
signature comes from `currentGlobalSignature`, a **closure-local** function at
`openspec-routes.ts:165` that spawns `openspec config list`. `directory-service` has no access
to it and never spawns that command. The claim "the server already holds every input" was false
for staleness.

It remains fixable, and cheaply, because **the current signature is global** — identical for
every cwd, which is why the update-status route already computes it once per request rather
than per cwd. So:

- A shared global-signature provider SHALL be extracted from the routes closure and injected
  into `directory-service`.
- It SHALL be computed **once per poll tick**, not once per cwd, and cached for the tick.
- The cache SHALL be invalidated on a global profile save and after any `init`/`update`.

This is real, named infrastructure rather than a free fold. It is still cheaper than the
client-side alternative — one spawn per tick versus a REST endpoint that walks every known cwd
behind constantly-rendering folder cards — but the first draft's "no new load" claim was wrong
and is withdrawn.

`OpenSpecData` gains `readiness: { state, reason }`. Clients switch on it.

**Cost accepted — broadcast granularity.** `reconfigurePolling` (`directory-service.ts:1088`,
sole call site `system-routes.ts:270`) takes the **whole** `OpenSpecPollConfig` and, on the
`enabled true→false` edge, already iterates every cache. There is no per-cwd path today, so the
first draft's "re-broadcast only the affected cwd" was hand-waving. What ships instead:

- `reconfigurePolling` SHALL diff the readiness-affecting keys (`enabled`,
  `optOutDirectories`, `offerInitialization`) against the previous config and re-broadcast
  **only** when one of them changed — so poll-tuning writes (interval, concurrency, jitter) do
  not trigger a readiness storm.
- An `optOutDirectories` add/remove SHALL re-broadcast only the cwds whose membership changed.
- `enabled` and `offerInitialization` are global by nature; flipping either re-broadcasts every
  cached cwd, which is what the existing `enabled` edge already does.

### D2 (revised) — `hasOpenSpecSkills` is a server stat, with a worktree exemption

One `stat` of `<cwd>/.pi/skills/openspec-explore/`, in the pass that already stats
`<cwd>/openspec/` (`directory-service.ts:494`). It answers "will `/skill:openspec-explore`
resolve" directly, where update-status only answers "did the dashboard run an update".

**Worktree resolution (was an open question; settled after cycle-2 review).** `.pi/.gitignore`
contains `skills/openspec-*/**`, so those skills are **gitignored** and never check out into a
worktree, even when the main checkout is healthy. Statting at the worktree cwd would mark every
worktree `STALE` and disable every worktree session card.

The first draft's answer — "stat at cwd, exempt worktrees from the missing-skills trigger" —
was **unimplementable as written**: `directory-service.ts` has no worktree awareness at all
(its only git imports are `folder-head-poll`, `folder-head-watcher` and the `HeadInfo` type),
and the draft rejected the one helper that could answer the question without naming a
replacement. An exemption with no way to detect the exempt case is not a design.

Chosen: **stat at `resolveConfigRoot(cwd)`** (`git-operations.ts:843`) — the convention
`add-folder-action-banner` established (D-A2) for precisely this class of bug, where a tracked
artifact resolves per-worktree but an ignored one does not. No exemption rule is then needed:
a worktree resolves to its main checkout and inherits its skills answer.

**Trade-off, stated plainly:** this reports a capability the worktree does not literally have.
Pi resolves `/skill:` from the session cwd, so a worktree whose own `.pi/skills/` is empty will
still fail to expand `openspec-explore` even though readiness says `READY`. The worktree
bootstrap flow is supposed to run `openspec init` inside the worktree (see
`fix-worktree-opsx-skills-not-created`), so a correctly-bootstrapped worktree has its own
skills; this resolution masks only the incorrectly-bootstrapped case. Accepted because the
alternative — every worktree permanently `STALE` — is worse and far more common.

### D3 — `ABSENT` renders an offer, inverting today's hide

Hiding is correct for a user who does not want OpenSpec and wrong for one who enabled it
globally and set a profile. The current design cannot tell them apart because it never asked.
The offer plus its escapes **is** the question, asked once.

**Placement:** the same compact one-line pill the READY state uses — not a banner.
`add-folder-action-banner` established that a banner means *the folder cannot proceed*
(tier-0); a directory without OpenSpec proceeds fine. *Fragility noted:* that sibling change
is not yet archived, so this anchor could move.

**Two escapes, because one was insufficient.** The per-folder `[×]` does not help a user with
twenty OpenSpec-less directories — it requires twenty dismissals. So a fleet-level
`openspec.offerInitialization: false` suppresses every `ABSENT` offer at once while leaving
`BROKEN`/`STALE`/`READY` fully functional. This is deliberately *not* `openspec.enabled`,
which disables the feature outright.

### D4 (revised) — A flat `openspec.optOutDirectories: string[]`, not a generic namespace

The first draft chose `directories: Record<cwd, { openspec?: boolean }>`, justified by
tri-state (absent = inherit) and by future reuse.

**That justification was false under this change's own spec.** The sibling requirement stated
that a per-directory `true` cannot defeat the global master gate — which makes `true`
behaviourally identical to absent, collapsing the tri-state to exactly the two values a
`string[]` encodes. The generality was speculative for the one plugin it served.

Chosen: `openspec.optOutDirectories: string[]` on the existing `OpenSpecPollConfig`, beside
the flag it narrows. Keys normalized with `session-group-path.ts` `pathKey`, the same helper
pinned directories use — not a second normalization.

If a future plugin needs per-cwd toggles, it adds its own list under its own namespace, with
the same fold rule. That is a smaller total surface than a shared record whose only tenant is
OpenSpec.

### D5 (revised) — Init runs server-side, with the corrected argv and real guards

Considered: spawn a pi session running `project-init` — visible, with a transcript. Rejected
because the invocation is fully mechanical; routing a `mkdir` + template copy through a model
costs a session slot and seconds for no decision.

**Argv (corrected against the pinned CLI):**

```
<resolved-cli> init <cwd> --tools pi --force
```

preceded by `healExpandedProfileConfig(cwd)`, mirroring `/api/openspec/update`
(`openspec-routes.ts:230`). No `--profile` (F3b), no `--no-animation`, no
`--no-copilot-cloud` (F3).

**Validation set — a new one, not `knownCwds()`.** `knownCwds()` (`openspec-routes.ts:149`)
filters to `hasOpenSpecRoot(cwd)`, i.e. already-initialized projects, and so excludes exactly
the directories init targets. Reusing it would make the endpoint's primary flow reject every
legitimate call. Init validates against `union(session cwds, pinned dirs)` **without** the
`hasOpenSpecRoot` filter. Note also that `/api/openspec/update` validates nothing today
(`openspec-routes.ts:223`) — that is a pre-existing gap this change does not inherit and does
not fix.

**`--force` is retained but does not do what the first draft claimed.** Verified:
`canPromptInteractively()` returns `false` whenever `--tools` is set (`init.js:136-141`), and
legacy cleanup runs on `if (this.force || !canPrompt)` (`init.js:166`). So **`--tools pi` alone
already makes init non-interactive and already auto-cleans legacy artifacts** — `--force`
changes neither. It is kept as explicit intent, not as a safety lever, and the guard below
cannot be built on it.

**Guards, all mandatory:**
1. Return CLI stdout/stderr; the client surfaces it rather than showing a bare success toast.
2. `BROKEN → Repair` behind a confirm dialog naming the directory.
3. **The endpoint performs its own legacy-artifact detection before spawning** and refuses
   without an explicit confirmation flag when it finds any. This cannot be delegated to the
   CLI: `detectLegacyArtifacts` is an `init.js` internal, and by the time the CLI runs, the
   cleanup has already been authorized by `--tools` alone. The first draft's guard assumed
   `--force` gated this; it does not.
4. Serialize per cwd: two concurrent inits race the CLI's cleanup and template copy.

### D6 — `ABSENT` hides the session-card subcard entirely

The folder card is the single place initialization is offered; a disabled subcard on every
session in an OpenSpec-less directory would repeat one nag N times, and the session card
cannot act on it anyway. `BROKEN`/`STALE` *do* render disabled, because the user already opted
in and the subcard would otherwise look functional. **Disabled means "this was supposed to
work"; absent means "this was never set up here."**

### D7 (revised) — Disabled means inert, and its one control must be able to help

Controls are removed from the DOM, not dimmed — a focusable button that silently does nothing
fails identically to today's bug while looking deliberate. The reason is visible text, not a
`title`.

**The single control targets the surface that can remediate the specific reason.** The first
draft pointed every disabled state at Settings → OpenSpec Workflow Profile, which cannot fix
`BROKEN` or missing skills:

| reason | control target |
|---|---|
| `BROKEN` | the folder card's OpenSpec section (Repair lives there) |
| `missing-skills` | the folder card's OpenSpec section (Update lives there) |
| `profile-stale` | Settings → OpenSpec Workflow Profile |

### D8 — A successful init must land in `READY`, via two independent fixes

`setOpenSpecUpdateSignature` is called only in the update handler (`openspec-routes.ts:238`),
so an initialized project reports `unknown` forever. Combined with a ladder that treated
`unknown` as stale, a successful Initialize would have immediately presented as `STALE` — the
primary happy path defeating itself.

Both fixes ship, independently sufficient:
1. **Init records the signature**, mirroring update.
2. **`unknown` is not a stale trigger.** `unknown` means never-measured; only `needs-update` —
   a recorded signature that differs from the current one — marks `STALE`.

Either alone prevents the bug; together they also prevent a project initialized outside the
dashboard from presenting as stale.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **Nag wall** | Compact one-line pill, per-folder `[×]`, **and** fleet-level `offerInitialization: false`. |
| **`--force` blast radius** | Confirm on Repair *and* on Initialize when legacy OpenSpec files are present. |
| **Concurrent init** | Serialize per cwd. |
| **Path injection** | Validate against the un-filtered known-directory set; argv array, never a shell string. |
| **CLI version drift** | Argv valid on 1.6.0 and 1.8.0. The change asserts a minimum version rather than assuming flags. |
| **Stale clients** | `readiness` and `hasOpenSpecSkills` are optional; `undefined` falls through to today's gate, never to a false disabled state. |
| **Invisible repo writes** | stdout/stderr returned and surfaced. |
| **`BROKEN` conflates two causes** | See D9 below. |

### D9 — `BROKEN` covers two causes and only one is fixed by Repair

`directory-service.ts` returns `initialized: false` both when `changes/` is absent
(short-circuit, ~line 498) and when `openspec list` fails (`!raw || !Array.isArray(raw.changes)`,
~line 520). Re-running `init --force` fixes the first and not the second, and `--force` over a
repo with real proposals is the riskiest write in this change.

Therefore the `BROKEN` action is **error-first**: the folder section surfaces the underlying
CLI failure, and Repair is offered only when the failure is the missing-`changes/` shape.
Where the CLI itself failed, the section reports the error and offers no destructive action.
This requires the server to distinguish the two causes on the readiness `reason`, which it can
— they are separate branches in the same function.

## Migration / Rollback

- **Config**: both keys additive with safe defaults (`optOutDirectories: []`,
  `offerInitialization: true`). Existing configs unaffected.
- **Wire**: `readiness` and `hasOpenSpecSkills` optional. Old client + new server → old
  behaviour. New client + old server → `undefined` → must degrade to today's gate.
- **Rollback**: revert the client; the extra config keys and `OpenSpecData` fields are inert to
  the previous code. `POST /api/openspec/init` becomes unused. No data migration.
- **Forward-only**: repositories already initialized stay initialized — the intended effect.
  `openspec init` is additive to the repo, so rollback leaves a working project.

## Open Questions

- **Minimum CLI version enforcement** — assert at startup, or probe `init --help` before the
  first spawn? Both are cheap; the choice affects only where the failure surfaces.

*(The first draft's other two open questions are now settled: the worktree stat target in D2,
and the `BROKEN → Repair` semantics in D9. Both were invalidating a decision recorded as
settled in the same document, which is a contradiction the adversarial review correctly
flagged.)*
