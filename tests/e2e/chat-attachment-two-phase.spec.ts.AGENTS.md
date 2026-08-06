# chat-attachment-two-phase.spec.ts — index

Two-phase attachment render E2E (change: fit-attachments-for-display).

Injects an image through the REAL user path — a synthetic `ClipboardEvent` carrying a `File`, which is what `useImagePaste.handlePaste` consumes.

Scenarios: F1 row renders immediately; F1b the PENDING phase is observed (latched via `MutationObserver` armed before send, so a fast fit cannot race it); F2 the placeholder converges to a fitted `<img>`; F3 garbage bytes reach an explicit failed state, never a stuck placeholder; F4 a reload racing an in-flight fit settles ready-or-failed; F5 zoom loads the session-scoped ORIGINAL; F6 a 404 on the originals endpoint degrades the lightbox only; F7 the image still renders after reload; F8 an image row keeps its height across scroll-out/scroll-back; P5 an image-heavy replay drops no gateway frame, asserting EVERY replayed row owns a resolved attachment by sweeping the virtualized transcript.

Two constraints worth knowing before editing: fitted-ness is asserted by POLLING `naturalWidth <= 768`, because the client first renders its own optimistic full-resolution echo; and sends use `composer.press("Enter")`, not the send button, whose actionability check stalls with a multi-MB base64 in composer state.
