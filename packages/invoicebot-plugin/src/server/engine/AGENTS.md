# invoicebot-plugin/src/server/engine

The `InvoiceEngine` port + its two bindings. Routes depend ONLY on the port —
swapping a binding needs no route change.

| File | Purpose |
|------|---------|
| `port.ts` | `InvoiceEngine` interface (`query/review/setup/rules(cwd, args)` + `ingest(cwd, files)`). `EngineResult = {content, details, flow?}` — `flow: FlowRunSpec` present only for the 5 flow-triggering ops. `ingest` first-class (binary does not fit the selector envelope): `IngestFile = {filename, bytes:Buffer}`, `IngestOutcome = {filename, hash, status:"landed"\|"skipped"\|"rejected", reason?}`, `IngestResult = {results, landed, skipped, rejected}`; dispatches no flow. `ensureAutomation(cwd) → {automation:string[]}` — idempotent, non-fatal, ensures disabled `invoicebot-intake` drain scaffold on first touch. `BoundEngine = {engine, binding:"real"\|"fake"}`. See change: add-upload-intake, ensure-intake-automation. |
| `fake.ts` | `FakeInvoiceEngine` — static fixtures matching real tool `details` shapes (api-contract §6–§9); sets `flow` for approve/repair/partner-confirm/submit/rules-request. CI/worktree/release binding. cwd accepted + ignored. `ingest` deterministic sim: magic-byte gate (`%PDF-`, PNG signature) else rejected(unsupported type); `>20 MB` rejected(too large); `sha256(bytes).slice(0,16)` hash + in-instance seen-set → repeat skipped(duplicate); aggregate counts. `ensureAutomation` no-op → `{automation:[]}` (no FS write). See change: add-upload-intake, ensure-intake-automation. |
| `real.ts` | `RealInvoiceEngine(facade)` — thin pass-through to `@blackbelt-technology/invoicebot/engine` (facade wraps ops in `ibContext.run({cwd})`); passes `query/review/setup/rules` + `ingest`; `ensureAutomation(cwd)` → facade `ensureIntakeAutomation(cwd)`. `loadRealEngine()` dynamic-imports the facade guarded → null when absent. ⚠️ `TODO(release)`: `file:` link resolves local-dev only. See change: add-upload-intake, ensure-intake-automation. |
| `select.ts` | `selectEngine(log)` → Real when `loadRealEngine()` resolves, else Fake. Logs active binding at load. |
