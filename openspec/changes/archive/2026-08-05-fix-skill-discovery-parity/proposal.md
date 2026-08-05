## Why

The dashboard tells users which skills a workspace has, and gets it wrong. It renders 61 skills for this workspace; 5 of them are not skills at all — they are documentation and reference files (`browser/UPSTREAM.md`, `project-init/dox-doctrine.md`, `doctor/AGENTS.md`, `faq-mine/SKILL.md.AGENTS.md`, `.pi/skills/AGENTS.md`) rendered with no description. Meanwhile 22 skills that the session actually has are not shown at all.

The cause is that `packages/server/src/pi/pi-resource-scanner.ts` hand-rolls its own filesystem discovery — and it does this **despite already calling pi's real one**. `pi-resource-activation.ts` constructs a `DefaultPackageManager` and calls `pm.resolve()` on every scan, receiving a complete `ResolvedPaths { extensions, skills, prompts, themes }` where each entry carries `path`, `enabled`, and `metadata { source, scope, origin, baseDir }`. The scanner keeps only the `enabled` boolean and throws the rest away, then rediscovers the same files by hand — badly.

Running pi's resolver against this workspace returns **59 skills, zero phantoms**, with activation state included, `themes` included, and no leakage from `.worktrees/` or the Electron bundle. pi's ignore rules, mode handling, and path canonicalization are already applied inside it. The hand-rolled scan reproduces none of that.

Separately: **22 skills in this workspace are registered at runtime** by `pi-hermes-memory` from `~/.pi/agent/pi-hermes-memory/skills/` (11) and `~/.pi/agent/projects-memory/pi-agent-dashboard/skills/` (11). pi's resolver returns zero of them, because they are not package resources — they exist only once the extension boots. No resolver and no scan can see them; only the live session can.

## What Changes

### Discovery: consume pi's resolver instead of reimplementing it

- Skills, prompts, and themes SHALL be derived from the `ResolvedPaths` already returned by `resolveActivation()`. `metadata.scope` supplies each card's `local` / `global` scope badge and `metadata.origin` its package provenance badge, matching the flat card grid the view already specifies. `extensions` and `agents` are **not** migrated: extensions are not implicated in this bug, and `agents` has no equivalent in pi's `RESOURCE_TYPES`, so both stay hand-scanned.
- Frontmatter is read from each resolved path for `name` and `description`, and pi's load gate is applied: a resource whose frontmatter has no non-empty `description` is not a skill. This is what removes `.pi/skills/AGENTS.md`, which pi's resolver *does* return and pi's loader *then* drops — so no dashboard-specific exclusion rule is needed.
- The hand-rolled `discoverSkills()` is retained **only** as a degraded fallback for when `resolveActivation()` returns `null` (pi unavailable or resolution threw). In that mode the payload is marked degraded rather than presented as authoritative.
- `themes` becomes a *scanner-reported* resource type, arriving free with `ResolvedPaths`. The view already specifies a Themes type page, so no view change is required.
- **Accepted consequence:** resources excluded by a package's own manifest patterns are absent from `ResolvedPaths` entirely, so they are not reported at all rather than reported as disabled. This matches pi, which does not load them either, and is therefore parity rather than loss — but it does mean such a resource cannot be re-enabled from the dashboard, only by editing the manifest.

This deletes the phantom class by construction rather than by rule: pi's resolver never returns `UPSTREAM.md` or `dox-doctrine.md`, because a directory containing `SKILL.md` is not descended into.

### Live-loaded state: retain the message the bridge already sends

- The bridge already sends `commands_list` from `pi.getCommands()` on register and on change (`packages/extension/src/session-sync.ts`), and `CommandInfo` already declares `source: "extension" | "prompt" | "skill" | "builtin"`. **No new message is introduced.**
- The bridge SHALL populate `CommandInfo.path` from pi's `sourceInfo.path` inside `filterHiddenCommands()` (`packages/extension/src/bridge-context.ts`) — the single chokepoint shared by **all five** `commands_list` senders (`session-sync.ts` ×2, `flow-event-wiring.ts`, `bridge.ts`, `command-handler.ts`). Mapping at one sender only would let any `/reload`, flow rediscovery, or `request_commands` overwrite the retained list with a path-less one and flip every skill to not-loaded.
- The server SHALL retain the most recent `commands_list` per session. It currently forwards to the browser without storing, so nothing server-side can consult it.
- The server SHALL join skills from that retained list against resolved skills on canonicalized real path, and expose a status: `active` (both), `not-loaded` (resolved, not live), `loaded-elsewhere` (live, not resolved). The 22 hermes skills surface as `loaded-elsewhere`.
- Where no session has reported, the payload is scan-only and no skill is labelled.

