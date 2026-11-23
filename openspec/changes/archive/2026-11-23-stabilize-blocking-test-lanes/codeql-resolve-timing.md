# CodeQL `resolve extensions` timing (task 7.1, design.md D8)

Measured 2026-11-22 23:44–23:58 (local time) on the owner's machine, in worktree `os-stabilize-blocking-test-lanes`.
Every number below is a wall-clock time from `time` / `/usr/bin/time -p`, except the one marked "derived".

## Environment

| Item | Value |
|---|---|
| CodeQL CLI | 2.27.2 (`/opt/homebrew/bin/codeql`, Caskroom), bundled JRE reports 25.0.4.1 |
| Cores / RAM / OS | 18 cores (Apple M5 Pro), 48 GiB, macOS 26.4, uptime 35 days |
| `~/.codeql/packages` | 104 MB (`codeql/javascript-queries@2.4.7` resolved, 81 entries) |
| Concurrent `codeql`/`java` processes at start | no `codeql` analysis; three idle Karaf `java` processes (16 days old); several `docker/harness-audit.sh` bash loops; load average 11.4 / 8.7 / 6.0 at 23:45. Later a second worktree's `codeql-local.mjs` (`os-update-pi-core-1-6-adopt-apis`) started on its own (about 23:48) |
| `$TMPDIR` | `/var/folders/pw/tsfsqftd3g765g_jz_7wq7rh0000gn/T`, **3,001,474 directory entries** (2,494,141 `fileinstall*`, 321,122 `pi-*`, 25,156 `deck3d*`, 14,992 `meval*`, 12,768 `pid*`, 12,692 `codeql*`) counted with `os.scandir` (15 s); `ls` on it does not return in 10 s |

Command timed (the exact argv of `verifyModelPack`, plus `--verbosity=progress+++ --logdir` where noted):

```
codeql resolve extensions --additional-packs=<DIR>/model-pack --model-packs=pi-dashboard/local-models \
  -- codeql/javascript-queries@2.4.7:codeql-suites/javascript-code-scanning.qls
```

`<DIR>/model-pack` holds the repo's `codeql-pack.yml` manifest plus `.github/codeql/extensions/cwd-guard.model.yml`. The only variable that changed the outcome is **where `<DIR>` lives**: under `$TMPDIR` (as `codeql-local.mjs` puts it: `$TMPDIR/pi-codeql/<hash>/run-<pid>/model-pack`) or outside it (`/tmp/rx/pack`).

## Session store (failing sessions)

