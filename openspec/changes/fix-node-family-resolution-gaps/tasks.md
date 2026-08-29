# Tasks — fix-node-family-resolution-gaps

Test tasks in group 1 are folded from `test-plan.md`; that manifest is the source of
truth for automated-vs-manual. TDD ordering: author each test and see it RED before
the matching fix in groups 2–3.

## 1. Folded scenarios — registry chain (L1)

Harness exemplar for all of 1.x: `packages/shared/src/__tests__/tool-registry-definitions.test.ts`
(`freshRegistry` helper with injected `exists`/`which`).

- [ ] 1.1 Test npx resolves the managed runtime over a PATH hit. Input: `<managedDir>/node/bin/npx` exists, `which("npx")` returns `/usr/bin/npx` · Trigger: `resolve("npx")` · Observable: `Resolution.path === <managedDir>/node/bin/npx`, not the PATH hit. MUST fail today. (test-plan #E1)
- [ ] 1.2 Test override still outranks the managed runtime. Input: override for `npx` → existing file, managed runtime also provides npx · Trigger: `resolve("npx")` · Observable: `path` === override path and `source === "override"`. (test-plan #E2)
- [ ] 1.3 Test bundled-node still outranks the managed runtime. Input: `<resourcesPath>/node/bin/npx` and `<managedDir>/node/bin/npx` both exist · Trigger: `resolve("npx")` · Observable: `path` === the `<resourcesPath>` one. (test-plan #E3)
- [ ] 1.4 Test a partial managed family falls through cleanly. Input: `<managedDir>/node/` exists without `bin/npx`, `MANAGED_BIN/npx` exists · Trigger: `resolve("npx")` · Observable: `path === MANAGED_BIN/npx`, the managedRuntime `tried[]` entry reads `missing: <probed path>`, and no non-existent path is returned. (test-plan #E4)
- [ ] 1.5 Test managedRuntime outranks managedBin. Input: both `<managedDir>/node/bin/npx` and `<managedDir>/node_modules/.bin/npx` exist · Trigger: `resolve("npx")` · Observable: `path === <managedDir>/node/bin/npx`. (test-plan #E5)
- [ ] 1.6 Test the PATH fallback is preserved. Input: no override/bundled/managed roots, `which("npx")` → `/usr/bin/npx` · Trigger: `resolve("npx")` · Observable: `path === /usr/bin/npx` and `source === "system"`. (test-plan #E6)
- [ ] 1.7 Test the managed runtime is visible to every family member. Input: `<managedDir>/node/bin/{node,npm,npx}` all exist, no override/bundled · Trigger: resolve all three · Observable: all three paths share the `<managedDir>/node` prefix and none resolves via `where`. (test-plan #E7)
- [ ] 1.8 Test the trail order and length. Input: every root missing (`exists: () => false`, `which: () => null`) · Trigger: `resolve("npx")` · Observable: `tried[]` names in order `["override","bundled-node","managed","managed","where"]`, length 5 — assert ORDER and LENGTH only, since managedRuntime and managedBin both report `name: "managed"`. (test-plan #E8)

## 2. Folded scenarios — badge rendering (L1)

Harness exemplar for 2.1–2.6 and 2.8–2.9: `packages/client/src/components/settings/__tests__/PiRuntimeStatusRow.test.tsx`.
Exemplar for 2.7: `packages/client/src/components/settings/__tests__/settings-unit-i18n.test.tsx`.

- [ ] 2.1 Test the rejected-override indicator on a not-found row. Input: `{ok:false, path:null, tried:[{strategy:"override", result:"invalid: path does not exist: /nope/bin/node"}, …]}` · Trigger: row renders collapsed · Observable: badge state distinct from BOTH the plain not-found state and the fallback state, tooltip contains `/nope/bin/node`. MUST fail today (`ToolsSection.tsx:458` gates on `tool.ok`). (test-plan #F1)
- [ ] 2.2 Test a not-found row without an override is unchanged. Input: `{ok:false, tried:[{strategy:"override", result:"no override set"}, …]}` · Trigger: renders collapsed · Observable: plain not-found badge, no override wording in the tooltip. (test-plan #F2)
- [ ] 2.3 Test a resolved + rejected row keeps the existing indicator. Input: `{ok:true, source:"system", tried:[…override invalid…]}` · Trigger: renders collapsed · Observable: the existing fallback badge, behaviour identical to today. (test-plan #F3)
- [ ] 2.4 Test a resolved clean row is unchanged. Input: `{ok:true, source:"system"}`, no override entry · Trigger: renders collapsed · Observable: the ordinary resolved badge. (test-plan #F4)
- [ ] 2.5 Test the wording distinguishes fell-back from did-not-resolve. Input: two rows — (a) `{ok:false}` + rejected override, (b) `{ok:true}` + rejected override · Trigger: both render · Observable: (a)'s tooltip does not assert a fallback occurred; (b)'s retains the existing fallback phrasing. (test-plan #F5)
- [ ] 2.6 Test an unparseable rejection reason still indicates. Input: `{ok:false, tried:[{strategy:"override", result:"invalid: validator said no"}]}` with no path in the reason · Trigger: renders collapsed · Observable: rejected state still shown, tooltip degrades to the reason text, no empty path / `undefined` / `null` rendered. (test-plan #F6)
- [ ] 2.7 Test i18n parity for the new tooltip key. Input: the new catalog key · Trigger: `i18n:lint` / `i18n:parity` · Observable: key resolves in `en`, `zh-CN`, and `hu` per `ui-i18n-coverage` spec:72. (test-plan #F7)
- [ ] 2.8 Test the badge tolerates a trail-less payload. Input: `Resolution` with `tried: []` or absent (older server / plugin-sourced row) · Trigger: row renders · Observable: no throw, degrades to the plain not-found state. (test-plan #X1)
- [ ] 2.9 Test a rejected path with a space and non-ASCII renders intact. Input: `result:"invalid: path does not exist: /home/t/ünïcode dir/bin/node"` · Trigger: renders collapsed · Observable: tooltip contains the exact path including the space and non-ASCII characters. (test-plan #X2)

## 3. Confirm red

- [ ] 3.1 Confirm 1.1, 1.4, 1.5, 1.7, 1.8, 2.1, 2.5, 2.6 fail for the RIGHT reason —
      read each assertion message, do not just observe red. The remaining rows are
      regression guards and are expected to pass before the fix; note which ones do.

## 4. Implement — npx chain

- [ ] 4.1 Add `managedRuntimeStrategy("npx", deps)` to `npxBinaryDef` between
      `bundledNodeStrategy` and `managedBinStrategy` (`definitions.ts:263-272`).
- [ ] 4.2 Update the existing chain test this breaks:
      `packages/shared/src/__tests__/tool-registry-definitions.test.ts:293` asserts the
      npx trail is exactly `["override","bundled-node","managed","where"]`, and its
      title `"npx chain: override → bundled-node → managed (bin) → where"` also becomes
      wrong. Reconcile it with 1.8 rather than duplicating.
- [ ] 4.3 Verify group 1 green.

## 5. Implement — badge gating

- [ ] 5.1 Change `StatusBadge` gating so a rejected override renders a THIRD state on
      `ok: false` rows, distinct from both existing states, tooltip naming the rejected
      path. Scope: gating condition, the new state, tooltip content, and the minimal
      prop/derivation change 2.1 forces (`invalidOverride` is a boolean prop declared
      at `:457`; the path is not available to the badge today). Do NOT rebuild
      `invalidOverride` (`:238-241`), the inline expanded warning (`:331-334`), the
      trail render (`:294-299`), or the payload — all already ship.
- [ ] 5.2 Add the new tooltip string as a catalog key in `en`, `zh-CN`, AND `hu`.
      `i18n:lint`/`i18n:parity` enforce this at the ship gate; an inline English-only
      fallback will trip it.
- [ ] 5.3 Implement the path-extraction rule. Two writers emit `invalid:` reasons —
      `overrideStrategy` (`strategies.ts:264`, path present) and the registry's
      validate demotion (`registry.ts:175`, no path guaranteed). Prefer reading the
      configured path from the overrides source over parsing prose; if parsing, handle
      the unparseable case per 2.6.
- [ ] 5.4 Verify group 2 green.

## 6. Spec alignment (documentation only, no code)

- [ ] 6.1 Confirm the delta's `node`/`npm`/`npx` chain scenarios match the implemented
      chains on BOTH platforms after 4.1.
- [ ] 6.2 Confirm the MODIFIED "Registered tool set" block carries forward EVERYTHING
      it replaces: the minimum-tool-set enumeration + `classify` sentence, and the
      `pi`, `pi-coding-agent`, and `bash strategy chain` scenarios. A MODIFIED block
      replaces the main-spec block wholesale, so anything omitted is DELETED on sync,
      and `openspec validate --strict` does NOT catch content deletion. Diff the
      post-sync requirement against `openspec/specs/tool-registry/spec.md:100-134`.
- [ ] 6.3 Confirm the MODIFIED `bash` requirement drops the stale sentence at
      `openspec/specs/tool-registry/spec.md:350` ("This proposal does not modify the
      `npx` registration"), which the npx fix contradicts.
- [ ] 6.4 Update `packages/shared/src/tool-registry/AGENTS.md` row for `definitions.ts`
      with a `See change:` marker.
- [ ] 6.5 Update `packages/client/src/components/settings/ToolsSection.tsx.AGENTS.md`.

## 7. Verify

- [ ] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep
      `FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)`. Full suite — 4.2 exists because
      this change breaks an existing test on purpose.
- [ ] 7.2 Rebuild per the `implement` matrix: `shared` + `client` → `npm run build`
      then `curl -X POST localhost:8000/api/restart`.
- [ ] 7.3 `openspec validate fix-node-family-resolution-gaps --strict`.

## 8. Manual verification (deferred post-merge)

- [ ] 8.1 Visually confirm the three badge states are tellable apart at a glance in
      Settings → Tools, with one rejected-override row, one plain not-found row, and
      one fallback row on screen together. (test-plan: manual-only)

## 9. Close the loop with the reporter

- [ ] 9.1 Request: `curl -s localhost:8000/api/tools | jq '.data.tools[]|select(.name|test("^(node|npm|npx)$"))|{name,ok,path,source,tried}'`,
      `cat ~/.pi/dashboard/tool-overrides.json`, `ls -l ~/.nvm/versions/node/`,
      `which -a node npm npx`, and `echo "$APPDIR / $APPIMAGE"`.
      NOTE the envelope: `/api/tools` returns `{success, data:{tools:[…]}}`
      (`tool-routes.ts:70`) — a top-level `.[]` filter silently prints NOTHING, which
      is indistinguishable from "no trail" and would close 9.3 on false evidence.
- [ ] 9.2 Set expectations in the reply: this change does NOT fix their `npx` = v22 row
      (no managed runtime present in their snapshot — see proposal "Relationship to the
      report"). It makes a rejected override visible if that is what they hit.
- [ ] 9.3 If the trail shows `appimage-self-hit:` on the `node` row, that confirms the
      live Rule-2 candidate named in "Not in scope" — open a follow-up change scoping
      `isAppImageSelfHit` to the launcher-name collision it was written for.
