# 18-server-port-hygiene.sh — index

L2 (test-plan #E1, #E22). Server B takes its OWN gateway port plus A's OCCUPIED dashboard port, so B's gateway binds and the LATER `fastify.listen` fails — the shape only the teardown can clear. Asserts B exits, B's gateway port is released, exactly one holder of A's gateway remains, and no pid holds a gateway port without its dashboard port (the PID-78379 signature). See change: fix-worktree-server-autostart-leak.
