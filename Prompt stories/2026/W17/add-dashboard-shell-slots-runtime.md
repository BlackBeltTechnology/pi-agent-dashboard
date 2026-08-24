---
session: 019dc690
week: 2026/W17
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-dashboard-shell-slots-runtime, dashboard-plugin-architecture, add-extension-ui-modal, add-extension-ui-rjsf-form, add-landing-page-onboarding]
proposal_excerpt: "The umbrella proposal `dashboard-plugin-architecture` defines the **slot taxonomy** and **plugin loader contract** as design-only artifacts. That gives us the schema and the ADRs but no working code. Before any concre…"
---

# How we did it: Turn a design-only OpenSpec proposal into a working plugin runtime — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator ran the whole OpenSpec change lifecycle for `add-dashboard-shell-slots-runtime`
in one sitting. The kickoff prompt was the `/opsx:ff` slash command — *"Fast-forward
through artifact creation — generate everything needed to start implementation."* The
real objective, made concrete by the attached proposal, was this: the umbrella change
`dashboard-plugin-architecture` had already defined the **slot taxonomy** and **plugin
loader contract** as *design-only* artifacts — schema + ADRs, no working code. This
session's job was to turn that paper contract into a shipping runtime: a new
`packages/dashboard-plugin-runtime/` workspace, the shared types, a Vite named-import
registry, a server loader with an auth-gated REST endpoint, additive client slot
consumers, a demo plugin fixture, docs, and a full test suite — then archive the change
and sync its delta specs into the main specs so the four downstream `extract-*-as-plugin`
changes could start. It ran ~10h, produced 42 new files and 22 edits, and landed
59/59 tasks with +122 net-new passing tests.

## 2. TL;DR playbook

1. **Kick off with `/opsx:ff <change-name>`** on a change whose `proposal.md` already
   exists. Let the AI create `design.md`, the delta `specs/*/spec.md` files, and
   `tasks.md`, then `openspec validate <change> --strict` until clean.
2. **Read the real code before writing tasks.** The AI front-loaded ~15 `grep`/`sed`/`cat`
   probes of `config.ts`, `browser-protocol.ts`, `bridge-register.ts`, `system-routes.ts`,
   and the vitest configs so `design.md` referenced actual symbols, not guesses.
3. **Split the work: new isolated package first, additive edits to the app last.** Build
   `packages/dashboard-plugin-runtime/` (registry, validator, context, consumers, server
   loader, Vite plugin) with its own tests before touching `App.tsx`.
4. **Run `/opsx:apply <change>`** and let it walk `tasks.md` in numbered batches
   (1.x shared types → 2.x runtime package → … → 11.x verify), writing a test with each
   unit of code.
5. **Make client integration strictly additive** — wrap existing JSX in
   `PluginContextProvider`, drop `<*Slot>` consumers *alongside* existing conditionals,
   never replace them.
6. **When slot consumers break unrelated tests, degrade gracefully, don't throw** — use a
   `useSlotRegistryOrNull()` hook so a consumer rendered outside a provider renders
   nothing instead of crashing sibling component tests.
7. **Separate pre-existing test failures from yours** by baselining the count first
   (2897 passing before → 3019 after; the 69 red were all pre-existing).
8. **Finish with `/opsx:archive <change>`** — it syncs the delta specs into the TBD-stub
   main specs and moves the change to `openspec/changes/archive/<date>-<name>/`.

## 3. How the collaboration unfolded

**Phase 1 — Artifact fast-forward (`/opsx:ff`).** The AI read the existing `proposal.md`,
probed the runtime targets, then wrote `design.md` (16 numbered decisions), two delta
spec files, and `tasks.md` (59 tasks). It looped `openspec status --json` and
`openspec validate --strict` until the change was apply-ready. *Why it worked:* the
design decisions cited real symbols because the model grounded itself in the codebase
first rather than inventing an API.

**Phase 2 — Implement (`/opsx:apply`), package-first.** The AI built the isolated
`dashboard-plugin-runtime` package end-to-end — `slot-registry.ts`, `manifest-validator.ts`,
`plugin-context.tsx`, `slot-consumers.tsx` + `slot-error-boundary.tsx`, the server
`loader.ts`/`config-validator.ts`, and the Vite plugin — each paired with a colocated
`__tests__/*.test.ts(x)`. Shared types (`slot-types.ts`, `manifest-types.ts`,
`slot-props.ts`, `plugin-status.ts`) went into `packages/shared` with a type-level
coverage test and a `plugin_config_update` addition to the protocol union.

**Phase 3 — Additive app wiring.** Only after the package was green did the AI touch
`App.tsx`, `SessionCard.tsx`, `SessionList.tsx`, `SettingsPanel.tsx`. Every change was
additive: wrap the tree in `PluginContextProvider`, add `ContentViewSlot` /
`ContentHeaderStickySlot` / `ContentInlineFooterSlot` / settings-section slots *next to*
existing conditionals, and handle `plugin_config_update` in the WebSocket message handler.

**Phase 4 — Verify + de-risk regressions.** Running the suite surfaced two failure
classes. The AI correctly split them: *pre-existing* (`localStorage.clear is not a
function` jsdom mocks, `browse-endpoint` `isGit`/`isPi`) vs *newly introduced* (sibling
component tests crashing because slot consumers threw outside a provider). It fixed only
the latter, then baselined the counts to prove no net regression.

**Phase 5 — Archive + spec sync (`/opsx:archive`).** A `general-purpose` subagent synced
the two delta specs into their TBD-stub main specs, then the change was archived to
`openspec/changes/archive/2026-04-26-add-dashboard-shell-slots-runtime/`. The closing
note unblocked the four downstream `extract-*-as-plugin` changes.

