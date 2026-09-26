## Context

Mockups: `mockups/index.html` (after, A1–A6) with live "before" screenshots in `mockups/before/`. Probe: `mockups/ux-probe.cjs` — axe WCAG 2.2 AA, **computed** contrast (canvas-resolved colour, ancestor backgrounds composited, because axe marks semi-transparent backgrounds "incomplete" and passes them), text-size floors, 44 px mobile targets, overflow, focus, console. Results in `mockups/ux-test.md`.

Baseline measured 2026-09-27 on the live folder card (light theme, `#fafafa` `--bg-secondary`): `green-400` 1.70, `orange-400` 2.28, `yellow-300` 1.27, `yellow-200` 1.12, `indigo-400` 2.99, `blue-400` 2.53, `red-400` 2.77, `--text-muted` 2.23 (dark 2.78). Static count on the 8 files: 116 raw palette classes, 110 sub-12 px text sizes, 37 hairline paddings, 49 `--text-muted`, `focus-ring` in 2 of 8 files.

## Goals / Non-Goals

**Goals:** the 8 listed surfaces pass the probe in dark and light; the look matches the ACP mockups; one written recipe in `ui-contract.md` so new UI follows it.

**Non-Goals:** repo-wide *style* sweep of other components (the D9 copy sweep IS repo-wide); a Biome/ESLint rule banning palette classes (possible follow-up once the recipe has settled); layout or copy changes; new themes; changing `--severity-*` values.

## Decisions

### D1 — Identity tints, severity as aliases
Add `--tint-{green,orange,blue,purple,red}-{bg,fg,border}` in the same `index.css` block as `--severity-*`, using the identical formula (`bg` = accent 10% into `--bg-tertiary`, `fg` = accent 46% toward `--text-primary`, `border` = accent 40% into transparent). Redefine `--severity-success-*` = `var(--tint-green-*)`, warning → orange, info → blue, error → red. Values are byte-identical after resolution, so the existing `message-severity-tokens` contrast gate still holds and covers the tints too.
- *Why not reuse `--severity-*` directly?* The spawn tray's green means "pi", not "success"; orange means "worktree", not "warning". Reusing severity names would blur semantics the `message-severity-tokens` spec keeps separate (e.g. "warning is visually distinct from working").
- *Why not new hand-picked hex per theme?* The `color-mix` derivation already clears the gate in every theme; hex would need a per-theme table.

### D2 — Colour mapping
| Meaning | Token | Examples |
|---|---|---|
| Identity: pi / new session | `--tint-green-*` | tray New Session, card `+ Session`, automation "enabled" badge (replaces `#6ee7b7`) |
| Identity: worktree | `--tint-orange-*` | tray New Worktree, card Worktree chip |
| Identity: fork, links, selected toggle | `--tint-blue-*` | card Fork, worktree source toggle `aria-pressed` |
| Identity: goals | `--tint-purple-*` | goal `+ New session`, subgoal add (replaces `indigo-*`) |
| Destructive | `--tint-red-*` | goal delete |
| Severity (warning/error/success/info) | `--severity-*` | worktree collision/orphan blocks (replaces `yellow-*`), error text (replaces `red-400`) |
| Status (working/idle/needs-you/ended) | `--status-*` | **shapes and dots only** |

**D2b — status colour on shape, not text.** `--status-working` is `--accent-yellow`: 1.84:1 as text in light. Status words ("Resuming…", "idle") render `--text-secondary` beside a coloured `StatusShapeBadge`-style shape. Replaces `SessionCard.tsx` `text-yellow-400` "Resuming…".

### D3 — Readable text tokens
Headings, field labels, help and error-adjacent text: labels `--text-primary` (600 weight), headings and help `--text-secondary`. The uppercase + `--text-muted` section-heading style (`text-xs uppercase tracking-wider text-[var(--text-muted)]`) becomes `text-[12px] font-semibold text-[var(--text-secondary)]` — no uppercase (readability of all-caps at 11 px is poor and it was the least legible text measured). `--text-muted` stays only in `disabled:` variants (exempt from WCAG 1.4.3) and on `aria-hidden="true"` decoration (separators, glyphs). Timestamps and counts are information, so they use `--text-secondary`. This makes the rule mechanically checkable (test-plan E5) without a new attribute.

### D4 — Primary action
`rounded-md bg-[var(--accent-solid)] px-3 text-white font-semibold` + disabled `disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]`. `--accent-solid` is documented at 5.17:1 under white in both themes. Secondary stays the contract's `border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]`.

### D5 — Size floors
- Text: nothing < 11 px; interactive (buttons, labels, links) and help text ≥ 12 px. Dense metadata (model name, path, cost) may stay 11 px — matches `ui-contract.md` "dense" row.
- Targets: every button `min-h-[44px]` below `sm`; from `sm:` chips and toggles `sm:min-h-[32px]`, form buttons `sm:min-h-[36px]`; horizontal padding ≥ `px-2.5` so width ≥ 44 px on mobile. Icon-only buttons (close ×, kebab) `min-w-[44px] sm:min-w-[32px]`.
- Recipe name in code: a small shared class list constant is **not** introduced (single-use per file would be premature abstraction); each file inlines the classes, and `ui-contract.md` holds the canonical strings.

### D6 — Focus
Every `<button>`/`<a>` on the surfaces gets the existing `focus-ring` utility (already used by `FolderSpawnButtons`). No new utility.

