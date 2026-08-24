# tall.md — index

Over-cap markdown fixture (120 sections) for `tests/e2e/overlay-layout.spec.ts`. Opened via `/folder/:cwd/view?path=tall.md` to exercise the tall-content half of the flush-dialog reachability gate: the panel must clamp at `max-h-[92vh]` and a descendant must become a working scroller. Body is filler by design — no assertion reads its text. See change: fix-flush-dialog-scroll-and-close-collision.
