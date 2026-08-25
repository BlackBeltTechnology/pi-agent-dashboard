# compose.test.cap.yml — index

Overlay-mode capability layer. Grants `cap_add: [SYS_ADMIN]` for `mount -t overlay` in test-entrypoint.sh. test-up.sh layers it only in overlay mode; omits when `TEST_COPY_MODE=1` (copy mode runs no added capability). See change: docker-test-harness.
