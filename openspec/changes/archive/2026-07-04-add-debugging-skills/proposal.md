## Why

The `eng-disciplines` package ships six cross-cutting skills, but all of them are *pre-failure* (`interview-me`, `doubt-driven-review`) or *quality* (`code-simplification`, `security-hardening`, `performance-optimization`, `observability-instrumentation`). None governs the moment a bug is already in front of you: **"how do I root-cause this, and how do I see runtime state a `console.log` can't reach."** That is a real gap for a project whose server runs TypeScript directly via jiti, whose bridge extension runs inside every pi session, and whose Electron main process, restart orchestrator, and dual WebSocket servers all hold state in closures.

Two skills from NousResearch's Hermes Agent (`skills/software-development/`, MIT) fill exactly this gap and port cleanly:

- **`systematic-debugging`** — a 4-phase root-cause discipline (Root Cause → Pattern → Hypothesis → Implementation) with a "Rule of Three" that hands off to the existing `doubt-driven-review` skill after three failed fixes. Pure prose; near-zero adaptation.
- **`node-inspect-debugger`** — drive Node's V8 inspector (breakpoints, step, call-stack, scope-chain dumps) from the terminal when `console.log` is not enough. Prose + one CDP helper script.

Adaptation was de-risked with a live spike on this repo's exact stack (Node 24.15.0, jiti 2.7.0): breakpoints set by `.ts` URL bind and hit at the correct `.ts` line, and live locals are readable at the paused frame — see `design.md` for the recorded evidence. The spike also **overturned the Hermes skill's headline pitfall**: jiti transpiles line-preserving and registers the compiled JS under the `.ts` URL, so there is no emitted-JS / sourcemap indirection to fight. The jiti launch story is simpler than the tsx story the upstream skill documents, which becomes a repo-specific value-add in the ported skill.

These are the only two of Hermes' ~19 in-repo skills worth porting; the rest either duplicate existing pi skills (`simplify-code`→`code-simplification`, `requesting-code-review`→`code-review`, `plan`→`openspec-explore`, `hermes-agent-skill-authoring`→`skill-creator`) or are domain integrations irrelevant to a session-monitoring dashboard (arXiv, Polymarket, OpenHue, PowerPoint, mlops, blockchain).

## What Changes

- Add `packages/eng-disciplines/.pi/skills/systematic-debugging/SKILL.md` — ported prose; the "tight feedback loop" example retargeted to this repo's documented convention (`npm test 2>&1 | tee /tmp/pi-test.log` then grep); `related_skills` repointed to `doubt-driven-review`, `code-review`, `observability-instrumentation`; upstream Hermes-only references dropped.
- Add `packages/eng-disciplines/.pi/skills/node-inspect-debugger/SKILL.md` — ported prose with a new **"pi-dashboard jiti launch"** section carrying the spike-verified recipe and the two spike-surfaced gotchas (see below). The `node inspect` REPL cheat-sheet and CDP tiers are preserved; the `python-debugpy` cross-reference is deleted (repo is TypeScript-only).
- Add `packages/eng-disciplines/.pi/skills/node-inspect-debugger/scripts/cdp-inspect.ts` — the Hermes CDP scope-walker rewritten in **TypeScript** (typed against `chrome-remote-interface`, or Node 24's global `WebSocket` with no extra dependency), invocable as `npx tsx cdp-inspect.ts <port> <ts-url> <line>` to attach, bind a `.ts` breakpoint, and dump the paused frame's local + closure scope.
- Register both skills in `packages/eng-disciplines/package.json` `pi.skills[]`, and extend that package's `description` + `keywords` to mention debugging.
- Update `packages/eng-disciplines/README.md` and `NOTICE` to attribute the two Hermes-derived skills (MIT, NousResearch/hermes-agent), consistent with the existing Addy-Osmani attribution.
- Add per-file rows for the new SKILL.md dirs + `cdp-inspect.ts` to the nearest directory `AGENTS.md` tree node (per the Documentation Update Protocol).
- **Non-goals**: no `python-debugpy` port (repo is TS-only); no `spike`/`test-driven-development` port (deferred — TDD is already AGENTS.md doctrine); no changes to the openspec pipeline skills; no runtime dependency added to the root `package.json` (the CDP helper prefers Node 24's global `WebSocket`).

## Capabilities

### New Capabilities

- `debugging-skills`: pi sessions in this repo gain a triggerable root-cause debugging discipline and a triggerable runtime-inspection skill; the runtime skill carries a spike-verified jiti launch recipe that binds breakpoints to `.ts` source; a TypeScript CDP helper script exists and attaches to a paused Node target; both skills are discovered via the standard pi skill loader with no per-machine setup.

### Modified Capabilities

(none)

## Impact

- **New files**: two `SKILL.md` dirs + `scripts/cdp-inspect.ts` under `packages/eng-disciplines/.pi/skills/`.
- **Modified**: `packages/eng-disciplines/package.json` (2 new `pi.skills[]` entries, description, keywords), `README.md`, `NOTICE`, one directory `AGENTS.md` tree node.
- **No runtime dependency** added to root `package.json`; the CDP helper prefers Node 24's global `WebSocket`. If `chrome-remote-interface` is chosen instead it is a `devDependency` of the `eng-disciplines` package only.
- **Context cost**: two additional skill descriptions in every pi session opened against this repo (~1 KB always-on; bodies load on demand via progressive disclosure).
- **Licensing**: both skills derive from NousResearch/hermes-agent (MIT); attribution added to `NOTICE`, matching the package's existing MIT-derivation pattern.
- **Package version**: minor bump of `@blackbelt-technology/pi-dashboard-eng-disciplines` (new skills, additive).