### Guard

- Extend the repo skill guard with severities matching pi's: missing/empty `description` is an **error** (pi drops the skill); pi's `MAX_DESCRIPTION_LENGTH` (1024), `MAX_NAME_LENGTH` (64), and `name` charset violations are **warnings** (pi warns and loads).
- Add a **repository-local** warning at 400 characters of `description`, labelled as a context-cost budget rather than a pi constraint. 34 repo skills exceed it; **none** exceed pi's 1024. Trimming SHALL preserve trigger phrasing, since the description is what makes a skill auto-load.
- **Exempt `ship-change`, `frontend-mockup-loop`, and `anti-slop-frontend` from the budget.** The shipped `skill-frontmatter-validity` requirement "The three previously-broken skills load" mandates their description wording stay unchanged; all three are over 400 characters (559 / 773 / 612). The budget yields to the existing requirement rather than overriding it.
- The guard is presently a vitest test (`scripts/__tests__/skill-frontmatter.test.mjs`) that can only pass or fail. Emitting severities and source labels requires converting it to a script with structured output plus a CI job — scoped explicitly rather than assumed.

## Capabilities

### New Capabilities

- `session-skill-registry`: the server retains the per-session `commands_list` already sent by the bridge, joins its `source: "skill"` entries against resolved skills on canonicalized path, and exposes per-skill provenance.

### Modified Capabilities

- `pi-resource-scanning`: skills, prompts, and themes are sourced from pi's `ResolvedPaths` rather than an independent filesystem walk, with the hand-rolled scan demoted to a degraded fallback.
- `pi-resources-view`: resource cards carry per-skill provenance, and the surface exposes degraded and scan-only states. Provenance is expressed as a card badge and a filter value, consistent with the flat card grid the capability already mandates.
- `skill-frontmatter-validity`: the guard gains pi-severity-matched checks, a repository description budget, a doc-tree exemption, and CI enforcement.

## Impact

**Code**

- `packages/server/src/pi/pi-resource-scanner.ts` — consume `ResolvedPaths`; demote `discoverSkills()` to fallback.
- `packages/extension/src/bridge-context.ts` — map `sourceInfo.path` onto `CommandInfo.path` inside `filterHiddenCommands()`, covering all five `commands_list` senders.
- `packages/server/src/` — retain `commands_list` per session; implement the join; extend the resources payload.
- `packages/shared/src/` — resource status and degraded/scan-only flags on the resources payload.
- `packages/client/src/` — provenance, degraded, and scan-only rendering.
- Repo skill guard + CI workflow; up to 34 `SKILL.md` description trims.

**Behaviour**

- 5 phantom entries disappear. 22 runtime-registered skills appear. `themes` appears. Activation state comes from pi rather than a parallel derivation.
- No skill's *loading* behaviour changes, and no package manifest is touched — publishing is unaffected.
- **This change is not a net deletion.** Skill/prompt discovery moves to the resolver, but `discoverSkills`/`discoverPrompts` are retained as the degraded fallback and `discoverExtensions`/`discoverAgents` are untouched, so both paths coexist. The join, the guard rewrite, and the client states are net additions. An earlier draft claimed net deletion and encoded it as an acceptance criterion; that claim is withdrawn.

**Not in scope**

- Registering the 6 unregistered monorepo skill packages in `settings.json packages[]`.
- Modelling the `disableModelInvocation` tier. `getCommands()` omits the flag; `before_agent_start`'s `systemPromptOptions.skills` carries it but fires only at turn start, so it cannot serve a resources view that must render before any turn.
- `packages/kb/skill/kb-setup/SKILL.md`, which uses a non-`.pi` `skill/` layout neither pi nor the scanner treats as a skills root.

## Discipline Skills

- `doubt-driven-review` — two earlier drafts of this change were invalidated at the design level by review: the first asserted a package-discovery defect that did not exist, the second specified a hand transcription of pi's algorithm while the repo already called pi's resolver. Any further claim about pi's internals must be verified against source before it stands.
- `scenario-design` — the surface is a join between two asynchronous sources with three degraded modes (pi unavailable, no session, old bridge).
- `review-code` — the change spans scanner, bridge, server, and client.
- `code-simplification` — discovery for skills and prompts should end up smaller than it started; the fallback path is the part most likely to accrete complexity and should be reviewed for it.
