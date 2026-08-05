## Purpose

Disabling a pi resource for ONE project, whatever scope that resource is defined at, by writing the pi-standard settings form for its origin — so pi itself enforces the result and the entry stays portable across machines.

## Requirements

### Requirement: Resource origin SHALL be classified by resolved path, not by reported metadata

`applyResourceToggle` SHALL determine a resource's origin by comparing its resolved absolute path against the candidate base directories — package roots, `<cwd>/.pi`, each `.agents` base directory pi reported, and the global base directories — selecting the **longest matching prefix**. It SHALL NOT key on `metadata.scope`, `metadata.source`, or `metadata.baseDir`, and SHALL NOT rely on a fixed candidate order.

Disabling a globally-defined resource re-declares it in project settings, which causes pi to report it with `scope: project`, `source: local`, and no `baseDir`. A classifier keyed on those fields cannot recognise the resource it itself re-declared, making the disable irreversible.

#### Scenario: A nested base directory does not shadow a longer one
- **GIVEN** a cwd equal to the home directory, so that `<cwd>/.pi` is an ancestor of the global base `~/.pi/agent`
- **WHEN** a skill under `~/.pi/agent/skills` is toggled at `local` scope
- **THEN** it is classified as a global loose resource, not as a project loose resource

#### Scenario: A re-declared global resource is still classified as global loose
- **GIVEN** a global skill already disabled at `local` scope, which pi now reports with `scope: project`, `source: local`, `baseDir: undefined`
- **WHEN** the user re-enables it
- **THEN** the toggle classifies it as a global loose resource by its path
- **AND** it removes the entries the disable added

#### Scenario: Classification is stable across a disable/enable pair
- **GIVEN** any resource
- **WHEN** it is disabled and then re-enabled
- **THEN** both operations classify it into the same origin

### Requirement: A project-scope toggle SHALL write the pi-standard form for the resource's origin

The dashboard SHALL NOT introduce notation pi does not itself interpret.

| origin | form |
|---|---|
| loose under `<cwd>/.pi` | force-exclude relative to `<cwd>/.pi` |
| loose under a `.agents` base dir pi reported | force-exclude relative to that base dir |
| package-contributed | an `autoload: false` delta entry in `packages`, force-exclude relative to the package root |
| loose under a global base dir | the resource's **own file** as a `~`-prefixed entry, plus a home-independent anchored glob exclusion |

#### Scenario: Project loose resource keeps pi's relative-path form
- **GIVEN** a project skill at `<cwd>/.pi/skills/local-demo/SKILL.md`
- **WHEN** it is disabled at `local` scope
- **THEN** `<cwd>/.pi/settings.json#skills` gains `-skills/local-demo/SKILL.md`
- **AND** no `packages` entry is created

#### Scenario: A .agents resource uses its own base directory
- **GIVEN** a skill pi reports at `scope: project` whose base directory is `<ancestor>/.agents` rather than `<cwd>/.pi`
- **WHEN** it is disabled at `local` scope
- **THEN** the written force-exclude is relative to `<ancestor>/.agents`
- **AND** pi's resolver subsequently reports that skill disabled for `<cwd>`

#### Scenario: An ambiguous relative path escalates to an anchored exclusion
- **GIVEN** a project skill at `<cwd>/.pi/skills/shared/SKILL.md` and another skill at `<ancestor>/.agents/skills/shared/SKILL.md`, which produce the same string relative to their own base directories
- **WHEN** one of them is disabled at `local` scope
- **THEN** the written entry is an exclusion anchored on that resource's base-directory leaf and its path within it, distinguishing the two
- **AND** the anchored exclusion contains neither a home directory nor a checkout path, so it remains valid on another machine
- **AND** no directory or file re-declaration is written, because both resources already resolve at project scope
- **AND** pi's resolver reports the toggled skill disabled
- **AND** it reports the other skill still enabled

