# gateway-readiness-board.spec.ts — index

F1–F6 + F9 — readiness board, poll lifecycle and the degraded banner. Counts REQUESTS, not rendered text: "ticks on open, stops on close, suppresses overlap" is a statement about request volume. F1 exists because the reducers were correct while the effect read a lagging ref and skipped the immediate tick. See change: add-zrok-custom-reserved-name.

Board on `/settings/gateway`; the Remote access landing reads readiness once and stays silent (F2). See change: add-remote-access-wizard.
