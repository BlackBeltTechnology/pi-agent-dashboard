# Test Plan — project-scope-disable-global-resources

Stage: design   Generated: 2025-08-05

Gate: HARD — resolved. Three unfillable slots were closed by decision before this catalog was written:
toggle latency budget (p95 < 1s), trust-persistence failure (refuse and surface), and toggle
serialization (construct inside the lock, pinned as a requirement).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | classified by resolved path | boundary (nesting) | L1 | automated | `cwd` == `$HOME`, so `<cwd>/.pi` is an ancestor of `~/.pi/agent`; a skill at `~/.pi/agent/skills/foo/SKILL.md` | classify at `local` scope | origin is `global-loose`, not `project-loose` |
| E2 | classified by resolved path | state-transition (post-mutation) | L1 | automated | a global skill already disabled, which pi now reports `scope: project, source: local, baseDir: undefined` | classify again for re-enable | origin is `global-loose`, identical to the pre-disable classification |
| E3 | classified by resolved path | equivalence partition | L1 | automated | an npm package installed at `~/.pi/agent/npm/node_modules/probe/skills/a/SKILL.md`, i.e. under the global base | classify at `local` scope | origin is `package`, not `global-loose` |
| E4 | classified by resolved path | edge (symlink) | L1 | automated | a global skill whose real path resolves inside the checkout via a symlink | classify at `local` scope | classification and the resource lookup agree; the written entry disables the resource |
| E5 | pi-standard form per origin | decision table | L1 | automated | `<cwd>/.pi/skills/local-demo/SKILL.md` | disable at `local` | `skills` gains `-skills/local-demo/SKILL.md`; `packages` untouched |
| E6 | pi-standard form per origin | decision table | L1 | automated | a skill whose base dir is `<ancestor>/.agents` | disable at `local` | force-exclude is relative to `<ancestor>/.agents`; resolver reports it disabled |
| E7 | pi-standard form per origin | decision table | L1 | automated | `~/.pi/agent/skills/foo/SKILL.md` (directory-shaped) | disable at `local` | `skills` gains that **file** path (tilde form) plus an anchored exclusion; `~/.pi/agent/settings.json` untouched; resolver reports disabled |
| E8 | pi-standard form per origin | decision table (shape) | L1 | automated | a bare `.md` skill directly under `~/.pi/agent/skills` | disable at `local` | entry written is that file, not the root; every sibling in the root stays enabled at `user` scope |
| E9 | pi-standard form per origin | decision table (type) | L1 | automated | a global prompt (always a flat file in a shared root) | disable at `local` | resolver reports it disabled; other prompts remain enabled |
| E10 | pi-standard form per origin | decision table (type) | L1 | automated | a global theme (always a flat file in a shared root) | disable at `local` | resolver reports it disabled; other themes remain enabled |
| E11 | pi-standard form per origin | portability | L1 | automated | a settings file produced by disabling a global skill under `$HOME=A` | resolve the same file under `$HOME=B`, where the equivalent skill exists | resolver reports it disabled; no written entry contains a machine-specific absolute path |
| E12 | pi-standard form per origin | BVA (unsupported layout) | L1 | automated | an agent directory located outside the home directory | disable a global-loose resource under it at `local` | request rejected with an error naming the unsupported layout; nothing written |
| E13 | delta carries `autoload:false` | decision table | L1 | automated | `npm:probe-pkg` declared only globally, contributing `alpha` and `beta` | disable `beta` at `local` | `packages` gains `{source, autoload:false, skills:["-skills/beta/SKILL.md"]}`; not a 404 |
| E14 | delta carries `autoload:false` | falsification | L1 | automated | the same delta entry written **without** `autoload:false` | resolve | the package contributes nothing — asserts why the flag is mandatory |
| E15 | delta project-scope only | decision table (scope) | L1 | automated | `~/.pi/agent/settings.json#packages` holds the bare string `"npm:probe-pkg"` | disable `beta` at `global` | the entry is mutated in place to object form with a plain filter; no `autoload`; no second entry; `beta` disabled, `alpha` enabled |
| E16 | delta carries `autoload:false` | sibling isolation | L1 | automated | the delta from E13 | resolve | `alpha` enabled, `beta` disabled |
| E17 | delta carries `autoload:false` | side-effect check | L1 | automated | the delta from E13 for an `npm:` source installed under the user agent dir | resolve | no project-scope package directory is created |
| E18 | matched by normalised identity | equivalence partition | L1 | automated | project `packages` holds `{source:"npm:foo@^1.0.0", skills:["+skills/alpha/SKILL.md"]}` | disable a skill from `npm:foo@^2.0.0` at `local` | the existing entry is extended; its `+` filter preserved; no duplicate appended |
| E19 | matched by normalised identity | equivalence partition | L1 | automated | project declares a package by SSH git URL; the same repo is declared globally by HTTPS | disable a resource from it at `local` | recognised as one package; no duplicate entry |
| E20 | project-owned entry not converted | decision table | L1 | automated | project `packages` holds `{source:"<repo>", extensions:["+packages/kb-extension/src/index.ts"]}` | disable a skill contributed by `<repo>` at `local` | that entry gains the skill exclusion; its `extensions` filter preserved; it does **not** gain `autoload:false` |
| E21 | re-enable removes, writes nothing | round trip | L1 | automated | a settings file in a known state, for each of the four origins | disable then re-enable | resolver reports the same enabled flag for every resource as before the disable |
| E22 | re-enable removes, writes nothing | falsification | L1 | automated | any disabled resource | re-enable | no `+` force-include entry exists for it afterwards |
| E23 | re-enable removes, writes nothing | pair removal | L1 | automated | a global skill disabled by this dashboard, with an ownership record | re-enable | both the file entry and the exclusion are removed; the resource reports its original global scope; the ownership record is cleared |
| E24 | re-enable removes, writes nothing | boundary (partial empty) | L1 | automated | a delta excluding one skill and one extension | re-enable the skill | the skill exclusion is removed; the entry survives with its extension exclusion; that extension stays disabled |
| E25 | ownership recorded outside settings | decision table (ownership) | L1 | automated | a project `skills` array holding a user-authored plain entry for a global resource, with no ownership record | disable then re-enable through the dashboard | the dashboard's exclusion is removed; the user's plain entry remains; resolver reports the resource enabled |
| E26 | ownership recorded outside settings | decision table (ownership) | L1 | automated | a global resource disabled through the dashboard, with an ownership record | re-enable | plain entry and exclusion both removed; record cleared |
| E27 | ownership recorded outside settings | invariant | L1 | automated | any completed toggle | inspect `<cwd>/.pi/settings.json` | it contains only keys pi itself interprets |
| E28 | ownership recorded outside settings | invariant | L1 | automated | any completed toggle | count settings-file writes | exactly one write to the settings file; the ownership record is written separately |
| E29 | equivalence-class strip | equivalence partition | L1 | automated | project `skills` holds `-skills/foo` written by pi's own config selector | enable `skills/foo/SKILL.md` through the dashboard | the stale entry is removed; resolver reports the resource enabled |
| E30 | equivalence-class strip | falsification | L1 | automated | project `skills` holds both `!skills/foo/SKILL.md` and `+skills/foo/SKILL.md`, so the resource is enabled | disable then re-enable through the dashboard | the `+` entry is still present; resolver reports the resource enabled, as before |
| E31 | equivalence-class strip | boundary (glob) | L1 | automated | project `skills` holds a user-authored `!skills/**` covering many resources | toggle one resource it covers | the `!skills/**` entry remains; the other resources it covers stay disabled |
| E32 | scope guard directional | decision table | L1 | automated | `{scope:"global", cwd, type:"skill", filePath:"<cwd>/.pi/skills/local-demo/SKILL.md"}` | submit the toggle | `400` naming the scope mismatch — **not** `404`; neither settings file written |
| E33 | scope guard directional | decision table | L1 | automated | a global skill | toggle at `local` scope | not rejected by the guard |
| E34 | ambiguity escalation | equivalence partition (collision) | L1 | automated | `<cwd>/.pi/skills/shared/SKILL.md` and `<ancestor>/.agents/skills/shared/SKILL.md`, identical relative to their own bases | disable one at `local` | an exclusion anchored on that resource's base leaf is written, containing no home or checkout path; no re-declaration; the other skill stays enabled |
| E35 | untrusted folder prompts | state-transition | L1 | automated | a cwd with a recorded trusted decision | toggle at `local` | applied directly; no prompt |
| E36 | untrusted folder prompts | state-transition | L1 | automated | a cwd with a recorded refusal | toggle at `local` | refused with an explanatory error; nothing written |
| E37 | untrusted folder prompts | decision table | L1 | automated | a cwd with no recorded decision, under each `defaultProjectTrust` value | toggle at `local` | `always` → proceeds **without** recording; `never` → refused, no prompt; `ask` → `trust_required` returned |
| E38 | untrusted folder prompts | boundary (implicit trust) | L1 | automated | a cwd with **no** `.pi` directory, which pi loads as implicitly trusted, default `ask` | toggle at `local` | a prompt is returned rather than silently proceeding |
| E39 | untrusted folder prompts | regression (catch-22) | L1 | automated | the E38 folder, after the user approves trust and the toggle is applied | resolve as a newly-started headless session | the resource is reported disabled — the write survives the folder becoming trust-requiring |
| E40 | serialized toggles observe prior write | concurrency | L1 | automated | a folder with two enabled resources | disable both in immediate succession without awaiting the first response | the settings file holds both entries; resolver reports both disabled |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | toggle round trip | tail-latency | L1 | automated | a workspace with this repo's resource count — 40+ skills, 16 extensions, 11 packages — one `applyResourceToggle` per iteration | p95 < 1s per toggle | 50 iterations |
| P2 | equivalence-class strip | soak / growth | L1 | automated | the same resource disabled and re-enabled 100 times | the settings array returns to its starting length each cycle; no unbounded accretion | 100 cycles |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | trust dialog | state-convergence | L3 | automated | folder Resources surface for a folder with no recorded trust decision | user disables a resource | a dialog presents the supplied options; the control has **not** converged to disabled |
| F2 | trust dialog | state-transition (illegal edge) | L3 | automated | the trust dialog open | user dismisses without choosing | control converges back to its previous state; no settings or trust file written |
| F3 | toggle failures surfaced | state-convergence | L3 | automated | a toggle the server rejects with an error message | response received | control reverts **and** the server's message is presented; a request that never reached the server is reported distinctly |
| F4 | row stays where acted on | state-transition | L3 | automated | a global resource listed in the global section of the folder surface | user disables it, then re-enables it | after disable the row stays in the section acted in and indicates the folder controls activation; after re-enable the original grouping is restored |
| F5 | repository-wide notice | invariant | L3 | automated | the folder Resources surface | user disables a resource | the surface states the change is written to the repository's tracked `.pi/settings.json` and shared, including that each toggle produces a whole-file diff |
| F6 | trust dialog wording | visual/subjective | — | manual-only | the trust dialog | a human reads it alongside pi's own trust prompt | [judgment: the wording is recognisably equivalent to pi's and does not imply a different security decision — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | successful response means reflected | fault-injection (corrupt input) | L1 | automated | `<cwd>/.pi/settings.json` is unparseable, so pi retains a load error and silently skips the write | any toggle | an error identifying the unparseable settings file; **not** a success |
| X2 | untrusted folder prompts | fault-injection (abort) | L1 | automated | `ProjectTrustStore.set` throws after the user approves | approval submitted | the toggle is refused and the trust-write failure surfaced; no settings written — never write settings without a recorded decision |
| X3 | concurrent external edits | fault-injection (external writer) | L1 | automated | another process rewrites the same settings array between a toggle's construction and its flush | toggle completes | the documented last-writer-wins outcome holds; the loss is confined to that array and does not corrupt the file |
| X4 | successful response means reflected | fault-injection (dependency abort) | L1 | automated | pi's `PackageManager.resolve()` throws | any toggle | the toggle fails with an error; no settings file is written; no partial entry remains |

---

## Coverage summary

- Requirements covered: 16/16
- Scenarios by class: edge 40 · perf 2 · frontend 6 · error 4
- Scenarios by level: L1 46 · L2 0 · L3 5 · manual-only 1
- Scenarios by disposition: automated 51 · manual-only 1

## New infra needed

None. L1 lands in `packages/server/src/__tests__/` and `packages/client/src/**/__tests__/` (vitest);
L3 lands in `tests/e2e/*.spec.ts` against the docker harness on its derived
`.pi-test-harness.json#dashboardPort`. No L2 rows: nothing here is an install/multi-OS runtime
concern, and no rendered-UI assertion may live in a `qa/` smoke row.
