## Context

Two independent reimplementations exist in this codebase, and both are the cause of the bug this change fixes.

**One:** `pi-resource-scanner.ts` hand-walks the filesystem to find skills, while `pi-resource-activation.ts:112` already calls `new DefaultPackageManager(...).resolve()` and receives pi's own complete discovery output. The scanner extracts the `enabled` flag from that result and discards the rest.

**Two:** an earlier draft of this change proposed adding a third implementation — a hand transcription of pi's `collectSkillEntries` — plus a differential test to keep it honest. That draft was withdrawn after review established that the transcription target was the wrong function (`loadSkills` routes through a *separate* discovery path with no `mode` parameter and name-collision dedupe, so the test could not have passed a correct port).

The design principle that follows: **delete implementations, do not add them.**

Measured, by running `resolveActivation()` against this workspace:

| | hand scan | pi's `resolveActivation()` |
|---|---|---|
| skills returned | 61 | 59 |
| phantoms (`UPSTREAM.md`, `dox-doctrine.md`, `*.AGENTS.md`) | 5 | 0 |
| `.worktrees/` (161 `SKILL.md` on disk) | not reachable — no recursion | 0 |
| Electron bundle (14 `SKILL.md` on disk) | not reachable | 0 |
| activation state | derived separately | included — 4 disabled |
| `themes` | absent | present |
| path shape | mixed | 58 `SKILL.md` + 1 bare `.md`, 0 directories |
| runtime-registered (hermes) | 0 | 0 |

Three facts that shape every decision:

1. `ResolvedResource` is `{ path, enabled, metadata: { source, scope, origin, baseDir } }` — everything the Resources view groups by is already there.
2. `.pi/skills/AGENTS.md` **is** returned by the resolver. pi drops it later, in `loadSkillFromFile`, because its frontmatter has no `description`. Discovery and loading are two stages, and the dashboard currently implements neither faithfully.
3. `pi.getCommands()` output is **already on the wire**: `session-sync.ts:160,270` sends `commands_list`, and `CommandInfo` already declares `source: "…|skill|…"` and `path?`.

## Goals / Non-Goals

**Goals:**

- The dashboard's resource list is pi's own answer, not a parallel derivation.
- Skills the session has but the filesystem cannot show become visible.
- Skill and prompt discovery code shrinks. The change **overall** is a net addition — the join, the guard conversion, and the client states are new — and an earlier draft wrongly claimed otherwise and encoded it as an acceptance criterion.

**Non-Goals:**

- Changing what pi loads.
- Introducing a new protocol message; the needed data is already sent.
- Modelling the `disableModelInvocation` tier.
- Reporting pi's `ResourceDiagnostic[]`, which is private to `AgentSession`.

## Decisions

### D1 — Discovery is `ResolvedPaths`; the hand scan becomes a fallback

`scanPiResources()` sources skills, prompts, and themes from the `ResolvedPaths` already fetched for activation. `metadata.scope` supplies the card's `local` / `global` badge and `metadata.origin` its package badge — the view's `Merged scope sections` requirement mandates a flat card grid with per-card badges, **not** stacked scope sections, so no grouping is introduced.

*Edge cases in the mapping:*
- `metadata.scope === "temporary"` renders with the `local` badge; it is neither user-global nor absent.
- A `package`-origin entry whose `metadata.source` does not match a known package row is still rendered, labelled with the raw source string, and never dropped. pi's source identity normalisation (`npm:<name>` version-stripped, `local:<abs path>`) does not align with the scanner's name-based package rows, so match failure is expected and must be non-fatal.
- Resources excluded by a package's own manifest patterns never appear in `ResolvedPaths`, so they are absent rather than disabled. This matches pi. The consequence — no dashboard toggle for them — is recorded in Risks.

*Why:* it is pi's own output. Ignore-file semantics, the `SKILL.md`-stops-descent rule, scan mode, and path canonicalization are applied inside it and cannot drift from it.

*Alternative rejected — transcribe `collectSkillEntries`:* adds a third implementation and a conformance harness to police it. Withdrawn after review; the harness was also unsound.

*Alternative rejected — call `loadSkills()` directly:* it applies name-collision dedupe into a `Map` keyed by name, silently dropping the loser. The Resources view must show both copies. `resolve()` is the correct layer: discovery without loader-stage collapse.

*Fallback:* `resolveActivation()` returns `null` when pi is unavailable or resolution throws. The existing hand scan is retained for that path only, and the payload is flagged degraded. Without this the Resources view goes empty on any pi failure — a worse regression than the bug.

*Second failure shape:* `resolve()` can also succeed and return **empty arrays** (nonexistent cwd, an internal settings read failure). An empty result the fallback walk contradicts is treated as degraded too — otherwise an authoritative-looking payload with zero skills ships, which is strictly worse than the bug being fixed.

