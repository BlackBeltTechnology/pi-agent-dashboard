---
session: b6abda91
week: 2026/W16
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (23 user prompts)"
upgrade_status: pending
---

# How we did it: Wiring the Electron + npm release pipeline — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was narrow:

> "Check the local docker builders and check CI contains everything - because local build was tested"

The *real* objective grew across 23 steering turns into something much larger: **get the
project actually shippable end-to-end.** That meant (1) closing the gap between the
tested local Docker/installer build and CI, (2) making the cross-platform Electron
builds (DMG / DEB / AppImage / NSIS) succeed on macOS, Linux, and Windows runners, and
(3) standing up an npm publish pipeline with GitHub OIDC provenance — all triggered from
a single `v*` tag push. The session ended one manual step short: the npm package had to
be **renamed to match the GitHub repo** so OIDC would trust it.

## 2. TL;DR playbook

1. **Diff local build vs CI first.** Read `build-installer.sh` / `bundle-server.sh` and the CI workflow side-by-side. The killer bug: CI never ran `bundle-server.sh`, so the Electron app shipped with **no dashboard server** (forge silently skips a missing `resources/server/`).
2. **Add the bundle step** to CI *after* client build, *before* `electron:make`, with `shell: bash` so it also runs on the Windows runner.
3. **Fix the lint gate** (`tsc --noEmit`): exclude `packages/*/dist` (kills TS6305 stale-`.d.ts`) and drop unused project `references` (kills TS6306). Ignore the ~82 *pre-existing* type errors — they are out of scope.
4. **Feed electron-builder its metadata:** add a `repository` field to `packages/electron/package.json` (NSIS maker needs it) and install `libfuse2` on the Linux runner (AppImage's `appimagetool` needs FUSE).
5. **Shrink the npm tarball** before publishing: a naïve `files` field packed 1.9 GB (`ERR_STRING_TOO_LONG`). Scope `files` to server/shared/extension `src/` + built client `dist/`; exclude `packages/electron/`, client `node_modules/`, and `docs/screenshots/`. Result: **271 KB**.
6. **Copy a working reference.** Clone `BlackBeltTechnology/pi-model-proxy` and lift its **OIDC provenance** publish pattern (`id-token: write` + `npm publish --provenance`, *no* `NPM_TOKEN`).
7. **Merge the two workflows into one `release.yml`** with parallel jobs: `publish` (npm), `electron` (×3 OS matrix), `github-release` (`needs:` the others). Set version from the tag: `npm version "${GITHUB_REF_NAME#v}" --workspaces --include-workspace-root` — no more hardcoded `0.2.0`.
8. **Make the release resilient:** `github-release` uses `if: always() && needs.electron.result == 'success'` so artifacts still ship even if npm publish 404s.
9. **Reconcile the OIDC name mismatch (the real root cause):** npm package `@blackbelt-technology/pi-dashboard` ≠ repo `pi-agent-dashboard`. Rename the npm package to `@blackbelt-technology/pi-agent-dashboard`, do one manual `npm publish --access public`, then link the trusted publisher (repo + `release.yml`) on npmjs.com.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (CI vs local gap analysis).** The AI read the local build
scripts and forge config, then produced a clean 🔴/🟡/✅ gap report. The headline
finding — CI skips `bundle-server.sh`, shipping a server-less app — was the single most
valuable output of the session. *Why it worked:* comparing the **known-good** local path
against CI turned a vague "does CI have everything?" into a specific, testable defect.

**Phase 2 — Land the fixes, hit the lint wall.** The AI added the bundle step and
deduplicated the redundant macOS universal job. The user then pasted a `tsc --noEmit`
failure. The AI correctly separated the **config-caused** errors (TS6305/TS6306, which
its fix owned) from **pre-existing** type errors (82 of them) and asked whether to touch
the latter. *Decision point:* the user kept scope tight — fix the config, leave the 82.

**Phase 3 — Whack-a-mole on the Electron matrix.** Three consecutive failure pastes
drove three targeted fixes: NSIS wants a `repository` field → add it; AppImage wants
FUSE → `apt install libfuse2`. *Why it worked:* each fix was a direct read of the
platform tool's own error message, not a guess.

**Phase 4 — npm publish, the long tail.** This consumed the back half of the session.
The AI first proposed `NPM_TOKEN`, but the user redirected to the `pi-model-proxy`
reference, which used **OIDC provenance**. The AI cloned it, adopted the pattern, then
fought `ERR_STRING_TOO_LONG` (1.9 GB tarball → 271 KB via a scoped `files` field), then
a persistent `E404` on publish. It cycled through hypotheses — OIDC propagation delay,
workflow-filename mismatch after the `publish.yml`→`release.yml` rename, dual-release
conflicts — before the user's insight *"maybe the github and pi package name differs"*
pinpointed the true cause: the **OIDC subject claim includes the repo name**, and npm
checks it against the trusted-publisher config. The package name didn't match the repo.

**Phase 5 — Consolidate & rename.** The AI merged both workflows into one parallel
`release.yml`, made the GitHub release resilient to publish failure, and renamed the npm
package to match the repo. It handed back the final three manual steps (first publish,
trusted-publisher link, retag).

## 4. Prompts that worked

- **Goal prompt** — *"Check the local docker builders and check CI contains everything - because local build was tested."* Effective because it named a **known-good baseline** ("local build was tested") to diff CI against. A stronger version: *"The local installer build works. Diff it against the CI Electron workflow and list every step CI is missing, then fix them."*
- **High-leverage redirect** — *"There is other way. Check https://github.com/BlackBeltTechnology/pi-model-proxy."* One line replaced a whole `NPM_TOKEN` setup with the OIDC-provenance pattern. Pointing the AI at a **working sibling repo** is far faster than describing the desired config.
- **The breakthrough hunch** — *"maybe the github and pi package name differs."* A short domain-knowledge nudge that ended a long debugging loop. Lesson: when the AI is cycling hypotheses, a human's structural guess about **root cause** is worth more than another retry.
- **Terse decisions** — *"yes"*, *"rename"*, *"Currently not released."* — kept momentum; the last two unblocked scope decisions instantly.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for `NPM_TOKEN` as the default publish auth | Pointing at `pi-model-proxy` as the OIDC reference | Default to **OIDC provenance** (`id-token: write` + `--provenance`), no long-lived token |
| Treat all `tsc` errors as in-scope | Implicitly (AI asked; user held scope) | Separate **config-caused** vs **pre-existing** errors and ask before touching the latter |
| Debug the `E404` as propagation/config drift | *"maybe the github and pi package name differs"* | Verify **npm scope/name == GitHub repo name** before configuring OIDC trusted publishing |
| Leave two workflows both minting a GitHub Release | (surfaced by conflict) | One `release.yml` with a single `github-release` job `needs:` the build jobs |
| Ship the whole monorepo in the npm tarball | The 1.9 GB `ERR_STRING_TOO_LONG` failure | Scope `files` to source + built `dist/` only; run `npm pack --dry-run` before publishing |
| Assume the version from `package.json` | The hardcoded-`0.2.0` mismatch on tag builds | Derive version from the tag: `npm version "${GITHUB_REF_NAME#v}" --workspaces --include-workspace-root` |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created in this session — it was pure hands-on
build-pipeline work. But the workflow is highly repeatable and **should** be captured:

- **Recommended skill: `wire-npm-oidc-release`** — a project skill encoding the full
  chain: bundle-server-in-CI check → electron matrix metadata (`repository` + `libfuse2`)
  → scoped `files` field with `npm pack --dry-run` guard → single parallel `release.yml`
  → OIDC name-match precondition (npm scope/name == GitHub repo). *Why effective:* this
  session spent ~50 minutes and $2.67 rediscovering each gotcha; a skill collapses it to
  a checklist and prevents the `E404` name-mismatch dead-end entirely.
- **Recommended memory (project):** "npm package name **must equal** the GitHub repo name
  for OIDC trusted publishing — the OIDC subject claim carries the repo name and npm
  matches it." This one fact would have saved the entire Phase-4 debugging loop.

## 7. Pitfalls & dead ends

- **Server-less Electron app** — forge's `fs.existsSync("./resources/server") ? [...] : []`
  spread means a missing bundle step fails **silently**. If the built app has no server,
  check that CI runs `bundle-server.sh` *before* `electron:make`.
- **`ERR_STRING_TOO_LONG` on publish** — you're packing `node_modules`/artifacts. Fix the
  `files` field and always `npm pack --dry-run | grep "package size\|total files"` first.
- **NSIS "Cannot detect repository by .git/config"** — add a `repository` field to
  `packages/electron/package.json`.
- **AppImage "AppImages require FUSE"** — `apt-get install -y libfuse2` on the Linux runner.
- **`bundle-server.sh` on Windows** — set `shell: bash` (Git Bash ships `cp -R`/`rm -rf`/`du`).
- **Persistent npm `E404` under OIDC** — not propagation delay. The **package name must
  match the repo name**; and after renaming a workflow file, update the trusted-publisher
  **workflow filename** on npmjs.com (`publish.yml` → `release.yml`).
- **`github-release` skipped when publish fails** — `needs: [publish, electron]` blocks it
  on any failure. Use `if: always() && needs.electron.result == 'success'`.
- **Duplicate macOS build** — forge forces `arch: "universal"` on darwin, so a second
  `x64` runner produces an identical artifact. One macOS job suffices.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** local installer build that already works (the baseline);
push access to the GitHub repo; owner rights on the npm org (`@blackbelt-technology`);
the sibling reference repo (`pi-model-proxy`) for the OIDC pattern.

- [ ] Diff `build-installer.sh` / `bundle-server.sh` against the CI workflow.
- [ ] Add the `bundle-server.sh` step to CI (`shell: bash`), before `electron:make`.
- [ ] Fix `tsconfig.json`: exclude `packages/*/dist`, drop unused `references`.
- [ ] `packages/electron/package.json` → add `repository`; Linux runner → `libfuse2`.
- [ ] Scope root `package.json` `files`; verify with `npm pack --dry-run`.
- [ ] **Precondition:** npm scope/name == GitHub repo name. Rename the package if not.
- [ ] One `release.yml`, parallel `publish` + `electron` (×3) + `github-release`; version from tag.
- [ ] First manual `npm publish --access public`, then link trusted publisher (repo + `release.yml`).
- [ ] `git tag -f v0.2.1 && git push -f origin v0.2.1`.

**Artifacts produced this session:**
`.github/workflows/release.yml` (created, merged from `publish.yml` + `electron-build.yml`),
`.github/workflows/publish.yml` (created then removed in merge),
`.github/workflows/electron-build.yml` (edited then removed in merge),
`tsconfig.json`, `packages/electron/package.json`, `package.json` (root, incl. rename),
`packages/electron/src/lib/dependency-installer.ts`.

---

_Generated from session `b6abda91-077e-49ac-bed3-84cd8c7d406d` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-13. Source extract: session facts sheet (extract_session.ts)._
