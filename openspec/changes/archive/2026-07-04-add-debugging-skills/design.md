# Design — add-debugging-skills

## Why a pair, not two isolated skills

The two skills are a methodology + tool pair. `systematic-debugging` tells you *when* to reach for the inspector (Phase 1 "gather evidence", Phase 3 "test one variable at a time"); `node-inspect-debugger` is *how* you get evidence a `console.log` cannot reach. They form a closed loop with a skill pi already ships:

```
   systematic-debugging          node-inspect-debugger
   (METHOD, prose)               (TOOL, prose + TS CDP script)
   ┌───────────────────┐         ┌────────────────────────┐
   │ 1 Root Cause      │         │ console.log not enough? │
   │ 2 Pattern match   │───────▶ │ real breakpoints:       │
   │ 3 Hypothesis      │  when   │  sb() bt repl watch()   │
   │ 4 Regr test + fix │  step3  │  scope-chain dump       │
   └───────────────────┘  needs  └────────────────────────┘
        │  runtime state
        ▼
   Rule of Three ─▶ ≥3 failed fixes = STOP, question architecture
                    └─▶ hands off to doubt-driven-review (already in repo)
```

Porting them together closes pi-dashboard's post-failure debugging gap and reuses the existing `doubt-driven-review` entry condition rather than inventing a new one.

## Spike evidence (recorded, reproducible)

Run on this repo's exact stack: **Node v24.15.0, jiti 2.7.0**, launch model `node --import <jiti/lib/jiti-register.mjs> cli.ts`.

Minimal target (`widget2.ts`), breakpoint set by `.ts` URL, driven over CDP with Node 24's global `WebSocket`:

| Probe | Command shape | Result |
|-------|---------------|--------|
| 1 — sourcemap → Error.stack | `node --enable-source-maps --import <reg> widget.ts` | stack shows `widget.ts:6:11`, `widget.ts:10:1` — **exact `.ts` line+col** |
| 2 — breakpoint binds | `Debugger.setBreakpointByUrl('widget.ts', line6)` | binds → `locations:[{lineNumber:5,columnNumber:4}]` (the `throw`, 4-space indent) |
| 4 — breakpoint HITS + live state | resume past `--inspect-brk` entry halt, wait for hit | `PAUSED at .ts:5 fn=build`; locals `cfg=Object doubled=42 label=HELLO` |

### Decisive finding — the Hermes pitfall does not apply to jiti

CDP reports `sourceMapURL: ""` (jiti attaches no sourcemap URL to the parsed script), yet the `.ts` breakpoint still binds and hits. Reason: **jiti transpiles line-preserving and registers the compiled JS under the `.ts` URL** (1:1 line alignment). There is no separate `dist/*.js` file and no sourcemap indirection. The Hermes upstream skill's headline pitfall —

> "Breakpoints hit the emitted JS, not the `.ts` … `node inspect` CLI does not follow sourcemaps."

— is **false for pi-dashboard**. `sb('cli.ts', 42)` in the plain `node inspect` REPL works directly. The ported skill must correct this, not copy it.

### Two gotchas the spike surfaced (must appear in the ported skill)

1. **Launch recipe (jiti, not tsx):**
   `node --inspect-brk=<port> --enable-source-maps --import <path>/jiti/lib/jiti-register.mjs cli.ts`
   Keep `--enable-source-maps`: not needed for line-level breakpoints (jiti is line-preserving) but it gives exact **column** precision and correct `Error.stack`.
2. **Pending-breakpoint nuance:** a breakpoint set *before* the target script parses returns `locations: []` (deferred) — it still resolves and hits once the script parses. Do **not** read empty `locations` at set-time as a failure. Setting after parse returns populated `locations`.

## CDP helper: TypeScript, dependency-free by default

`scripts/cdp-inspect.ts` rewrites the Hermes JS scope-walker in TypeScript. Node 24 exposes a global `WebSocket`, so the helper needs **no** `chrome-remote-interface` dependency — it fetches `http://127.0.0.1:<port>/json/list`, opens the `webSocketDebuggerUrl`, enables `Debugger`+`Runtime`, sets a breakpoint by `.ts` URL, resumes past the entry halt, and on the hit walks `callFrames[0].scopeChain` dumping `local`/`closure` properties. This keeps the "adapt = TypeScript" requirement satisfied with zero new runtime deps. If a richer client is wanted, `chrome-remote-interface` is added as a `devDependency` of `eng-disciplines` only — never to root.

## Alternatives considered

- **Port all 9 Hermes software-dev skills** — rejected: 4 duplicate existing pi skills, `python-debugpy` is irrelevant (TS-only repo), `spike`/`plan`/`tdd` overlap `openspec-explore` + AGENTS.md doctrine. Only these 2 are net-new.
- **Inline the debugging guidance into AGENTS.md** — rejected: AGENTS.md is always-on context (every byte costs tokens); these are NL-triggered skills that should load on demand, which is exactly what the skill loader gives for free.
- **New standalone package** — rejected: `eng-disciplines` is the established home for cross-cutting discipline skills; adding two dirs + two `pi.skills[]` entries is the minimal surface.

## Open risks

- **jiti launch invocation across install shapes.** Spike used the local `node_modules/jiti/lib/jiti-register.mjs`. Standalone/global installs resolve the register hook via `packages/server/bin/pi-dashboard.mjs`'s logic; the skill should document how to locate the hook (`createRequire(...).resolve` of the register mjs) rather than hard-coding a path. Low risk — the resolution logic already exists in the repo.
- **Attaching to the *live* server** (vs a fresh `--inspect-brk` launch) needs the server started with `--inspect`; document `NODE_OPTIONS="--inspect=0"` + `curl /json/list` to find the port, consistent with the spike's port-collision note.
