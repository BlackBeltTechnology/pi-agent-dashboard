---
session: 019eccee
week: 2026/W25
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 4 memory(ies); heavy steering (16 user prompts)"
upgrade_status: pending
---

# How we did it: Diagnosing why the dashboard was slow to serve pages after restart — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator restarted the dashboard server and it took a very long time before it
could serve pages. First prompt, verbatim:

> "Restarted server, it was very long time to be able to serve poages. Check the log
> and try determinate what causes thats lags."

The *real* objective, once steering clarified it: **empirically pin the root cause of
post-restart page lag** — not guess from the log — and then act on it. The
investigation widened into a full machine-health sweep (stuck processes, a leaking
metrics daemon, per-component RAM accounting) because the true cause turned out to be
system-wide memory pressure, not anything inside the dashboard code.

## 2. TL;DR playbook

1. **Read the log first, but don't trust the loudest line.** `tail -150 ~/.pi/dashboard/server.log` surfaced a `[openspec-poll] slow tick: 76274ms`. It's a red herring — a long tick is mostly `await` wall-time, not main-thread block.
2. **Falsify the obvious hypothesis with measurement, not reasoning.** Write two throwaway probes: one counting concurrent `openspec` spawns during a restart, one sampling page latency (`curl -w`) every second.
3. **Correlate latency against `vm_stat` deltas** (page-ins / decompressions) through a real restart. The single latency spike lines up 1:1 with the biggest page-in burst → **cold-start working-set fault-in under memory pressure** is the cause.
4. **Hunt for chronic load amplifiers.** `ps axo pid,stat,%cpu,command | awk '$… >90'` found two orphaned `cli.ts status` processes (PPID=1, state R) busy-looping at ~90% CPU for 1–2 days from **deleted worktrees**. Kill them → +1.8 cores, +544 MB.
5. **Trace the biggest single-process RAM hog.** `ps axo rss,command | sort` ranked consumers; `telegraf` held 4.6 GB (a Homebrew launchd metrics daemon leaking / buffering to a dead InfluxDB). `brew services stop telegraf` freed ~18 GB of system pressure.
6. **Distinguish RSS from "Memory" footprint** when a number looks alarming. Terminal.app's "8 GB" was actually macOS **Cached Files (13.2 GB)** in the Activity Monitor bottom bar — reclaimable, not consumed.
7. **Save the measured root cause + the reusable probe path** to project memory, so the next slow-restart report skips the whole guessing phase.

## 3. How the collaboration unfolded

**Phase 1 — Log read & first (wrong) diagnosis.** The AI tailed the server log, saw a
76-second openspec-poll tick, and blamed a startup spawn burst across ~19 session
cwds. Confident, structured — and *wrong*, which the operator immediately caught.

**Phase 2 — Steered off the wrong track.** Operator: *"No. In theory it uses worker to
avoid tick blocking."* The AI conceded, re-checked whether the worker pool was silently
falling back to in-process derivation (which *would* block the loop), verified the
running process's `execArgv` carried jiti → workers were healthy. Conclusion corrected:
a long tick ≠ blocked page serving.

**Phase 3 — "How can [we] detect the root of the problem?"** The pivot that made the
session. The AI stopped reasoning and built a measurement harness: a spawn counter and
a page-latency sampler, driven across a real restart. Data **falsified** every code-path
hypothesis (openspec peaked at 6 concurrent not 20; no worker crashes; warm latency
0.02 s; stalls happened with CPU 50% *idle*).

**Phase 4 — Correlation nails it.** Merging `vm_stat` page-in deltas with per-second
latency showed the one spike (2.71 s) aligned exactly with the largest page-in burst
(`d_pagein=3491`), and cold start sustained 1000–1600 page-ins/s vs. ~100–400 baseline.
Root cause: **restart-time working-set fault-in, gated by free RAM.**

**Phase 5 — Chase the amplifiers (operator-led).** *"Maybe some stalled process is
there"* → found two orphaned `cli.ts status` spinners. *"Maybe some npm/find stalled?"*
→ none, but surfaced 20 legit context-mode MCP servers (0 orphaned). *"What kills the
memory?"* → ranked RSS: Chrome 15 GB, telegraf 4.6 GB. *"What is telegraf / what
executes it?"* → traced to a Homebrew launchd LaunchAgent with `KeepAlive` +
`RunAtLoad`. Operator issued `brew services stop telegraf` then `brew uninstall`.

**Phase 6 — Myth-busting the numbers.** *"Why terminal eating 8Gb?"* → proved Terminal
was 65 MB footprint; the 8 GB was Cached Files. *"How many ram eaten by dashboard server
and browser client?"* → server ~728 MB (node 650 + zrok 77), client ~650 MB Chrome tab.

## 4. Prompts that worked

- **Goal prompt** (weak as written, strong in intent): *"Check the log and try
  determinate what causes thats lags."* It correctly said *check the log* but implied
  "read and conclude." A stronger version: **"The dashboard was slow to serve pages
  after restart. Don't conclude from the log alone — set up a measurement to prove the
  cause."** That's exactly where the session became productive.
- **The turning-point follow-up:** *"How can detect the root of the problem?"* — this
  one prompt flipped the mode from armchair reasoning to an instrumented experiment.
  Highest-leverage move in the whole session.
