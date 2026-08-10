# Tasks

## 1. Document-converter mount confinement (B11)

- [ ] 1.1 In `engine.ts`, resolve a configured workspace root; reject any request path resolving outside it or into sensitive dirs (`/etc`, `/root`, `~/.ssh`).
- [ ] 1.2 Mark input mounts `:ro`; confine output mounts to the workspace root.

## 2. KB source SSRF guard (B12)

- [ ] 2.1 In `sources.ts` `httpsResolver`, restrict scheme to `https`; DNS-resolve the host and reject loopback/RFC1918/link-local; cap redirects.
- [ ] 2.2 Add a max-bytes cap + `AbortSignal.timeout` on the fetch body (audit B-tier DoS pairing).

## 3. KB archive traversal safety (B13)

- [ ] 3.1 Replace blind `unzip -o`/`tar xzf` with entry validation (reject `..`/absolute) or a traversal-safe extractor; do not overwrite outside destination.

## 4. Spreadsheet parse bounding + xlsx triage (B26)

- [ ] 4.1 Add an input-size cap before the SheetJS parse in the office-preview path.
- [ ] 4.2 Isolate/pin/replace the vulnerable `xlsx` build; record the decision.
- [ ] 4.3 Run `npm audit --omit=dev` and document a triage decision for each remaining advisory.

## Tests

- [ ] T1 doc-converter: `{output:"/root/.ssh/..."}` rejected; workspace-confined input mounted `:ro`; legit conversion runs.
- [ ] T2 kb SSRF: `http://169.254.169.254/…` and a `10.x` host refused; public `https://` allowed.
- [ ] T3 kb zip-slip: archive with `../` entry rejected; normal archive extracts.
- [ ] T4 xlsx: oversized `.xlsx` refused before parse; audit triage doc present.

## Discipline checkpoints

- [ ] D1 `security-hardening` — SSRF check resolves DNS then validates (note TOCTOU/rebinding; pin or re-check for high-risk); mount confinement is realpath-based.
- [ ] D2 `doubt-driven-review` — legitimate conversions + public KB sources still work.
- [ ] D3 `scenario-design` — metadata/private/public × zip-slip/normal × sensitive/workspace realized as T1–T4.

## Validate

- [ ] V1 `openspec validate harden-untrusted-content-ingestion --strict` passes.
- [ ] V2 `npm test` green (kb sources, document-converter, office-preview suites).
- [ ] V3 Manual: point a KB source at a link-local IP → refused; convert a normal doc → succeeds.