*`extensions` and `agents` are unchanged.* `ResolvedPaths.extensions` exists, but extension discovery is not implicated in this bug. `agents` has **no** entry in pi's `RESOURCE_TYPES` at all, so `discoverAgents()` must survive and the `agents` array remains part of every `PiResourceScope`.

### D2 — pi's load gate is applied on top of discovery; no dashboard-specific exclusion rule

After resolution, each path's frontmatter is read for `name` and `description`, and a resource with no non-empty `description` is not reported as a skill.

*Why this replaces a special case:* an earlier draft added a rule excluding `AGENTS.md` / `*.AGENTS.md` by name. That rule contradicted the same document's "no independent classification rule" requirement and was a divergence *away* from pi — an `AGENTS.md` carrying a real description would be loaded by pi and hidden by the dashboard. Applying pi's actual gate removes `.pi/skills/AGENTS.md` for pi's actual reason.

*Scope note:* the guard still exempts doc-tree files from its missing-description **error**, because the documentation protocol mandates them. That is a lint policy, not a discovery rule, and the two no longer contradict.

### D3 — Live-loaded state reuses `commands_list`; the bridge fills in the declared field

No new message. The bridge maps pi's `sourceInfo.path` onto `CommandInfo.path` **inside `filterHiddenCommands()`**; the server retains the latest `commands_list` per session and filters `source === "skill"`.

*Why the chokepoint, not the sender:* there are five senders — `session-sync.ts:161` (register), `session-sync.ts:271` (spawn), `flow-event-wiring.ts:61` (flow rediscover/complete), `bridge.ts:2449` (`session_start`, the reload path), and `command-handler.ts:687` (`request_commands` RPC). All five pass through `filterHiddenCommands()`. Since the server retains *the latest* list, mapping at one sender means any reload, flow rediscovery, or client command refresh replaces a good list with a path-less one and flips every skill to `not-loaded`.

*Retention is not a settled state:* a reload sends a fresh list, so between an empty transitional list and the repopulated one every resolved skill would momentarily read `not-loaded`. The retained set is only replaced by a list that contains at least one skill entry, or after the session reports steady-state — an empty list never displaces a non-empty one on its own.

*Why not a new message:* two channels carrying the same facts diverge. `commands_list` is already sent on register and on change, already typed with a `skill` source, and already carries the path — just not at its declared location, because the bridge forwards pi's raw objects.

*Why this also removes the capability marker:* an earlier draft added an explicit marker so "old bridge" could be told from "empty skill set". Every bridge already sends `commands_list`, so the discriminator is the presence of a retained message for that session, not a new flag.

*Feature detection:* `pi.getCommands()` is already called unguarded at both existing call sites. This change does not add a new unguarded surface, but per `pi-api-feature-detection` the `sourceInfo.path` read must tolerate the field being absent rather than throwing.

### D4 — Join on canonicalized real path; statuses name what is known

| Resolved | Live | Status |
|---|---|---|
| ✓ | ✓ | `active` |
| ✓ | ✗ | `not-loaded` |
| ✗ | ✓ | `loaded-elsewhere` |

*Canonicalize:* pi dedupes on `canonicalizePath()`; this repo has vendored and pnpm-hoisted copies. A raw string compare would mark a working skill `not-loaded`.

*Why `not-loaded`, not `dropped`:* the resolver is folder-scoped while a session resolves against its own `cwd`. A worktree session attached to a folder card legitimately loads a different set. `not-loaded` states what is observed; it does not assert rejection.

*Why `loaded-elsewhere`, not `runtime`:* a skill can be live-but-unresolved via runtime registration, `~/.pi/agent/skills`, an ancestor `.agents/skills` chain, an explicit `--skill` path, or `skillPaths` in settings. The status says where it is not; the reported path says where it came from.

*Known gap — name collisions.* `getCommands()` maps `getSkills().skills`, which is post-collision-dedupe, and two same-named skills produce the same command name. A skill that lost a collision is resolved, absent from live, and will be labelled `not-loaded`. The join cannot distinguish this from a genuine miss without diagnostics it cannot reach. **Accepted gap — and no requirement may contradict it:** the specs assert only that the join keys on canonicalized path, which keeps distinct *resolved* entries distinct. The *live* side genuinely collapses, and no spec claims otherwise.

*Disabled skills:* `ResolvedResource.enabled === false` is reported as disabled, and the `enabled` check takes precedence over the join so the label holds regardless. The intuitive rationale — "it will be absent from the live set" — is unreliable: `getSkills()` applies no `enabled` filter, so a disabled skill may still appear in `commands_list`. Precedence, not absence, is what makes this correct.