#### Scenario: The global-loose anchor is derived from the configured agent directory
- **GIVEN** an agent directory that is not the default but is located under the home directory
- **WHEN** a skill under it is disabled at `local` scope
- **THEN** the written entries use that agent directory's home-relative path as their anchor
- **AND** pi's resolver reports the skill disabled

#### Scenario: An agent directory outside the home directory is reported as unsupported
- **GIVEN** an agent directory that is not located under the home directory, for which no home-independent form exists
- **WHEN** a global loose resource under it is disabled at `local` scope
- **THEN** the server responds with an error explaining that the layout cannot be expressed portably
- **AND** no entry is written

#### Scenario: Global loose resource is re-declared by file and excluded by anchored glob
- **GIVEN** a global skill at `~/.pi/agent/skills/foo/SKILL.md`
- **WHEN** it is disabled at `local` scope for `<cwd>`
- **THEN** `<cwd>/.pi/settings.json#skills` contains the entry `~/.pi/agent/skills/foo/SKILL.md` — the resource's own file, neither its directory nor the `skills` root
- **AND** it contains an exclusion pattern that matches the resource's absolute path without naming any home directory
- **AND** `~/.pi/agent/settings.json` is not written
- **AND** pi's resolver reports that skill disabled for `<cwd>`

#### Scenario: A flat-file global skill is handled by the same form
- **GIVEN** a global skill that is a bare `.md` file directly under `~/.pi/agent/skills`
- **WHEN** it is disabled at `local` scope
- **THEN** the entry written is that file, not the `skills` root
- **AND** every other skill in that root remains enabled at its original global scope

#### Scenario: Global prompts and themes use the same form
- **GIVEN** a global prompt and a global theme, both of which are flat files whose containing directory is a shared root
- **WHEN** each is disabled at `local` scope
- **THEN** the entry written for each is its own file
- **AND** pi's resolver reports each disabled
- **AND** other prompts and themes in the same roots remain enabled

#### Scenario: The written entries work under a different home directory
- **GIVEN** a project settings file produced by disabling a global skill on one machine
- **WHEN** the same settings file is resolved with a different `$HOME`, where the equivalent global skill exists
- **THEN** pi's resolver reports that skill disabled
- **AND** no written entry contains a machine-specific absolute path

#### Scenario: Sibling global resources keep their scope and activation
- **GIVEN** two skills in the same global directory
- **WHEN** one is disabled at `local` scope
- **THEN** pi's resolver reports the sibling enabled
- **AND** the sibling is still reported at its original global scope

#### Scenario: An unrelated glob in the project array does not reach the re-declared resource's siblings
- **GIVEN** a project `skills` array containing an unrelated glob entry
- **WHEN** a global skill is disabled at `local` scope
- **THEN** the other skills in that global directory remain enabled

#### Scenario: A same-named project resource is unaffected
- **GIVEN** a global skill and a project skill that share a name
- **WHEN** the global one is disabled at `local` scope
- **THEN** the project skill remains enabled

#### Scenario: Resources are not duplicated
- **GIVEN** a global resource disabled at `local` scope
- **WHEN** resources are resolved for that cwd
- **THEN** that resource appears exactly once in the resolved set

### Requirement: A package delta SHALL always carry `autoload: false`, and SHALL be used only at project scope

A **project-scope** disable of a package-contributed resource SHALL write the `autoload: false` flag on the `packages` entry. Omitting the flag makes pi resolve the entry at project scope, miss the user install path, and drop the package's entire contribution.

A **global-scope** disable SHALL NOT use the delta form. pi redirects a delta to the user install only for project-scope entries, so a delta appended at global scope is a second same-scope entry for the same identity and is silently discarded. Global scope SHALL continue to mutate the existing entry in place, converting a bare string to object form and adding an ordinary filter.

#### Scenario: Global-scope package disable still mutates in place
- **GIVEN** `~/.pi/agent/settings.json#packages` contains the bare string `"npm:probe-pkg"` contributing skills `alpha` and `beta`
- **WHEN** `beta` is disabled at `global` scope
- **THEN** that entry is rewritten in place to object form with a `skills` filter excluding `beta`
- **AND** it does not gain `autoload: false`
- **AND** no second entry for that package is appended
- **AND** pi's resolver reports `beta` disabled and `alpha` enabled