### D7 — Verification
- Port the probe to Playwright against the docker harness (`tests/e2e/ui-token-alignment.spec.ts`): folder card, worktree dialog (opened), goal detail (seeded goal), automation dialog (opened), select prompt (fixture). Scope the checks to the changed surfaces so unrelated components (folder header git pill, kb stale badge) don't fail this change — they are listed in `ux-test.md` as follow-up.
- Component tests updated where they assert palette classes; add unit assertions that the listed files contain no `(text|bg|border)-(green|orange|blue|yellow|indigo|red|amber|purple)-\d` and no `#[0-9a-f]{6}` in `className`.

### D8 — ui-contract.md
Fix the primary-button row (D4), add a "Colour roles" table (D2), the size floors (D5), "status colour on shape, not text" (D2b), and "use `--text-muted` only for decoration". Stale theme-count claims are left alone (out of scope).

### D9 — Copy: "new session", never "spawn"
"Spawn" is process jargon. User-facing English copy says **new session** (create), **start** (verb), **restart** (for respawn). Internal names stay: protocol messages (`spawn_session`), functions (`spawnSession`), config keys (`spawnStrategy`, `maxConcurrentSpawns`), testids, file names and **i18n keys** (renaming keys would break the Hungarian/Chinese tables and `i18n-legacy-aliases.ts`). Hungarian (`indítás`) and Chinese (`启动`) already say start/launch and are unchanged. Error banners already read "Pi started but never connected…" and are unchanged.

Inventory (2026-09-27, every English string containing spawn/respawn across `packages/*/src` code fallbacks + `packages/client/src/lib/i18n-en-source.json`; 23 strings, 0 hard-coded JSX literals):

| key | where | now | new |
|---|---|---|---|
| `fieldCount` | automation-plugin CreateAutomationDialog | Spawn count | Sessions per run |
| `git.spawnIntoThatWorktree` | client WorktreeSpawnDialog | Spawn into that worktree → | New session in that worktree → |
| `session.spawnASessionAttachedToThis` | client OpenSpecBoardView | Spawn a session attached to this proposal | New session for this proposal |
| `worktree.spawnAWorktreeForThisProposal` | client OpenSpecBoardView | Spawn a worktree for this proposal | New worktree session for this proposal |
| `session.spawnsASessionRunningTheNew` | client OpenSpecBoardView | Spawns a session running the new-change flow. … | Starts a new session running the new-change flow. … |
| `session.createSpawn` | client | Create & spawn | Create & start session |
| `session.spawnWorktreeTitle` | client SessionCard | Create git worktree + spawn session inside it | Create a git worktree and start a new session in it |
| `session.noSpawnFailuresRecorded` | client | No spawn failures recorded. | No failed session starts recorded. |
| `piRuntime.colSpawn` | client PiRuntimeSection | Spawn | New sessions |
| `piRuntime.laneSpawn` | client PiRuntimeSection | Sessions spawn | New sessions |
| `landing.addFolderDescription` | client LandingPage | … so you can spawn sessions inside it. | … so you can start new sessions inside it. |
| `common.howLongToWaitForA` | client settings | How long to wait for a spawned pi session to connect … | How long to wait for a new pi session to connect … |
| `git.gitSourceTakesEffect` | client settings | Takes effect for newly spawned sessions. … | Takes effect for new sessions. … |
| `settings.capturePiOutputHint` | client settings | … Applies to newly spawned sessions. | … Applies to new sessions. |
| `settings.hint.enableOpenspecPolling` | client settings | … and spawn sessions for them. … | … and start new sessions for them. … |
| `settings.hint.maxConcurrentSpawns` | client settings | Upper bound on sessions polling spawns at once. … | Maximum new sessions OpenSpec polling starts at once. … |
| `settings.hint.toolAgent` | client settings | Subagent spawns. | New subagent sessions. |
| `worktree.afterSpawningAWorktreeAutoRun` | client settings | After spawning a worktree, automatically run its declared | After creating a worktree session, automatically run its declared |
| `worktree.showWorktreeSpawnButtonsInFolders` | client settings | Show worktree spawn buttons in folders and OpenSpec rows | Show New Worktree buttons in folders and OpenSpec rows |
| `rolesDepAliasesReport` | subagents/roles settings | … “not configured yet” at spawn time — … | … “not configured yet” when a session starts — … |
| `autoRespawnDefaultLabel` | goal-plugin settings | Auto-respawn new goals by default | Auto-restart new goals by default |
| `autoRespawnLabel` | goal-plugin | Auto-respawn on driver death (bounded by budget + crash-loop breaker) | Auto-restart on driver death (bounded by budget + crash-loop breaker) |
| `autoRespawnHelp` | goal-plugin settings | … the dashboard respawns it to keep pursuing … | … the dashboard starts a new one to keep pursuing … |

Both the `i18nT`/`t` fallback string in code and the `i18n-en-source.json` value change together.

## Risks / Trade-offs

- **Dark theme drift** → tints mix 46% toward `--text-primary`, so dark text is slightly lighter than `*-400`; checked in mockup screenshots, visually equivalent.
- **Taller controls** → session cards grow a few px; card action row wraps on narrow sidebars. Accepted (targets were 14–23 px).
- **Merge overlap with `add-acp-session-driver`** → both edit `FolderSpawnButtons`, `WorktreeSpawnDialog`, `GoalDetailClaim`. The ACP mockups already use these recipes; second lander rebases.
- **Class-name tests** → snapshot/class assertions break; updated in the same task as each file.

## Migration Plan

Client-only: `npm run build` + restart. Rollback = revert. No data or config.

## Open Questions

- Should the kb "stale" badge and folder-header git pill (also failing, outside the 8 files) be a follow-up change? Proposed: yes, same recipe.
