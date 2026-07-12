## 1. Node-stable streaming render

- [ ] 1.1 Prototype an append-only / in-place streaming render so the committed prefix's Text nodes are not replaced per chunk.
- [ ] 1.2 Keep the tail mounted across the streaming→committed swap (or transplant the selection) so `message_end` does not detach the anchored node.
- [ ] 1.3 Buffer chunks while a tail selection is held; flush on collapse; do NOT drop non-chunk mutations (`tool_execution_start`, `message_end`).

## 2. Validate

- [ ] 2.1 Test: selection in the streaming tail survives a chunk append.
- [ ] 2.2 Test: selection in the streaming tail survives turn completion.
- [ ] 2.3 `performance-optimization`: measure streaming flush coalescing before/after; no latency regression.