#### Scenario: Delta entry is written with the flag
- **GIVEN** a package `npm:probe-pkg` declared only in global settings, contributing skills `alpha` and `beta`
- **WHEN** `beta` is disabled at `local` scope
- **THEN** `<cwd>/.pi/settings.json#packages` gains `{ source: "npm:probe-pkg", autoload: false, skills: ["-skills/beta/SKILL.md"] }`
- **AND** the request does not fail with "package not found in settings for scope"

#### Scenario: The package's other resources survive
- **GIVEN** the delta entry above
- **WHEN** resources are resolved for that cwd
- **THEN** `alpha` reports enabled and `beta` reports disabled

#### Scenario: No project-scope re-install is triggered
- **GIVEN** the delta entry above for an `npm:` source installed under the user's agent directory
- **WHEN** resources are resolved for that cwd
- **THEN** no project-scope package directory is created

#### Scenario: A second disable extends the existing delta
- **GIVEN** a project delta entry already excluding `beta` from `npm:probe-pkg`
- **WHEN** `alpha` from the same package is disabled at `local` scope
- **THEN** the same delta entry's `skills` array gains the `alpha` force-exclude
- **AND** no second entry for that source is created

### Requirement: Package entries SHALL be matched by normalised identity

The toggle SHALL locate an existing `packages` entry using the same normalisation pi applies — an npm source reduced to its name without version, a git source reduced to host and path across SSH and HTTPS spellings, a local source reduced to its resolved path — and SHALL NOT match on raw source-string equality.

pi de-duplicates by that normalised identity, so an entry found by string equality alone can be missed, causing the toggle to append a duplicate that then shadows and discards the user's entry.

#### Scenario: A differently-spelled npm entry is found and extended
- **GIVEN** the project's `packages` contains `{ source: "npm:foo@^1.0.0", skills: ["+skills/alpha/SKILL.md"] }`
- **WHEN** a skill from `npm:foo@^2.0.0` is disabled at `local` scope
- **THEN** the existing entry is extended rather than a second entry appended
- **AND** its `+skills/alpha/SKILL.md` filter is preserved

#### Scenario: A git source is matched across SSH and HTTPS spellings
- **GIVEN** the project declares a package by its SSH git URL
- **WHEN** a resource from the same repository, declared globally by HTTPS URL, is disabled at `local` scope
- **THEN** the two are recognised as the same package
- **AND** no duplicate entry is appended

### Requirement: A project-owned package entry SHALL NOT be converted into a delta

If the project's `packages` array already contains a non-delta entry for the resource's package identity, the exclusion SHALL be added to that entry using ordinary filter semantics, and the entry SHALL NOT gain `autoload: false`.

#### Scenario: An existing project package entry is extended, not rewritten
- **GIVEN** `<cwd>/.pi/settings.json#packages` contains `{ source: "<repo>", extensions: ["+packages/kb-extension/src/index.ts"] }`
- **WHEN** a skill contributed by `<repo>` is disabled at `local` scope
- **THEN** that entry gains the skill force-exclude in its `skills` array
- **AND** its existing `extensions` filter is preserved unchanged
- **AND** it does not gain `autoload: false`

### Requirement: Re-enabling SHALL remove the exclusion and write nothing in its place

Re-enabling SHALL strip the entries the disable added and SHALL NOT write a force-include. A force-include never round-trips, and because prefix-stripping treats `!` the same as `-`, writing one can replace a user's deliberate exclude with an override of the opposite meaning.

#### Scenario: Round trip is behaviourally equivalent
- **GIVEN** a project settings file in a known state
- **WHEN** a resource is disabled at `local` scope and then re-enabled
- **THEN** pi's resolver reports exactly the activation state it reported before the disable, for every resource
- **AND** no force-include entry was written