### D5 — Guard severities mirror pi's, and label their own source

Error: missing/empty `description`. Warning: pi's 1024/64/charset limits (pi warns and loads). Warning: the repository's 400-character budget, labelled as repository policy.

*Why the labelling matters:* an earlier draft listed pi's limits as errors "sourced from pi", one paragraph after correctly noting pi warns and loads. A house rule wearing pi's badge invites a future reader to raise the limit in the wrong direction.

*Trade-off:* the description is what makes a skill auto-load, so over-trimming costs discoverability. The budget is never an error and trims must preserve trigger phrasing.

*Existing requirement wins:* `skill-frontmatter-validity` already requires `ship-change`, `frontend-mockup-loop`, and `anti-slop-frontend` to keep their description wording unchanged. All three exceed 400 characters (559 / 773 / 612). They are exempt from the budget; the new policy yields to the shipped requirement rather than silently overriding it.

*The guard is not what it looks like:* it is currently `scripts/__tests__/skill-frontmatter.test.mjs`, a vitest `it.each` that can only pass or fail, already run by `npm test`. Severities, source labels, and warn-without-failing require converting it into a script with structured output plus its own CI job. That conversion is scoped as work, not assumed to exist.

*Dropped from an earlier draft:* a stray-sibling warning for top-level `.md` files inside skill directories. Once discovery comes from pi's resolver those files can no longer be mistaken for skills, so the warning would only pressure a file-move refactor this change does not scope — and `UPSTREAM.md` / `dox-doctrine.md` are referenced by their skill bodies.

*Also dropped:* an `AGENTS.md` / `*.AGENTS.md` exemption from the missing-description error. The guard collects only files named `SKILL.md`, so it has never seen those files and the exemption would be a no-op asserting a problem that does not exist.

## Risks / Trade-offs

- **`resolve()` cost on a 30s poll** → it constructs a `SettingsManager` and `DefaultPackageManager` per call. It is already called on every scan today, so this change does not add the cost; but consuming it makes the resources payload depend on it, so a failure is now user-visible rather than silent. Mitigated by the degraded-fallback path (D1).
- **Name-collision losers render as `not-loaded`** → known gap (D4). Bounded: it requires two same-named skills where one shadows the other. Surface the duplicate paths in the payload so a user can recognise the pattern.
- **Session `cwd` ≠ scanned folder** → legitimate divergence, especially with worktrees. The payload carries the session's cwd so `not-loaded` can be attributed to scope rather than rejection.
- **`commands_list` retention is per-session; the view is per-folder** → with two sessions on one folder the join needs a chosen session. Open Question.
- **Degraded mode is silent today** → `resolveActivation()` already swallows failures and defaults everything to enabled. Making the payload flag it is new user-visible behaviour and may surface pre-existing pi-resolution failures that were previously invisible. That is intended.
- **Manifest-excluded package resources become invisible rather than disabled** → they are absent from `ResolvedPaths`, so the activation toggle cannot reach them. This matches pi, which does not load them either, but it is a real reduction in what the dashboard can show and must be called out in the changelog.
- **`sourceInfo.path` is a pi-internal shape, not a documented extension-API contract** → tolerating its absence prevents a crash but not a silent regression: a pi rename would make every skill fail the join and flip everything to `not-loaded`. The server should warn when retained skill commands carry no joinable path, so the failure is loud.
- **`resolve()` has no timeout** → it is awaited inside the resources refresh and can perform network I/O for temporary git sources. Degraded mode fires on throw and on contradicted-empty, but not on slowness.

## Migration Plan

1. **Consume `ResolvedPaths` for skills/prompts/themes**, apply the description gate, demote the hand scan to fallback. Self-contained; removes the phantoms and adds themes. Shippable alone.
2. **Guard + CI + description trims.** Independent of step 1.
3. **Live join** — bridge `path` mapping → server retention → join → client provenance. Depends on step 1: run against the un-migrated scanner, the join would label the 5 phantoms `not-loaded` and ship exactly the false-negative class this change removes.

**Rollback:** step 1 restores the previous scan by reverting one branch. Step 3 is additive — without retention the payload is scan-only. No persisted state migrates.

## Open Questions

- **Which session's `commands_list` serves a folder with several attached sessions?** This is unresolved, so the specs deliberately do **not** assert a single "contributing session" as normative. Until it is decided, a folder with more than one reporting session degrades to scan-only rather than silently picking last-writer-wins.
- **Should `extensions` also migrate to `ResolvedPaths`** for consistency, or stay hand-scanned until there is evidence of a defect there?
- **Should degraded mode be actionable** — surface the underlying pi resolution error, or only the fact of degradation?