- **The correcting redirect:** *"No. In theory it uses worker to avoid tick blocking."*
  A single domain fact from the operator killed a plausible-but-wrong diagnosis before
  it wasted an hour.
- **Cheap directional nudges:** *"maybe other terminal process stuck"* /
  *"Maybe some npm? find or other bash commands stalled?"* — short hunches that steered
  the AI into the process-hygiene sweep that found the real chronic load.
- **The one-word "yes"** approvals kept momentum: they authorized the probe runs and the
  process kills without re-litigating each step.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the loudest log line (76s slow tick) as the cause | "No. In theory it uses worker to avoid tick blocking" | Treat `slow tick` as wall-time, not block; verify worker health before blaming derivation |
| Reason confidently instead of measuring | "How can detect the root of the problem?" | Default to a probe (latency sampler + `vm_stat` correlation) for any "it's slow" report |
| Focus only inside the dashboard code | "maybe other terminal process stuck" / "Maybe some npm/find stalled?" | Always sweep host processes (`ps` for R-state, PPID=1 orphans, RSS ranking) early |
| Report RSS as if it were "used memory" | "Why terminal eating 8Gb?" | Separate RSS vs physical footprint vs Cached Files before calling a number alarming |
| Stop after diagnosing one cause | "what kills the memory?" | Enumerate all amplifiers (stuck spinners + leaking daemon + Chrome) not just the first |

The operator's consistent quality bar: **prove it, don't argue it.** Every hypothesis
had to be falsified or confirmed by a number.

## 6. Skills, tools & memory created — and why they're effective

No skill was created, but **4 project/failure memories** were saved and **two reusable
probes** were written:

- **`/tmp/pi-mem-probe.sh`** and **`/tmp/pi-restart-probe.sh`** — the latency-vs-`vm_stat`
  correlation harness. Reusable for any future "slow after restart" report; skips the
  entire reasoning phase.
- **Project memory: "slow to serve pages after restart" root cause** — records that it's
  cold-start working-set fault-in under memory pressure, NOT openspec/workers/CPU. Fresh
  server (~580 MB RSS) pages its working set back in; severity scales with free RAM at
  the restart instant.
- **Failure/tool-quirk memory:** a `packages/server/src/cli.ts status` process can
  busy-loop at ~90% CPU and orphan (PPID=1, state R) when its git worktree is deleted
  out from under it.

**Recommended skill to create:** `diagnose-dashboard-restart-lag` — codify the probe +
`vm_stat` correlation + the host-process sweep (orphaned `cli.ts status`, leaking
launchd daemons) into one runnable procedure. This session is clearly repeatable and
would benefit from a saved skill instead of 40 ad-hoc bash commands.

## 7. Pitfalls & dead ends

- **The `slow tick: 76274ms` red herring.** It looks like the smoking gun; it isn't.
  Worker offload means a long tick is mostly `await` wall-time. If you hit this, verify
  the worker pool is actually spawning (check `execArgv` carries jiti) before blaming
  derivation.
- **`curl -s .../api/health` failed once** and `pgrep -c` doesn't exist on macOS. Write
  the harness properly (macOS BSD tools differ from GNU) rather than one-lining it.
- **`kill 628` on telegraf would not stick** — its launchd plist has `KeepAlive` +
  `RunAtLoad`, so launchd respawns it. Use `brew services stop telegraf` (or
  `launchctl bootout`) to actually stop and unregister it.
- **RSS overcounts shared libraries** — don't sum RSS across processes and call it
  "used memory." Chrome's 15 GB across 67 helpers and macOS's 10.5 GB are inflated by
  shared pages.
- **"Terminal is eating 8 GB" was a misread** of Activity Monitor's Cached Files
  bottom-bar figure. Cached Files is reclaimable and costs nothing.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** access to `~/.pi/dashboard/server.log`, the running server pid
(`/api/health`), macOS `vm_stat` / `top` / `ps`, `brew services`.

1. `tail -150 ~/.pi/dashboard/server.log` — note the loud line, but don't conclude.
2. Write a latency sampler (`curl -o /dev/null -w 'real=%{time_total}'` in a 1 Hz loop)
   and a `vm_stat` delta logger; drive a real `/api/restart`.
3. Correlate latency spikes with page-in bursts → confirm cold-start fault-in vs. CPU.
4. Sweep host: `ps axo pid,ppid,stat,%cpu,command | awk '$5>80'` for R-state / PPID=1
   orphans (esp. stale `cli.ts status` from deleted worktrees) → kill them.
5. Rank RSS: `ps axo rss,command | sort -rn | head` → find single-process hogs; check
   for leaking launchd daemons (`brew services list`), stop with `brew services stop`.
6. Before restarting, ensure free RAM is high (close idle sessions / heavy apps) — that
   is the single variable that governs restart lag severity.
7. Save the measured root cause + probe path to project memory.

**Artifacts produced:** `/tmp/pi-restart-probe.sh`, `/tmp/pi-mem-probe.sh`; 4 memories
(root cause + `cli.ts status` orphan quirk). Outcome: went from ~1.3–4.4 GB free (7–12 s
page stalls) to ~22 GB free (~0.02 s warm latency) by killing two spinners and removing
a 4.6 GB telegraf leak.

---

_Generated from session `019eccee-d665-74b6-9cd7-226d6d2bb2b4` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-15. Source extract: deterministic facts sheet._