#### Scenario: Both halves of the global-loose pair are removed
- **GIVEN** a global skill disabled at `local` scope by this dashboard
- **WHEN** it is re-enabled
- **THEN** both its file entry and its exclusion are removed
- **AND** the resource is reported at its original global scope again
- **AND** the ownership record for that entry is cleared

#### Scenario: A user's exclude is not converted into an include
- **GIVEN** a project `skills` array containing a user-authored `!`-prefixed exclude for a resource
- **WHEN** that resource is disabled and then re-enabled through the dashboard
- **THEN** no `+`-prefixed entry is written for it

#### Scenario: An emptied package delta is removed only when no filters of any type remain
- **GIVEN** a project delta entry whose only remaining filter, across every resource type, is the force-exclude for the resource being re-enabled
- **WHEN** it is re-enabled
- **THEN** the delta entry is removed from the `packages` array entirely

#### Scenario: A delta with filters for another resource type survives
- **GIVEN** a project delta entry excluding one skill and one extension
- **WHEN** the skill is re-enabled
- **THEN** its skill exclusion is removed
- **AND** the delta entry remains with its extension exclusion intact
- **AND** that extension remains disabled

### Requirement: Ownership of written entries SHALL be recorded outside the settings file

The dashboard SHALL record which plain path entries it added, so a re-enable removes only its own. A user may hand-author an entry byte-identical to one the dashboard writes, and the two cannot be told apart by inspection.

The record SHALL live in the dashboard's own store rather than in `<cwd>/.pi/settings.json`, so that the settings file stays purely pi-standard, each toggle performs a single settings write, and ownership remains a machine-local fact.

#### Scenario: A user-authored plain entry survives a round trip
- **GIVEN** a project `skills` array containing a plain entry for a global resource that the user authored, with no ownership record for it
- **WHEN** that resource is disabled and then re-enabled through the dashboard
- **THEN** the exclusion the dashboard added is removed
- **AND** the user's plain entry remains
- **AND** pi's resolver reports the resource enabled

#### Scenario: A dashboard-authored entry is removed on re-enable
- **GIVEN** a global resource disabled through the dashboard, with an ownership record for its plain entry
- **WHEN** it is re-enabled
- **THEN** the plain entry and the exclusion are both removed
- **AND** the ownership record is cleared

#### Scenario: Activation state means the enabled flag, not the reported scope
- **GIVEN** any round trip covered by this capability
- **WHEN** "the prior activation state" is evaluated
- **THEN** it refers to each resource's enabled or disabled flag
- **AND** a difference in a resource's reported scope, which changes name-collision precedence but not activation, does not by itself constitute a round-trip failure

#### Scenario: No ownership record means the entry is left in place
- **GIVEN** a settings file written by another machine's dashboard, for which this machine has no ownership record
- **WHEN** the resource is re-enabled here
- **THEN** the exclusion is removed and the resource reports enabled
- **AND** the plain entry is left in place rather than destroyed
- **AND** the resource may therefore report project scope rather than its original global scope, which changes name-collision precedence but not its activation

#### Scenario: The settings file gains no dashboard-private key
- **GIVEN** any completed toggle
- **WHEN** `<cwd>/.pi/settings.json` is inspected
- **THEN** it contains only keys pi itself interprets

### Requirement: Existing entries addressing the same resource SHALL be stripped as an equivalence class

Before writing, the toggle SHALL remove existing **exclusion** entries that address the same file, matching them by exact spelling — the relative, absolute, parent-relative and parent-absolute forms of that resource, plus the exact anchored-glob string this capability itself writes — rather than by raw string equality alone.

The toggle SHALL NOT evaluate a user's glob against the resource in order to decide whether to remove it. A user-authored broad exclusion such as `!skills/**` covers the resource but expresses an intent about many resources; removing it would enable every sibling it excluded.

Only `-` and `!` entries SHALL be stripped. A `+` force-include SHALL never be removed: it outranks an exclusion, so a user holding both has deliberately enabled that resource, and stripping the include would flip it off across a disable/enable round trip.