## 4. Prompts that worked

- **The goal prompt — `/opsx:ff <change-name>`.** Effective *because a `proposal.md`
  already existed*: fast-forward is only safe when the intent is already captured. On a
  change with no proposal, run `/opsx:new` (or `openspec-explore`) first — `ff` will
  otherwise invent scope.
- **`/opsx:apply <change>`** — the high-leverage unlock. One command drove all 59 tasks
  because `tasks.md` was already numbered and dependency-ordered from Phase 1. The quality
  of `apply` is bought entirely by the quality of `tasks.md`.
- **`/opsx:archive <change>`** — the closer. It does the spec-sync + move atomically, so
  the delta specs don't rot as unmerged stubs.

The three prompts are the standard OpenSpec lifecycle (`ff → apply → archive`). The lesson
for a future operator: you don't need to hand-hold each task — you need to invest in the
*proposal* and let the three commands carry it. A stronger kickoff states the boundary
explicitly, e.g. *"`/opsx:ff add-dashboard-shell-slots-runtime` — runtime only; leave the
OpenSpec/Flows/Subagents/Git slot extractions for follow-up changes."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Let new slot consumers **throw** when rendered outside `PluginContextProvider`, crashing unrelated `SessionCard`/`SessionList`/`SettingsPanel` tests | Redirect to graceful degradation via `useSlotRegistryOrNull()` — render nothing when no registry | State up front: *"client integration must be strictly additive and safe outside a provider"* |
| Assume all red tests were its fault | Force a **baseline** (2897 before → 3019 after) so pre-existing failures aren't chased | Capture the passing count before touching code; diff after |
| Reach for `piGateway.registerHandler` / `browserGateway.registerHandler` that **don't exist** | Simplify to no-op server integration (plugins hook via the gateway's `onEvent`) | Verify a method exists (`grep`) before wiring it |
| Import the runtime package **by name** in `vite.config.ts` before it was built | Switch to a direct path import | For unbuilt workspace deps, path-import until the package is published/built |

Two subtle self-corrections worth repeating: (1) a JSDoc comment containing the glob
`packages/*/package.json` **closed the block comment early** at the `*/` — the AI found and
escaped it across `loader.ts`, the vite-plugin, and `manifest-validator.ts`; (2) Ajv
config validation was left as a contract stub because Ajv already lives on the Fastify
side, avoiding a duplicate dependency.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved this session — it was a straight execution of the
OpenSpec lifecycle. The reusable asset it *produced* is the pattern itself, plus the
`packages/demo-plugin/` fixture (a private, `fixture`-flagged plugin) that future
`extract-*-as-plugin` changes can copy as a working reference implementation.

Worth codifying as a project skill: **"OpenSpec runtime-from-design-proposal"** — the
package-first / additive-app-last / graceful-degradation-in-consumers sequence that keeps
a large change from regressing the existing app. When the next `extract-*-as-plugin`
change starts, invoke that sequence rather than re-deriving it.

## 7. Pitfalls & dead ends

- **`*/` inside a JSDoc block comment** (from a `packages/*/package.json` glob) silently
  terminates the comment and produces a cryptic esbuild parse error at a wrong-looking
  column. If a `.ts` file fails to parse near a comment, search for `*/` in string/glob
  literals inside comments.
- **Slot consumers that throw outside their provider** cascade into unrelated component
  tests. Any context-dependent component that other components render must degrade to a
  no-op when its context is absent.
- **Non-existent gateway methods.** `piGateway`/`browserGateway` have no `registerHandler`;
  don't wire to an API you haven't grepped for.
- **Importing an unbuilt workspace package by name** in a Vite config fails; use a path
  import until it's built.
- **Conflating pre-existing red tests with your own** wastes time — always baseline first.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change directory with a real `proposal.md`; the
umbrella design change it derives from (for slot taxonomy + loader contract); a green
`npm test` baseline count.

- [ ] Confirm `proposal.md` exists, then `/opsx:ff <change-name>` → design.md, delta
      specs, tasks.md; `openspec validate <change> --strict` clean.
- [ ] Grep the real runtime targets (`config.ts`, `browser-protocol.ts`,
      `bridge-register.ts`, `system-routes.ts`, vitest configs) *before* the AI writes tasks.
- [ ] `/opsx:apply <change>` — build the isolated `packages/dashboard-plugin-runtime/`
      package with colocated tests first.
- [ ] Wire the app **additively** (`PluginContextProvider` + `<*Slot>` alongside existing
      JSX); consumers degrade to no-op outside a provider (`useSlotRegistryOrNull`).
- [ ] Baseline the passing test count; after changes, diff to separate new vs pre-existing
      failures.
- [ ] `/opsx:archive <change>` — sync delta specs into main specs, move to
      `openspec/changes/archive/<date>-<name>/`.

**Artifacts produced:** `openspec/changes/add-dashboard-shell-slots-runtime/{design.md,
tasks.md, specs/*}`; new `packages/dashboard-plugin-runtime/` (registry, validator,
context, consumers, server loader, Vite plugin, README); shared types under
`packages/shared/src/dashboard-plugin/`; `packages/server/src/routes/plugin-config-routes.ts`;
`packages/demo-plugin/`; updated `AGENTS.md`, `docs/architecture.md`, `README.md`; archived
change at `openspec/changes/archive/2026-04-26-add-dashboard-shell-slots-runtime/`.

---

_Generated from session `019dc690` · `pi-agent-dashboard` · 2026-07-24._
