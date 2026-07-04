## 1. systematic-debugging skill

- [x] 1.1 Create `packages/eng-disciplines/.pi/skills/systematic-debugging/SKILL.md`, porting the Hermes 4-phase structure (Root Cause → Pattern → Hypothesis → Implementation), phase success-criterion gates, the Feedback Loop Rule, the Rule of Three, the Red Flags section, and the pre-flight checklist
- [x] 1.2 Rewrite the "tight feedback loop" example to this repo's documented convention: `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error' /tmp/pi-test.log` (matches AGENTS.md "Running Tests")
- [x] 1.3 Set frontmatter `name`, `description` (NL triggers: "root cause this", "why is this failing", "debug systematically"), and `related_skills` → `doubt-driven-review`, `code-review`, `observability-instrumentation`; drop upstream Hermes-only references (`subagent-driven-development`)
- [x] 1.4 Make the Rule-of-Three handoff explicit: at ≥3 failed fixes, defer to the `doubt-driven-review` skill to question the architecture

## 2. node-inspect-debugger skill

- [x] 2.1 Create `packages/eng-disciplines/.pi/skills/node-inspect-debugger/SKILL.md`, preserving the `node inspect` REPL cheat-sheet (`sb`, `bt`, `list`, `repl`, `watch`, `exec`) and the two tiers (REPL vs programmatic CDP)
- [x] 2.2 Add a **"pi-dashboard jiti launch"** section with the spike-verified recipe: `node --inspect-brk=<port> --enable-source-maps --import <jiti/lib/jiti-register.mjs> cli.ts`; document locating the register hook via `createRequire` (not a hard-coded path) so it works across local/standalone/global installs
- [x] 2.3 **Correct** the upstream "breakpoints hit emitted JS / node inspect ignores sourcemaps" pitfall: state that jiti is line-preserving and registers compiled JS under the `.ts` URL, so `.ts` breakpoints bind directly and `sb('cli.ts', N)` works in the plain REPL
- [x] 2.4 Document the pending-breakpoint nuance: a breakpoint set before the target script parses returns `locations: []` but still resolves and hits
- [x] 2.5 Retarget the "When to Use" bullets at real repo surfaces: server (jiti) request handlers, `restart-helper.ts` detached orchestrator + PTY workers, dual WebSocket server closure state, Electron main process, bridge extension
- [x] 2.6 Add the live-attach path: server started with `NODE_OPTIONS="--inspect=0"`, then `curl -s http://127.0.0.1:<port>/json/list` to find the target
- [x] 2.7 Delete the `python-debugpy` cross-reference; set frontmatter `name`, `description` (NL triggers: "set a breakpoint", "inspect runtime state", "console.log isn't enough"), `related_skills` → `systematic-debugging`

## 3. TypeScript CDP helper

- [x] 3.1 Create `packages/eng-disciplines/.pi/skills/node-inspect-debugger/scripts/cdp-inspect.ts` using Node 24's global `WebSocket` (no new runtime dependency): fetch `/json/list`, open `webSocketDebuggerUrl`, enable `Debugger`+`Runtime`, `setBreakpointByUrl(<ts-url>, <line>)`, `runIfWaitingForDebugger`, resume past the entry halt, and on the hit walk `callFrames[0].scopeChain` dumping `local`/`closure` props
- [x] 3.2 CLI shape: `npx tsx cdp-inspect.ts <port> <ts-url> <line>`; print `PAUSED at <file>:<line> fn=<name>` then one line per local/closure var
- [x] 3.3 Reference `cdp-inspect.ts` from the SKILL.md "programmatic CDP" tier as the ready-made helper
- [x] 3.4 Verify the helper against a throwaway target (same shape as the spike) and confirm it prints live locals at a `.ts` breakpoint — DEFERRED: needs installed deps + a running jiti target; this worktree has no `node_modules`. ACCEPTED-DEFERRED by user at archive time; verify on dev machine later. Mechanism already proven by the recorded spike in design.md.

## 4. Package wiring

- [x] 4.1 Add `".pi/skills/systematic-debugging"` and `".pi/skills/node-inspect-debugger"` to `pi.skills[]` in `packages/eng-disciplines/package.json`
- [x] 4.2 Extend the package `description` and `keywords` to mention debugging / root-cause / node-inspect
- [x] 4.3 Version bump of `@blackbelt-technology/pi-dashboard-eng-disciplines` (0.5.4 → 0.5.6, patch)
- [x] 4.4 Ensure `scripts/` under the new skill is covered by the package `files[]` glob (`.pi/skills/` already included)

## 5. Attribution + docs

- [x] 5.1 Add NousResearch/hermes-agent (MIT) attribution for both skills to `packages/eng-disciplines/NOTICE` and `README.md`, matching the existing Addy-Osmani derivation pattern
- [x] 5.2 Add per-file rows for `systematic-debugging/SKILL.md`, `node-inspect-debugger/SKILL.md`, and `node-inspect-debugger/scripts/cdp-inspect.ts` to the nearest directory `AGENTS.md` tree node (caveman style; path-alphabetical); scaffold the node via `kb dox init` if absent

## 6. Verification

- [x] 6.1 `openspec validate add-debugging-skills` exits 0
- [x] 6.2 Restart an active pi session in this repo; confirm both skills appear in the available-skills listing and load full bodies on invocation — VERIFIED: `pi install`ed globally (0.5.6); both skills present with valid `name:` frontmatter (systematic-debugging 128 lines, node-inspect-debugger 135 lines); cdp-inspect.ts shipped.
- [x] 6.3 Confirm no new dependency landed in the root `package.json` (CDP helper uses global `WebSocket`)
- [x] 6.4 `npm run quality:changed` passes (biome + tsc on `cdp-inspect.ts` + tests) — PARTIAL: biome clean on `cdp-inspect.ts` (verified via `npx @biomejs/biome`); tsc + tests ACCEPTED-DEFERRED by user at archive time (no `node_modules` here; change adds only skill files + package.json entries, no source imports, so the suite is unaffected).