#### Scenario: A user's broad exclusion glob is preserved
- **GIVEN** a project `skills` array containing a user-authored `!skills/**` that covers many resources including the one being toggled
- **WHEN** that resource is toggled
- **THEN** the `!skills/**` entry remains
- **AND** the other resources it covers remain disabled

A force-exclude is applied last and unconditionally, so a stale exclusion in a different spelling silently defeats an enable.

#### Scenario: A user's force-include survives a round trip
- **GIVEN** a project `skills` array containing both `!skills/foo/SKILL.md` and `+skills/foo/SKILL.md`, so pi reports the resource enabled
- **WHEN** that resource is disabled and then re-enabled through the dashboard
- **THEN** the `+skills/foo/SKILL.md` entry is still present
- **AND** pi's resolver reports the resource enabled, as it did before

#### Scenario: A differently-spelled stale force-exclude is removed on enable
- **GIVEN** a project `skills` array containing `-skills/foo` written by pi's own config selector
- **WHEN** the resource `skills/foo/SKILL.md` is enabled through the dashboard
- **THEN** the `-skills/foo` entry is removed
- **AND** pi's resolver reports the resource enabled

#### Scenario: Entries for other resources are untouched
- **GIVEN** a project array containing exclusions for several resources
- **WHEN** one resource is toggled
- **THEN** only entries addressing that resource are modified

### Requirement: Serialized toggles SHALL each observe the previous write

Each toggle SHALL read the settings file, modify it, and complete its flush entirely within the per-settings-file write lock, so a subsequent toggle observes the previous one's result. A settings snapshot taken before the lock is acquired would silently discard the earlier write.

#### Scenario: Two rapid toggles in the same folder both survive
- **GIVEN** a folder with two enabled resources
- **WHEN** both are disabled in immediate succession, without waiting for the first response
- **THEN** the settings file contains the entries for both
- **AND** pi's resolver reports both disabled

#### Scenario: A toggle observes an entry written by the preceding toggle
- **GIVEN** a resource disabled by a toggle that has just completed
- **WHEN** a second toggle for a different resource in the same folder runs
- **THEN** the first resource's entry is still present after the second write

### Requirement: The scope guard SHALL be directional

The guard SHALL reject a `global`-scope toggle of a project-local resource, which has no pi-standard form. It SHALL NOT reject a `local`-scope toggle of a globally-defined resource, which is the case this capability exists to support.

#### Scenario: Global-scope toggle of a project resource is rejected
- **GIVEN** a project skill at `<cwd>/.pi/skills/local-demo/SKILL.md`
- **WHEN** a toggle is requested with `{ scope: "global", cwd, type: "skill", filePath: "<cwd>/.pi/skills/local-demo/SKILL.md", enabled: false }`
- **THEN** the server responds `400` with an error naming the scope mismatch, not a `404` for an unresolvable resource
- **AND** neither settings file is written
- **AND** the request SHALL carry `cwd` even at `global` scope, so the resource resolves against the intended folder rather than the server's own working directory

#### Scenario: Local-scope toggle of a global resource is accepted
- **GIVEN** a global skill
- **WHEN** it is toggled at `local` scope
- **THEN** the request is not rejected by the guard

#### Scenario: No inert entry is ever written
- **GIVEN** any accepted toggle
- **WHEN** it has been persisted
- **THEN** pi's resolver reports the requested activation state for that resource on the next resolution

#### Scenario: An unparseable settings file fails loudly rather than reporting success
- **GIVEN** a `<cwd>/.pi/settings.json` that cannot be parsed, so pi retains a load error and silently skips the write
- **WHEN** a toggle is requested
- **THEN** the server responds with an error identifying the unparseable settings file
- **AND** it does not report success

### Requirement: An untrusted folder SHALL prompt for a trust decision instead of reporting success

The toggle SHALL guarantee that an explicit trust decision is recorded for the folder once the write completes, unless the configured default is `always`, which proceeds without recording so that folders the user merely toggled are not enrolled permanently. Suppressing the `projectTrusted` argument is not sufficient, because it defaults to true; an explicit check SHALL be performed.

