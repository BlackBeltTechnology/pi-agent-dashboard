## Why

`npm test` does not exit clean on a developer machine while CI is green on the same commit, and the failing set **rotates between runs** — jimp/bus-client in one session, `useImagePaste` in another. A rotating red set trains developers to dismiss failures as "pre-existing", which is exactly how a real regression gets waved through. Both root causes are violations of already-shipped requirements, not new ground.

Measured on clean `develop` @ `3053db19` (CI: 0 failures):

| run | workers | failures |
|---|---|---|
| CI (ubuntu, `--frozen-lockfile`) | default | 0 |
| local `npm test` | 8 (`50%` of 16) | 3 |
| local `npm test --maxWorkers=2` | 2 | 1 |
| `useImagePaste.test.ts` alone | — | 0 |
| all 39 `client/src/hooks` files | — | 0 |

## What Changes

- **Exclude gitignored trees from the skill-frontmatter guard.** `collectSkillManifests()` prunes by directory basename (`dist`, `build`, `out`, `.next`, `coverage`, `.worktrees`, …). `packages/electron/resources/bundled-extensions/` matches none of them, so the walk descends into it and picks up the 13 `SKILL.md` files it holds (out of 80 collected repo-wide). Two of those 13 — `release-cut` at 411 chars and `release-revoke` at 431, both vendored copies from the third-party `pi-anthropic-messages` package — exceed the 400-char description budget, failing `has no budget warning outside the exempt skills`. The directory is gitignored (`.gitignore:26`) and is **stale residue** — `packages/electron/forge.config.ts:109` records that bundled-extensions resources were removed under `eliminate-electron-runtime-install`, so nothing populates it any more. It persists only on machines that ran the old build; a fresh checkout, and therefore CI, never sees it. Exclusion SHALL be driven by git-ignore status so that any generated or vendored tree is skipped regardless of its name.

- **Remove fixed-tick async waits from client tests — all of them.** `useImagePaste.test.ts` uses `flushFileReader() = 2 × setTimeout(0)` then asserts one-shot; under contention the `FileReader` callback has not landed, giving `expected [] to have a length of 2`. The `parallel-test-execution` spec already requires polled assertions over "a fixed number of macrotask ticks", but **11 client test files** await a bare `setTimeout`. **10 are barriers** gating a one-shot assertion — pre-existing violations of a shipped requirement, converted to `waitFor`. The 11th, `PairLanding.test.tsx:54`, yields a macrotask *inside a `postJson` mock* to let React commit a render; it gates no assertion, is already commented, and is left alone as the guard's opt-out exemplar. Then add a guard test that hard-fails on the barrier pattern so it cannot return.

- **Give `maxWorkers` a single source of truth.** 28 vitest configs declare a worker setting independently — 21 at `"50%"`, **7 deliberately serial at `1`** (`electron`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription`). **No value changes.** The parallel target moves behind one module at the repo root, imported by relative path so no package gains a workspace dependency; the 7 serial projects keep their explicit `1` and do not import it. Maintainability fix, not a behaviour fix.

- **NOT in scope — and why the obvious suspects are innocent:**
  - *Worker-count throttling.* An earlier draft proposed reducing `maxWorkers` when the machine is already loaded. It was cut: the load average is only observable at config-evaluation time, i.e. **before** vitest forks, so it cannot see the contention the run itself creates. Sampled ambient load on the affected machine is ~9.9 against 16 cores, which selects the same 8 workers that fail. Throttling also treats the symptom; the 11 fixed-tick tests are the actual race, and once they poll, worker count stops mattering.
  - *`@earendil-works/pi-coding-agent` version skew.* `packages/server` declares `^0.83.0` and `pnpm-lock.yaml` resolves **0.83.0** — the lockfile is correct. A local `packages/server/node_modules/` holding 0.81.1 is a **stale install**, not a lockfile problem, and `pnpm install` corrects it. Recorded so the next investigator does not chase it.

## Capabilities

### New Capabilities

None. Both defects are gaps in shipped requirements.

### Modified Capabilities

- `skill-frontmatter-validity`: the existing exclusion ("excluding `node_modules`, build output, and worktree checkouts") SHALL be enforced by git-ignore status in addition to — not instead of — the basename prune, so generated and vendored trees are excluded regardless of name, and the guarantee survives when git is unavailable.
- `parallel-test-execution`: the existing prohibition on fixed-tick waits SHALL be machine-enforced by a guard test and the client suite SHALL be brought into compliance; the worker setting SHALL be defined once rather than duplicated per package.

## Impact

- `scripts/check-skill-frontmatter.mjs` — `collectSkillManifests()` exclusion logic
- `scripts/__tests__/skill-frontmatter.test.mjs` — coverage for gitignored trees, degraded mode, Windows separators
- **10 client test files converted** (fixed-tick barrier → `waitFor`) — `useImagePaste`, `WorktreeActionsMenu`, `PluginStalenessBanner`, `UnifiedPackagesSection.auto-check`, `PathPicker`, `LlmProviderCard`, `ServerSelector`, `PiUpdateBadge`, `chat-input-draft-integration`, `usePiChangelog`
- **1 client test file annotated, not converted** — `PairLanding.test.tsx` gains an explicit opt-out comment on its existing mock yield
- New guard test banning fixed-tick barriers in client tests
- 21 `vitest.config.ts` files import a new repo-root worker module; the 7 serial configs are untouched. No effective worker count changes anywhere
- No production code changes. No API, dependency, or protocol changes.
