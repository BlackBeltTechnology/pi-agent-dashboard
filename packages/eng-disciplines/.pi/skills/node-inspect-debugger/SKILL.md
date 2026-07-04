---
name: node-inspect-debugger
description: See runtime state a console.log cannot reach — set real breakpoints, step, and dump the scope chain of a paused Node/TypeScript process. Use on triggers like "set a breakpoint", "inspect runtime state", "console.log isn't enough", "step through this", "what's in this closure at runtime", "attach a debugger". Carries a jiti launch recipe verified against this repo's TypeScript loader. Not a logging or observability-setup workflow.
related_skills: systematic-debugging, observability-instrumentation
---

# Node Inspect Debugger

## Overview

`console.log` is a guess with a print statement attached — you have to already suspect *where* to look and *what* to print. A breakpoint inverts that: you stop the world at a line and read every local and closure variable in the frame, walk the call stack, and evaluate expressions in the paused context. When the bug lives in state a log can't cheaply reach — a closure captured three calls ago, a paused async frame, the Electron main process, the internals of a long-lived WebSocket server — the inspector is the tool.

This skill is the **TOOL** half of a pair; the **METHOD** is `systematic-debugging` (its Phase 1 "gather evidence" and Phase 3 "test one variable" are exactly when you reach for a breakpoint).

## When to Use

Reach for the inspector when the state you need is expensive or impossible to log:

- **The jiti server** (`packages/server`, TypeScript run directly via jiti) — request handlers whose failure depends on accumulated in-memory state.
- **The restart orchestrator / PTY workers** (`restart-helper.ts`) — a detached process whose closure state you can't `console.log` from the parent.
- **Dual WebSocket server closure state** — connection maps and buffers held in closures across the bridge and browser servers.
- **The Electron main process** — lifecycle/bootstrap state that never reaches a browser console.
- **The bridge extension** — code running inside every pi session, where adding logs means reloading every session.

If a single well-placed `console.log` would answer the question, use the log. The inspector earns its setup cost when the state is deep, closure-bound, or in a process you can't easily instrument.

## Two tiers

| Tier | Use when | Interface |
|------|----------|-----------|
| **REPL** (`node inspect`) | interactive, one-off, you're driving | the `node inspect` command REPL |
| **Programmatic CDP** | scripted, repeatable, or attaching from another process | `scripts/cdp-inspect.ts` (this skill) |

## Tier 1 — the `node inspect` REPL cheat-sheet

`node inspect` opens a REPL against the inspector. Core commands:

| Command | Does |
|---------|------|
| `sb('file.ts', N)` | set breakpoint at line N of `file.ts` (see jiti note below — `.ts` works directly) |
| `c` | continue to next breakpoint |
| `n` / `s` / `o` | step **n**ext / **s**tep-in / step-**o**ut |
| `bt` | backtrace (call stack of the paused frame) |
| `list(5)` | show 5 source lines around the pause point |
| `repl` | drop into a REPL evaluated in the paused frame's scope — inspect any local |
| `watch('expr')` | re-evaluate `expr` at every pause |
| `exec expr` | evaluate one expression in the paused frame |
| `restart` / `kill` | restart / kill the inspected process |

In `repl` mode you can read any in-scope variable by name — this is the fastest way to answer "what is `x` right now?".

## Tier 2 — pi-dashboard jiti launch (spike-verified)

This repo runs TypeScript **directly through jiti** (no `dist/*.js` build). Launch the target with the inspector and jiti's register hook:

```bash
node --inspect-brk=<port> --enable-source-maps --import <jiti-register-hook-url> cli.ts
```

- `--inspect-brk=<port>` halts at the very first line so you can set breakpoints before anything runs.
- `--enable-source-maps` is **not** required for line-level breakpoints (jiti is line-preserving, see pitfall below) but keep it: it gives exact **column** precision and correct `Error.stack` line numbers.

### Locating the jiti register hook (do not hard-code the path)

The register hook path differs across local / standalone / global installs. Resolve it the same way this repo's launcher (`packages/server/bin/pi-dashboard.mjs`) does — via `createRequire`, trying each supported jiti package:

```js
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const req = createRequire(import.meta.url);       // or createRequire(process.argv[1])
const JITI_PACKAGES = ["jiti", "@mariozechner/jiti"];
let hook;
for (const pkg of JITI_PACKAGES) {
  try {
    const pkgJson = req.resolve(`${pkg}/package.json`);
    hook = pathToFileURL(join(dirname(pkgJson), "lib", "jiti-register.mjs")).href;
    break;
  } catch { /* try next */ }
}
// pass `hook` to `node --import <hook> cli.ts`
```

### Attaching to the *live* server (not a fresh launch)

To debug the already-running server instead of a cold `--inspect-brk` launch, start it with the inspector enabled and discover the port:

```bash
NODE_OPTIONS="--inspect=0" pi-dashboard start        # 0 = pick a free port
curl -s http://127.0.0.1:<port>/json/list            # find the webSocketDebuggerUrl / port
```

`--inspect=0` avoids a port collision when something already holds the default `9229`.

## Pitfalls

### The upstream "emitted JS" pitfall does NOT apply to jiti — corrected

A common guide warns: *"breakpoints hit the emitted JS, not your `.ts`, and `node inspect` doesn't follow sourcemaps."* **This is false for this repo.** jiti transpiles **line-preserving** and registers the compiled JS **under the `.ts` URL** (1:1 line alignment). There is no separate `dist/*.js` file and no sourcemap indirection to fight.

Consequences you can rely on:

- `sb('cli.ts', 42)` in the plain `node inspect` REPL binds directly to line 42 of the `.ts` source and hits.
- `Debugger.setBreakpointByUrl('cli.ts', line)` over CDP binds to the `.ts` line.
- CDP may report `sourceMapURL: ""` (jiti attaches none) — this does **not** mean the breakpoint won't bind. It binds and hits anyway.

Do not port the emitted-JS workaround; it's solving a problem jiti doesn't create.

### Pending breakpoints return empty `locations` but still hit

A breakpoint set **before** the target script has parsed (e.g. right after the `--inspect-brk` halt) returns `locations: []` at set-time. **This is not a failure** — the breakpoint is deferred and resolves and hits once the script parses. Setting a breakpoint **after** the script has parsed returns populated `locations`. Do not treat an empty `locations` array at set-time as "the breakpoint didn't take."

## Programmatic CDP — `scripts/cdp-inspect.ts`

For scripted or repeatable inspection, this skill ships a dependency-free TypeScript helper. It uses Node 24's global `WebSocket` — no `chrome-remote-interface` dependency. It attaches to a paused target, sets a `.ts` breakpoint, resumes past the entry halt, and on the hit prints the paused frame plus every local and closure variable:

```bash
# 1. launch the target halted (see jiti recipe above), noting <port>
# 2. attach + break at a line inside a function:
npx tsx packages/eng-disciplines/.pi/skills/node-inspect-debugger/scripts/cdp-inspect.ts <port> <ts-url> <line>
# prints:  PAUSED at <file>:<line> fn=<name>
#          local    cfg = Object
#          local    doubled = 42
#          closure  label = "HELLO"
```

Use it as the ready-made "dump the frame" step whenever the REPL's interactivity isn't worth it.

## Verification

- [ ] The launch recipe used jiti's register hook resolved via `createRequire`, not a hard-coded path
- [ ] `.ts` breakpoints were set directly (no emitted-JS workaround)
- [ ] An empty `locations` at set-time was treated as deferred, not failed
- [ ] The paused frame's locals were read (via `repl`, `exec`, or `cdp-inspect.ts`) — the actual state, not a guess
