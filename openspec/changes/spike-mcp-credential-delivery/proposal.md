## Why

`wire-mcp-session-token` tried to specify how a local pi session gets a working
`/mcp` credential. Two doubt-review cycles falsified two successive delivery
mechanisms, and **both failures were invisible from this repo's source**. They
only surfaced by reading `pi-mcp-adapter` internals:

- Cycle 1 killed *"the `requestHeadersCommand` resolves the calling session"* —
  the spawned child gets only inherited env plus a stdin envelope, and `mcp.json`
  is Pi-global, so every session provisions an identical command line.
- Cycle 2 killed the correction — `interpolateEnvVars` (`utils.ts:76-81`) expands
  `${VAR}` / `$env:VAR` / `{env:VAR}` but **not** bare `$VAR`, and the working
  form expands into `command`/`args`, putting the plaintext bearer into spawn
  **argv** (`ps`-visible, and scooped up by the adapter's own `ps axeww` scan).

The pattern is the finding: the delivery mechanism cannot be settled by design
reasoning against this adapter. Each rewrite guessed at adapter behaviour and was
wrong in a different way. This change stops guessing and **measures** instead, so
the next attempt at `wire-mcp-session-token` writes its decision once, against
observed facts.

`wire-mcp-session-token` is parked until this reports.

## What Changes

Nothing ships. This is an investigation whose deliverable is a **findings
document** (`findings.md`) recording measured answers, each with the command or
probe that produced it and the observed output. No production code, no spec
deltas, no behaviour change.

Questions to settle, all carved from the two doubt cycles:

- **Q1 — interpolation + argv exposure.** Which interpolation forms actually
  expand, in which of `command` / `args` / `env`? Does an expanded secret land in
  the child's argv where `ps` can read it? Is there any form that delivers a
  secret to the child **without** it appearing in argv?
- **Q2 — invocation model.** Is the command invoked per HTTP request or once per
  connection? Does the child observe a **runtime mutation** of the parent pi
  process's `process.env`, or is the env snapshotted at connect? How many
  invocations does one tool call cost, and what is the wall-clock overhead?
- **Q3 — 401 and restart recovery.** For a non-OAuth HTTP entry, what does the
  adapter do on a 401 — throw, back off, auto-retry, disable the entry? Does it
  ever re-invoke the header command after a 401? How long until a stranded
  session recovers on its own, if ever?
- **Q4 — a non-broadcast delivery channel.** `plugin_emit_event` re-emits onto
  `pi.events` with no subscriber restriction (`bridge.ts:1312-1318`), so any
  extension in the session could read a credential sent that way. Does a
  session-private server→extension channel exist, or must one be added?

Each question resolves to **measured / not-measurable / needs-new-mechanism**,
never to an inference.

## Capabilities

### New Capabilities

(none — an investigation, no shipped behaviour)

### Modified Capabilities

(none — `wire-mcp-session-token` owns the eventual spec deltas)

## Impact

- `openspec/changes/spike-mcp-credential-delivery/findings.md` — the deliverable.
- `openspec/changes/wire-mcp-session-token/` — parked; its `design.md` D2/D5 are
  rewritten from these findings once they land.
- Throwaway probe entries in a **scratch** MCP config and a scratch HTTP sink —
  never `~/.pi/agent/mcp.json`, never the live dashboard.
- No `packages/` source is modified by this change.

## Discipline Skills

- `security-hardening` — the spike handles a real bearer credential and probes
  exactly where it leaks (argv, `ps` output, inherited env, a broadcast event
  bus). The probes must not themselves leak a live token, and Q1/Q4 are leak
  questions by construction.
- `systematic-debugging` — the whole change is evidence-before-conclusion: two
  prior mechanisms failed on assumed behaviour, so every answer must carry the
  probe and its observed output rather than a reading of the source.
- `doubt-driven-review` — the findings feed a design decision that has already
  been falsified twice; the findings document itself is reviewed before
  `wire-mcp-session-token` is rewritten against it.
