## 0. Scratch harness (never touch the live config)

- [x] 0.1 Stand up a scratch HTTP sink that logs every received header, and a scratch MCP config pointing one entry at it; verify by reaching the sink with `curl` and seeing the headers logged, and by confirming `~/.pi/agent/mcp.json` is byte-identical before and after (`shasum` before/after)
- [x] 0.2 Confirm the probe token used throughout is a throwaway string, never a real minted `mcp_` credential; verify no probe writes a live token anywhere by grepping the scratch tree for the `mcp_` prefix

## 1. Q1 — interpolation and argv exposure

- [x] 1.1 Determine which interpolation forms expand in each of `command`, `args`, and `env`, by configuring a probe entry using `${VAR}`, `$env:VAR`, `{env:VAR}` and bare `$VAR` for each slot; verify by reading the header value that arrives at the sink for each form and recording which arrived expanded vs literal
- [x] 1.2 Determine whether an expanded secret is visible in the child's argv, by sampling `ps axeww` (or `/proc/<pid>/cmdline`) while the command runs with a marker value in each slot; verify by searching the sampled output for the marker and recording per-slot visible/not-visible
- [x] 1.3 Establish whether any configuration delivers the secret to the child WITHOUT argv exposure (env-only slot, stdin envelope, or a command that reads env itself); verify the marker reaches the sink as a header while being absent from the sampled argv

## 2. Q2 — invocation model and env freshness

- [x] 2.1 Count invocations per HTTP request vs per connection, using a command that appends one line per invocation to a counter file; verify by issuing a known number of tool calls and comparing the line count against them
- [x] 2.2 Determine whether the child observes a runtime mutation of the parent pi process's `process.env`, by mutating it from a loaded extension after the connection is established and then issuing a request; verify by observing whether the mutated value or the pre-mutation value arrives at the sink
- [x] 2.3 Measure the wall-clock overhead the command adds to one tool call; verify by timing the same call with and without the command configured and recording the delta

## 3. Q3 — 401 behaviour and restart recovery

- [x] 3.1 Determine what a non-OAuth HTTP entry does on a 401, by having the sink return 401 after N successful requests; verify by recording whether the adapter throws, backs off, retries, or disables the entry, and whether the header command is re-invoked afterwards
- [x] 3.2 Measure how a session recovers once the sink returns 200 again, by flipping the sink back and observing without operator action; verify by recording the time to the first successful request, or that recovery never happens unattended
- [x] 3.3 Record whether recovery differs when the credential itself changes between the 401 and the retry (the real restart case); verify by rotating the sink's accepted token across the flip

## 4. Q4 — a non-broadcast server→session channel

- [x] 4.1 Establish whether a session-private server→extension channel exists today, by enumerating the server→extension message types the bridge handles and classifying each as private to one extension vs re-emitted onto the shared `pi.events` bus; verify each classification against the bridge's handling code for that message type
- [x] 4.2 Confirm the broadcast exposure concretely, by subscribing a second throwaway extension to the event type a `plugin_emit_event` relay uses and observing whether it receives the payload; verify by the second extension logging a payload it was never the intended recipient of
- [x] 4.3 If no private channel exists, record what the minimal addition would be (message type, gating, where the bridge would route it) as a finding, not an implementation; verify the note names the exact files a future change would touch

## 5. Report

- [x] 5.1 Write `findings.md` with one section per question, each carrying the probe command, the observed output, and a verdict of measured / not-measurable / needs-new-mechanism; verify every verdict cites an observation rather than a source reading
- [x] 5.2 State explicitly which delivery mechanisms the findings ELIMINATE and which remain viable; verify each elimination points at the specific measured fact that kills it
- [x] 5.3 Record any question the probes could not answer and why; verify the list is non-empty or explicitly states that all four resolved
- [x] 5.4 Tear down the scratch harness and confirm no probe artifact or token survives; verify `~/.pi/agent/mcp.json` is unchanged and the scratch tree is removed
