# Retracted Group 2 numbers — read this first

The Group 2 acceptance numbers in this directory were taken while a defect this
change did not know about was still live: `handleShutdown` never terminated a
tmux-spawned session's process. Sessions were released from the record while
their `pi` kept running, so every memory figure here measures a container that
was leaking ~127 MB per spawned session — 21 panes = 21 resident `pi` = 0 session
records, mid-run.

They are therefore NOT a baseline for anything. Superseded by:

    openspec/changes/fix-tmux-session-shutdown-leak/measurements/tmux-leak-evidence.txt

which re-measures the same shapes after the leak was closed:

    panes / resident pi / server records:  0/0/0 → 5/5/5 → 0/0/0
    qa/tests/16-e2e-memory-bound.sh:       P1 935→1020 MiB (limit 1029)
                                           P3 divergence 0   (was 21 vs 0)
                                           P4 container healthy

A second leak sat behind the first and is also closed there: a pi that never
registers (measured: tmux panes deadlocked on pi's interactive "Trust project
folder?" prompt) had no session record and was therefore unreachable by
shutdown, reap AND idle-reclaim. The spawn-register watchdog now reclaims it.

See change: fix-tmux-session-shutdown-leak (task 7.3), issue #452.
