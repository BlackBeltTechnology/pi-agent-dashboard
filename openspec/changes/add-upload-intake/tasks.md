## 1. Port surface

- [ ] 1.1 Add `IngestFile` (`{ filename: string; bytes: Buffer }`) and `IngestOutcome` (`{ filename; hash; status: "landed"|"skipped"|"rejected"; reason? }`) types to `engine/port.ts`
- [ ] 1.2 Add `ingest(cwd, files): Promise<{ results: IngestOutcome[]; landed; skipped; rejected }>` to the `InvoiceEngine` interface, documented as first-class (binary does not fit the selector envelope)

## 2. Engine bindings

- [ ] 2.1 Extend the local `InvoiceFacade` interface in `engine/real.ts` with `ingest(cwd, files)` and add the thin pass-through method to `RealInvoiceEngine`
- [ ] 2.2 Write a failing test for `FakeInvoiceEngine.ingest`: PDF → landed, PNG → landed, unsupported → rejected, repeat → skipped(duplicate), oversize → rejected(too large)
- [ ] 2.3 Implement `FakeInvoiceEngine.ingest`: magic-byte sniff (`%PDF-`, PNG signature), size cap, `sha256(bytes).slice(0,16)` hash + in-instance seen-set dedup, aggregate counts; `cwd` accepted and ignored — make 2.2 pass

## 3. Multipart route

- [ ] 3.1 Add `@fastify/multipart` to `packages/invoicebot-plugin/package.json` and register it for the upload route with `limits: { fileSize: 20 MB, files: 20 }`
- [ ] 3.2 Write failing route tests (mirror `blob-route.test.ts`) against the Fake engine: valid PDF → 200 landed; disguised/unsupported part → rejected; same bytes twice → second skipped(duplicate); missing/blank `cwd` → 400; no file parts → 400; oversize part → rejected(too large) while a valid part still lands; response carries no `sessionId`
- [ ] 3.3 Implement `POST /api/plugins/invoicebot/upload` in `routes.ts`: reuse the `badCwd` guard, read the `cwd` field, stream each file part to a Buffer (catch per-part truncation → `rejected` "too large", never forward partial bytes), call `engine.ingest(cwd, files)`, return the result verbatim with `200`; 400 only on bad `cwd` / no parts — make 3.2 pass
- [ ] 3.4 Add per-request observability log (landed/skipped/rejected counts + code), mirroring the `/blob` route's logging

## 4. Docs & verification

- [ ] 4.1 Update `packages/invoicebot-plugin/src/server/AGENTS.md` (port + bindings) and the route header comment in `routes.ts` documenting the endpoint as the write-side twin of `/blob`
- [ ] 4.2 Run the faux gate: `npm test` (upload route + Fake ingest tests green against the Fake binding) and `npm run build`
- [ ] 4.3 Run `openspec validate add-upload-intake --strict`