The toggle SHALL NOT skip recording on the grounds that the folder currently has no trust-requiring resources, because writing `.pi/settings.json` is itself what makes a folder trust-requiring. A write performed against an implicitly-trusted folder leaves the next session facing a trust-requiring folder with no recorded decision, which resolves to untrusted when headless or declined — silently discarding the setting just written.

The order SHALL be: a recorded decision decides; otherwise the configured default decides, where `always` proceeds **without recording**, `never` refuses without prompting, and `ask` prompts and records the choice.

When the outcome is a prompt, the toggle SHALL NOT write, and SHALL return a `trust_required` result carrying the offered options. On approval the decision SHALL be persisted through pi's trust store and the toggle retried.

#### Scenario: A folder with no trust-requiring resources still records a decision
- **GIVEN** a cwd with no `.pi` directory, which pi currently loads as trusted
- **WHEN** a `local`-scope toggle is requested and no decision is recorded
- **THEN** the user is prompted rather than silently proceeding
- **AND** after approval a trust decision is recorded for that folder
- **AND** a session newly started in that folder afterwards reports the resource disabled

#### Scenario: The prompt explains why it appeared for an implicitly-trusted folder
- **GIVEN** the folder above
- **WHEN** the trust prompt is returned
- **THEN** it states that the folder is trusted implicitly today and that saving this setting will require an explicit decision from now on

#### Scenario: A recorded decision is honoured without prompting
- **GIVEN** a cwd with a recorded trust decision of trusted
- **WHEN** a `local`-scope toggle is requested
- **THEN** that decision is applied and no prompt is returned

#### Scenario: A recorded refusal blocks the write
- **GIVEN** a cwd with a recorded trust decision of not trusted
- **WHEN** a `local`-scope toggle is requested
- **THEN** the toggle is refused with an explanatory error
- **AND** no settings file is written

#### Scenario: The configured default decides when nothing is recorded
- **GIVEN** a cwd with no recorded decision
- **WHEN** the configured default is `always`
- **THEN** the toggle proceeds **without** recording a trust decision, so folders the user merely toggled are not enrolled permanently
- **AND** when the configured default is `never`, the toggle is refused with an explanatory error and no prompt
- **AND** when the configured default is `ask`, a trust prompt is returned

#### Scenario: Tightening the default later stops applying prior disables
- **GIVEN** a folder disabled while the default was `always`, with no recorded decision
- **WHEN** the default is later changed to `ask` and a headless session starts in that folder
- **THEN** the folder resolves untrusted and the disable does not apply
- **AND** this consequence is documented rather than silently absorbed

#### Scenario: Untrusted folder returns trust options rather than writing
- **GIVEN** a cwd with no recorded decision and the default set to `ask`
- **WHEN** a `local`-scope toggle is requested
- **THEN** the response indicates trust is required
- **AND** it offers trusting the folder, trusting its parent folder, and declining
- **AND** `<cwd>/.pi/settings.json` is not modified

#### Scenario: Session-only trust is not offered
- **GIVEN** the trust options returned for a toggle
- **WHEN** they are inspected
- **THEN** no session-scoped option is present, because the setting being written outlives any session

#### Scenario: Approving trust persists the decision and applies the toggle
- **GIVEN** a `trust_required` response
- **WHEN** the user chooses one of the offered options
- **THEN** that option's updates are persisted through pi's trust store
- **AND** the original toggle is applied
- **AND** the resource reports the requested state

#### Scenario: Declining trust leaves everything unchanged
- **GIVEN** a `trust_required` response
- **WHEN** the user declines
- **THEN** no trust decision is recorded
- **AND** no settings file is written
- **AND** the control returns to its previous state

#### Scenario: A trusted folder is unaffected
- **GIVEN** a cwd already trusted
- **WHEN** a `local`-scope toggle is requested
- **THEN** no trust prompt is returned and the toggle is applied directly
