# Tasks — fix-blob-content-disposition-encoding

## 1. Prove RED

- [x] 1.1 Add route-level tests in
  `packages/invoicebot-plugin/src/server/__tests__/blob-route.test.ts` for a
  Hungarian filename containing `ő` and `É`: expect `200`, an ASCII-only
  `filename`, and a `filename*=UTF-8''` parameter.
- [x] 1.2 Add a header-injection test (quote + CR/LF + backslash in the filename)
  asserting none of those characters appear literally in the header value.
- [x] 1.3 Add a range test over the accented file asserting `206` +
  `Content-Range` are unaffected.
- [x] 1.4 Add unit tests for the encoder in
  `packages/invoicebot-plugin/src/server/__tests__/blob.test.ts`.
- [x] 1.5 Run the suite and record the RED output.

## 2. Implement

- [x] 2.1 Add `contentDispositionFor(filename)` to
  `packages/invoicebot-plugin/src/server/blob.ts`: allow-list ASCII fallback,
  RFC 5987 `filename*`, `attr-char` tightening, empty-fallback default.
- [x] 2.2 Use it in the blob route in
  `packages/invoicebot-plugin/src/server/routes.ts`, replacing the raw
  interpolation. Leave every other header untouched.

## 3. Verify

- [x] 3.1 Re-run the targeted tests — GREEN, with real output recorded.
- [x] 3.2 Run the whole invoicebot-plugin suite for regressions.
- [x] 3.3 `npx tsc --noEmit` clean for the touched package.
- [x] 3.4 `openspec validate fix-blob-content-disposition-encoding --strict`.

## 4. Document

- [x] 4.1 Update the `blob.ts` / `routes.ts` rows in
  `packages/invoicebot-plugin/src/server/AGENTS.md`.

## 5. Ship

- [ ] 5.1 Commit the implementation on `private/invoicebot`.
- [ ] 5.2 Archive the change + sync specs in a separate `docs(openspec)` commit.
- [ ] 5.3 Push `private/invoicebot` only; verify local/remote parity `0 0`.

## 6. E2E (runs outside this repo, after the push)

- [ ] 6.1 Browser E2E asserts an accented-filename invoice preview loads:
  `200`/`206`, `Content-Type: application/pdf`, both `filename` and `filename*`
  present, and the preview renders instead of `Failed to load PDF document.`
