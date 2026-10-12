## 1. Diagnostics group (shared)

- [x] 1.1 Test (test-plan #E1), extending `packages/shared/src/__tests__/custom-event-groups.test.ts`. Input: shipped defaults. Trigger: resolve `subagent-admission-refused`, `subagents:spawn`, `subagent-notification`, `web-search-results`. Observable: → `diagnostics`, `subagents`, `subagents`, `search`, and `diagnostics.default === false`. Verify: red before 1.5.
- [x] 1.2 Test (test-plan #E2), same file; exemplar: its existing upgrade-merge cases. Input: stored file with the 5 old shipped groups and a `seenShippedIds` that lacks `diagnostics`. Trigger: store load + merge. Observable: `diagnostics` appended last with `default:false`, and `seenShippedIds` contains it. Verify: red before 1.5.
- [x] 1.3 Test (test-plan #E3), same file. Input: user group `{id:"mine",pattern:"^subagent-"}` placed before the merge. Trigger: merge, then resolve `subagent-admission-refused`. Observable: resolves to `mine`. Verify: green after 1.5.
- [x] 1.4 Test (test-plan #E4), same file. Input: `seenShippedIds` contains `diagnostics` but the group list lacks it. Trigger: load. Observable: it is not re-added, and the refusal resolves to `other`. Verify: green after 1.5.
- [x] 1.5 Append `{ id: "diagnostics", label: "Diagnostics", pattern: "^subagent-admission-refused$", default: false }` to `SHIPPED_CUSTOM_EVENT_GROUPS` in `packages/shared/src/custom-event-groups.ts`, and update its inventory comment. Verify: 1.1–1.4 green, plus the existing group/resolver/preferences tests green.
- [x] 1.6 Test (test-plan #F5), extending `packages/client/src/components/chat/__tests__/CustomEntryRow.test.tsx`. Input: msg `{customType:"subagent-admission-refused",groupId:"diagnostics"}`. Trigger: render with default prefs, then with `customEventGroups.diagnostics=true`. Observable: renders `null`, then a `custom-entry-card`. Verify: green.

## 2. Structured generic fallback (client)

- [x] 2.1 Test (test-plan #E5) for a pure `parseFallbackObject`; exemplar: `packages/client/src/components/chat/__tests__/CustomEntryCard.test.tsx` for placement. Input: the 10 bodies listed in #E5 (object, nested, marker-prefixed, 64 000-char tail JSON, array, scalar, null, `{}`, prose, invalid JSON). Trigger: `parseFallbackObject(body)`. Observable: entries for the first two (nested values compact); `null` for all others. Verify: red before 2.6.
- [x] 2.2 Test (test-plan #E6), same file. Input: objects with 1/49/50/51/120 keys. Trigger: parse. Observable: entries 1/49/50/50/50, omitted 0/0/0/1/70. Verify: red before 2.6.
- [x] 2.3 Test (test-plan #E7), same file. Input: the `{__truncated:true,…}` placeholder body and a body holding `…[N chars hidden]…` and `[array truncated]`. Trigger: parse. Observable: the placeholder strings come back verbatim as values. Verify: red before 2.6.
- [x] 2.4 Test (test-plan #X1), same file. Input: a body of 20 000 nested `[`, and a body for which `JSON.stringify` throws (mocked). Trigger: parse. Observable: returns `null` without throwing. Verify: red before 2.6.
- [x] 2.5 Export `CUSTOM_BODY_MAX_CHARS` from `packages/client/src/lib/chat/event-reducer.ts` (adding `export` is the only change). Verify: the reducer test suite is unchanged and green.
- [x] 2.6 Implement `parseFallbackObject` in a new module next to `CustomEntryCard.tsx`: `MAX_FALLBACK_KEYS = 50`; exact marker regex `/^«\d+ earlier lines hidden»\n/`; `length >= CUSTOM_BODY_MAX_CHARS` → `null`; `{}` → `null`; all formatting inside a catch-all. Verify: 2.1–2.4 green.
- [x] 2.7 Test (test-plan #F1), extending `CustomEntryCard.test.tsx`. Input: body `{"cause":"cap","inFlight":2,"reason":"Refused…"}`. Trigger: render. Observable: a `<dl>` with 3 `<dt>`, the label present, and no `<pre>`. Verify: red before 2.12.
- [x] 2.8 Test (test-plan #F2), same file. Input: values `<img src=x onerror=alert(1)>` and `[x](javascript:alert(1))`. Trigger: render. Observable: literals in the text content, and 0 `img` / 0 `a` elements. Verify: red before 2.12.
- [x] 2.9 Test (test-plan #F3), same file. Input: prose, a marker-prefixed object, a JSON array. Trigger: render. Observable: a single `<pre>` with the body verbatim, and no `<dl>`. Verify: green before and after 2.12 (regression guard).
- [x] 2.10 Test (test-plan #F4), same file. Input: an object with 51 keys. Trigger: render. Observable: 50 `<dt>` and the "1 more key" text. Verify: red before 2.12.
- [x] 2.11 Test (test-plan #X2), same file; exemplar: `CustomEntryRow.test.tsx` throwing-renderer case. Input: the structured renderer forced to throw, in a list with 2 siblings. Trigger: render. Observable: the card shows the `<pre>` body, both siblings render, and nothing propagates. Verify: red before 2.12.
- [x] 2.12 Render the structured view in `CustomEntryCard.tsx`: `useMemo` on `body`; a `<dl>` inside the existing `max-h-[240px]` region, wrapped in an `ErrorBoundary` whose fallback is the `<pre>` body; `data-testid` preserved; i18n "N more keys" (en / zh-CN / hu). Verify: 2.7–2.11 green, plus all existing `CustomEntryCard`/`CustomEntryRow` tests green.

## 3. web-access plugin package

- [x] 3.1 Scaffold `packages/web-access-plugin`; exemplar: `packages/blackhole-plugin/package.json` (client part only).
  - Manifest: `{ id:"web-access", client, i18nCatalog, claims:[{ slot:"custom-entry-renderer", customType:"web-search-results", component:"WebSearchEntryCard" }], requires:{ piExtensions:["pi-web-access"] } }`, no `server`.
  - Also: public `publishConfig`, `README.md`, `tsconfig.json`, `vitest.config.ts`, a stub `src/client/index.tsx`, `AGENTS.md`.

  Verify: the manifest validator accepts it (`packages/dashboard-plugin-runtime/src/__tests__/manifest-validator.test.ts` style check).
- [x] 3.2 Capture redacted real-log fixtures under `packages/web-access-plugin/src/client/__tests__/fixtures/`: one search, one fetch(`urlMetadata`), one fetch(`urls`), one research. Replace URLs and text with neutral values; keep the key structure. Verify: the files exist and are valid JSON.
- [x] 3.3 Test (test-plan #E8), new `parse-web-search.test.ts`; exemplar: `packages/blackhole-plugin/src/client/__tests__/OmEntryCard.test.tsx` (count tests). Input: the 10 bodies in #E8. Trigger: collapsed summary derivation. Observable: `{q:2,r:8}`, `{}`, `{q:2}`, `{urls:4}`, `{urls:3}`, then label-only ×5. Verify: red before 3.9.
- [x] 3.4 Test (test-plan #E9), same file. Input: 20/21/35 results per query; 20/21 queries; 50/51 fetch URLs. Trigger: build the expanded view model. Observable: shown counts and "+N" values as listed in #E9. Verify: red before 3.9.
- [x] 3.5 Test (test-plan #E10, #E11), same file. Input: a `urls[]` fetch with `content:"abcd"`; queries with `providers:["exa","brave"]` and with `provider:"exa"`. Trigger: parse. Observable: `size:4`; provider text `exa, brave` and `exa`. Verify: red before 3.9.
- [x] 3.6 Test (test-plan #E12, #X5), same file. Input: results `[valid,"x",null]`, plus the 7 garbage inputs in #X5. Trigger: `parseWebSearchPayload`. Observable: 1 result with `skipped === 2`; never throws, and returns `null` or a view with `skipped > 0`. Verify: red before 3.9.
- [x] 3.7 Test (test-plan #E13), same file. Input: the 12 URLs in #E13. Trigger: `safeHttpUrl`. Observable: the 3 http(s) URLs → normalized `href`; the other 9 → `null`. Verify: red before 3.9.
- [x] 3.8 Test (test-plan #E14), same file, using the 3.2 fixtures. Trigger: parse + collapsed derivation. Observable: typed views with the expected counts for search and both fetch shapes; research → `null` view (label-only); no throw. Verify: red before 3.9.
- [x] 3.9 Implement `packages/web-access-plugin/src/client/parse-web-search.ts`:
  - `parseWebSearchPayload`, collapsed-summary derivation, `safeHttpUrl` (scheme + credential check, returns `href`);
  - `MAX_QUERIES = 20`, `MAX_RESULTS_PER_QUERY = 20`, `MAX_FETCH_URLS = 50`;
  - a catch-all so nothing throws.

  Verify: 3.3–3.8 green.
- [x] 3.10 Test (test-plan #F9), new `WebSearchEntryCard.test.tsx`; exemplar: `OmEntryCard.test.tsx`. Input: 50 collapsed rows with entry ids. Trigger: render. Observable: 0 `fetchPayload`/`fetch` calls, and each row shows "2 queries · 8 results". Verify: red before 3.18.
- [x] 3.11 Test (test-plan #F10), same file. Input: expanded, with a payload of 2 queries, one having `error:"rate limited"`. Trigger: render. Observable: query text, provider, answer, result title + snippet, and "rate limited" all visible. Verify: red before 3.18.
- [x] 3.12 Test (test-plan #F11, #F12), same file. Input: result urls `https://example.com/a`, `javascript:alert(1)`, `https://t.com@evil.example/`; answer `# Heading\n[x](https://evil)`. Trigger: expanded render. Observable: exactly 1 `a` (`target="_blank"`, `rel="noopener noreferrer"`, text = raw url); the answer stays literal, with no `h1` and no `a` created from it. Verify: red before 3.18.
- [x] 3.13 Test (test-plan #F13), same file. Input: expanded research payload. Trigger: render. Observable: a single plain-text block containing `summary`, and 0 `a`. Verify: red before 3.18.
- [x] 3.14 Test (test-plan #F14), same file. Input: a row without `entryId`. Trigger: render + click on the header. Observable: no expand control (`aria-expanded` absent), and `onToggle` is never called. Verify: red before 3.18.
- [x] 3.15 Test (test-plan #F15), same file. Input: collapsed search and fetch rows. Trigger: render. Observable: every `svg` has `aria-hidden="true"`, and a text label is present. Verify: red before 3.18.
- [x] 3.16 Test (test-plan #X3, #X4), same file. Input: expanded with `payloadError:"entry not found"` and no payload; expanded with `payloadLoading:true`. Trigger: render. Observable: stored body plain text + "entry not found"; a loading line with no list and no body. Verify: red before 3.18.
- [x] 3.17 Test (test-plan #F6, #F7, #F8, #X6), extending `packages/client/src/components/chat/__tests__/CustomEntryRow.test.tsx`. Input: a `web-search-results` row with: a registry that has the web-access claim; one with no claim; `customEventGroups.search=false`; a claim component that throws. Trigger: render. Observable: `web-search-entry` (no fallback card); the fallback card with the structured view; `null`; the generic `custom-entry-card`. Verify: red before 4.2.
- [x] 3.18 Implement `WebSearchEntryCard.tsx`:
  - collapsed-first, summary memoized on `body`;
  - expand control only when `entryId` is set;
  - expanded view from `payload` only, falling back to the plain body + `payloadError`, with a loading line while loading;
  - plain-text rendering, line-clamped answer/snippets, `max-h` region, `aria-hidden` icons next to text labels.

  Add the `i18n.ts` catalogs (en / zh-CN / hu, identical keys) and export from `src/client/index.tsx`. Verify: 3.10–3.16 green.

## 4. Package registration

- [x] 4.1 Register `web-access-plugin` in five places:
  - `.github/workflows/publish.yml` PACKAGES, after its `@blackbelt-technology` deps;
  - `BUNDLED_PLUGINS` in `packages/electron/scripts/bundle-server.mjs`;
  - `packages/client/package.json` dependencies;
  - an `@source "../../web-access-plugin/src/client";` line in `packages/client/src/index.css`;
  - root `vitest.config.ts` projects and `knip.json` workspaces.

  Verify: the repo-hygiene test is green.
- [x] 4.2 Run `pnpm install`, regenerate and commit `packages/client/src/generated/plugin-registry.tsx`. Verify: 3.17 green, and the registry contains the web-access claim for `web-search-results`.
- [x] 4.3 Test (test-plan #R1), using the existing contract tests `packages/shared/src/__tests__/bundled-plugins-complete.test.ts`, `publish-allowlist-complete.test.ts`, `publish-tarball-hygiene`, `packages/client/src/__tests__/plugin-registry-populated.test.ts` and `manifest-validator.test.ts`. Input: repo after 4.1–4.2. Trigger: run them. Observable: all green, and the registry row `{pluginId:"web-access",slot:"custom-entry-renderer",customType:"web-search-results"}` is present. Verify: green.
- [x] 4.4 Test (test-plan #R2), new `packages/web-access-plugin/src/__tests__/i18n.test.ts`; exemplar: `packages/kb-plugin/src/__tests__/i18n.test.ts`. Input: the en / zh-CN / hu catalogs. Trigger: the key-parity test + `i18n-lint --strict`. Observable: identical key sets, 0 violations. Verify: green.
- [x] 4.5 Test (test-plan #R3), using `packages/client/src/__tests__/mdi-chunk-size.test.ts`. Input: production build. Trigger: `npm run build`, then the chunk test, compared with an origin/develop baseline. Observable: under the cap (if it trips, lazy-load the expanded detail per design Risks). Verify: green.

## 5. End-to-end (docker harness)

- [x] 5.1 Add a faux scenario to `qa/fixtures/faux-scenarios.ts` that emits a `web-search-results` custom entry (2 queries, 8 results, one https link) between two tool calls of the same burst; exemplar: the om ledger scenario (~line 454). Verify: the scenario id is exported, and the fixture unit check (if any) is green.
- [x] 5.2 Update the collateral test (test-plan #F16) in `tests/e2e/subagent-fanout-admission.spec.ts` #F4 (and the quarantined #F2 replay assertion); exemplar for enabling a hidden group through the View popover: `tests/e2e/custom-entry-om-renderer.spec.ts`. Input: `[[faux:subagent-fanout-refused]]`. Trigger: run the scenario, then enable "Diagnostics". Observable: at first, no `custom-entry-card` with `subagent-admission-refused`, while the tool card is terminal with "Refused by host admission"; after enabling, the card is visible and shows `cause` and `cap` keys. Verify: green on the harness.
- [x] 5.3 New test (test-plan #F17), `tests/e2e/custom-entry-web-search.spec.ts`; exemplar: `tests/e2e/custom-entry-om-renderer.spec.ts`. Input: the 5.1 scenario. Trigger: send the prompt, then click the row. Observable: "2 queries · 8 results" shown inside the tool burst (`tool-burst-group` contains the row; the burst is not split); after the click, the result link has `rel="noopener noreferrer"`; exactly 1 request to `/api/sessions/:id/entry/:entryId`. Verify: green on the harness.
- [x] 5.4 Test (test-plan #F18), same spec; exemplar: `tests/e2e/custom-entry-replay-parity.spec.ts`. Input: the session from 5.3. Trigger: cold reload. Observable: the same collapsed summary text, and expanded detail equal to the live view. Verify: green on the harness.

## 6. Docs, review, closeout

- [x] 6.1 Update the `AGENTS.md` rows for the touched files (`custom-event-groups.ts`, `CustomEntryCard.tsx`, the new parse module, `event-reducer.ts` export, the new package tree, `faux-scenarios.ts`). Delegate the `docs/` prose (custom entry rendering / plugin list) to DocScribe. Add a CHANGELOG `[Unreleased]` entry: `diagnostics` is hidden by default, how to re-enable it, and that the group persists after a rollback. Verify: `scripts/check-conventions.mjs` and the dox byte gate pass.
- [x] 6.2 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and the `review-code` pass on the diff. Verify: 0 failed, and no blocking findings.
- [x] 6.3 Manual (test-plan: manual-only, #F19): check the visual quality of the web-access card (collapsed + expanded) and of the key/value fallback across studio / earth / athlete / gradient × light/dark. Verify: legible, aligned, and consistent with OmEntryCard chrome.