The store exists on this machine (`~/.pi/agent/sessions/--Users-robson-Project-pi-agent-dashboard*/`, 304 directories).
`grep -l 'resolve extensions failed'` lists 19 session files (one of them is this session's own task text and one is a test-fixture discussion; 17 hold real failures). Real failures: `model pack pi-dashboard/local-models is not usable: codeql resolve extensions failed (spawnSync /opt/homebrew/bin/codeql ETIMEDOUT)`, one `exit 143`.

Start of the earliest real failure: 2026-10-23 18:39; the rest cluster on 2026-11-21 and 2026-11-22 (first at 2026-11-21 03:15).
From the tool-result durations (each is the whole `npm run codeql` call): 43 failing runs, 67 s minimum, 114 s median, 489 s maximum. A 60 s bound plus about 8 s of version/pack resolution explains the 67–115 s cluster. The longer ones include a retry or a wait.

Overlap: the interval of each failing run was compared with the interval of every other session's `npm run codeql`-like call (over 20 s). 6 of 43 failing runs overlapped another session's run; 37 did not. Failures therefore occur with no other CodeQL run in the store, so concurrent analyses are not the cause. (The check only sees sessions in this store, not manual terminal runs.)

## The six conditions

| # | Condition | Result |
|---|---|---|
| 1 | warm, alone | Pack outside `$TMPDIR` (`/tmp/rx/pack`): **1.29 s**, **0.85 s** (two runs, `--verbosity=progress+++ --logdir`, 1,724-line stderr, exit 0, 81 entries). Not strictly alone: load average 11 and other worktrees' idle processes (see above). Pack under `$TMPDIR` (the path the script uses), same warm cache: **41.2 s** (exit 0, user 1.9 s, sys 9.1 s, load average 4–6); **> 60 s** (killed by `timeout 60`, exit 124, probe pack in `$TMPDIR/rxprobe/model-pack`); **> 100 s** (killed by `timeout 100`, exit 124, pack = the real run's `$TMPDIR/pi-codeql/<hash>/run-83974/model-pack`, run beside the real script); the real `node scripts/codeql-local.mjs` run itself: about **170 s** (derived: script process age 7:18 vs. the `database create` child age 4:17 at one `ps` sample, minus 8 s before the resolve JVM started; no timer was running, error about ±5 s) |
| 2 | cold, alone, first run after a reboot | **not run:** a reboot of the owner's machine is not allowed from an agent session (uptime 35 days). Page-cache warmth is a visible factor (41 s vs. 170 s for the same path) so a cold run is expected to be slower, not measured |
| 3 | warm, beside one other worktree's `npm run codeql` | Pack outside `$TMPDIR`: **1.05 s, 1.14 s, 1.33 s** (three runs), made while this worktree's own `codeql-local.mjs` was in its `resolve extensions` stage (not in `database create`). No timed pack-under-`$TMPDIR` run was made in a "beside a heavy analysis" state. **Partly run:** the second worktree's analysis started later and was not coordinated. |
| 4 | warm, beside two others | **Approximated, not a true two-other-worktrees run:** four `resolve extensions` in parallel (pack outside `$TMPDIR`) all finished within the 12 s wait; their `real` lines were not captured (only `user` 2.07–2.20 s each). **Partly run:** no two real `npm run codeql` analyses were started on purpose |
| 5 | `-J-Xmx` raised | `-J-Xmx4g`, pack under `$TMPDIR`: **44.6 s** (exit 0, sys 9.6 s). The same condition without the flag, run immediately after: **41.2 s**. No effect: the slowness is not heap (GC threads idle in the dump below) |
| 6 | `jstack` dump at 60 s in the slowest condition | **`jstack` is not shipped** with CodeQL's JRE (`tools/osx64/java-aarch64/bin` has `java javac keytool rmiregistry serialver`). Used macOS `sample 87405 3` instead, taken 48 s into the real script's `resolve extensions` JVM (the slowest condition, about 170 s): **all 2205 of 2205 samples on the working thread are in `sun.nio.fs.UnixNativeDispatcher.lstat0` (libnio `lstat` → `copy_stat_attributes`)**. The JVM is walking a filesystem tree entry by entry. `lsof -p` shows file descriptor 5 open read-only on `$TMPDIR` itself. The stack is saved in `/tmp/rx/sample-real.txt` on this machine (not committed) |

## Root cause (outcome (i): backed by a timed run over 60 s)

`codeql resolve extensions` is slow when the `--additional-packs` directory lives under a `$TMPDIR` that holds millions of entries. The CodeQL JVM walks that tree (`lstat` per entry, I/O bound: sys time 9 s of 41 s; GC threads idle in the dump), and the cost scales with the number of entries and with filesystem cache warmth, not with heap, cores or other CodeQL runs.

Evidence, each a timed run:

1. Same command, same pack content, pack at `/tmp/rx/pack`: **0.85–1.3 s** (condition 1).
2. Same pack content copied under `$TMPDIR`: **41.2 s** (warm cache) to **> 60 s** (timed out) and **> 100 s** (timed out); the real script run: about **170 s**, which is over the old 60 s bound and under the new 300 s default.
3. The real script with `TMPDIR=/tmp/rx/tmpd` (an empty directory) went from start to the `database create` stage in under 8 s, i.e. `resolve extensions` passed in a few seconds (one run, observed through `ps`; no timer on the step itself).
4. The thread dump (condition 6) shows the JVM in `lstat0` for every sample, and `$TMPDIR` open on fd 5.

Why the walk starts at `$TMPDIR` and not at the pack directory is **not determined**: the `model-pack` directory itself has 3 entries. A pack path whose grandparent is `$TMPDIR` is enough to trigger it (the `rxprobe/model-pack` probe), so CodeQL's pack search appears to look at ancestors of `--additional-packs`; this was not confirmed in CodeQL's sources or logs (no `--logdir` was taken for the slow runs).

Why 3 million entries: not investigated. The `fileinstall*` prefix (2.49 M) is the name Apache Karaf uses for its temp dirs, and three Karaf `java` processes run on this machine, so that is the likely source; this was not verified. The 321 k `pi-*` entries are tooling temp dirs of unknown origin.

## Consequences for the change

- The 300 s default of task 7.2 covers the measured 41–170 s but not a tail beyond it (the store shows runs up to 489 s that include retries). `PI_CODEQL_RESOLVE_TIMEOUT_MS` is the remedy for a machine whose `$TMPDIR` is bloated.
- A real fix (not in scope here, not made): create the run directory/model pack outside a bloated `$TMPDIR`, or clean `$TMPDIR`. Follow-up, owner decision.
- Residual uncertainty: the cold-boot condition (2) and a true two-other-analyses condition (4) were not produced; neither can change the root cause above, which is reproduced with a timed run over 60 s.
