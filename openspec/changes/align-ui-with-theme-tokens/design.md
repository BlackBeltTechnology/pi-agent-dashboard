## Context

Mockups: `mockups/index.html` (after, A1–A6) with live "before" screenshots in `mockups/before/`. Probe: `mockups/ux-probe.cjs` — axe WCAG 2.2 AA, **computed** contrast (canvas-resolved colour, ancestor backgrounds composited, because axe marks semi-transparent backgrounds "incomplete" and passes them), text-size floors, 44 px mobile targets, overflow, focus, console. Results in `mockups/ux-test.md`.

Baseline measured 2026-09-27 on the live folder card (light theme, `#fafafa` `--bg-secondary`): `green-400` 1.70, `orange-400` 2.28, `yellow-300` 1.27, `yellow-200` 1.12, `indigo-400` 2.99, `blue-400` 2.53, `red-400` 2.77, `--text-muted` 2.23 (dark 2.78). Static count on the 8 files: 116 raw palette classes, 110 sub-12 px text sizes, 33 hairline paddings, 49 `--text-muted`, `focus-ring` in 2 of 8 files.

## Goals / Non-Goals

**Goals:** the listed surfaces (8 files + `DashboardSpawnButtons.tsx` + the copy-touched `OpenSpecBoardView.tsx` controls, review #9) pass the probe in dark and light; the look matches the ACP mockups; one written recipe in `ui-contract.md` so new UI follows it.

**Non-Goals:** repo-wide *style* sweep of other components (the D9 copy sweep IS repo-wide); a Biome/ESLint rule banning palette classes (possible follow-up once the recipe has settled); layout changes (except the status shape D2b adds); new themes; changing `--severity-*` values.

## Decisions

### D1 — Identity tints, severity as aliases
Add `--tint-{green,orange,blue,purple,red}-{bg,fg,border}` in the same `index.css` block as `--severity-*`, using the identical formula (`bg` = accent 10% into `--bg-tertiary`, `fg` = accent 46% toward `--text-primary`, `border` = accent 40% into transparent). Redefine `--severity-success-*` = `var(--tint-green-*)`, warning → orange, info → blue, error → red. Severity values are byte-identical after resolution. **Contrast gate (review #1/#2):** the tints are measured with the existing *relative* gate of `message-severity-tokens` (`tests/e2e/severity-contrast.spec.ts`: 3:1 floor on every one of the 18 theme×mode combos (9 themes × light/dark in `lib/theme/themes.ts`), AA 4.5 on the majority) — not an absolute 4.5 everywhere, which that spec declares unsatisfiable. Absolute AA 4.5:1 is required only on the default `dark`/`light` themes (what the mockup and probe measure). `purple` is new and has no severity twin: measured tokyo-night light 2.88 (below floor), catppuccin light 4.03, rose-pine light 4.04. Blue measures 2.71 on tokyo-night light — the same resolved colours as the already-excepted `info` cell, since info aliases blue. Exceptions become `tokyo-night/light/{info,blue,purple}: 2.5` (two distinct colour pairs; the existing `link` tool-surface exception is kept). Tints are swept as a separate `TINT_TIERS` list so `ALL_TIERS` and its distinct-bg assertion (`severity-contrast.spec.ts:250-252`) stay valid; the majority threshold (≥ 55 of 90) applies to each sweep separately (cycle-3 #2/#3), same rationale as today (that theme's body text is itself 3.5:1). This widens the existing "ONE exception" requirement, so the spec delta MODIFIES it (cycle-2 #1/#2). **Pairing rule (cycle-2 #8):** a tint `fg` is only ever rendered on its own tint `bg` (every tinted control in D2 is a filled chip/button/pill); tint text directly on `--bg-secondary` would measure as low as 3.38 on tokyo-night light and is not allowed.
- *Why not reuse `--severity-*` directly?* The spawn tray's green means "pi", not "success"; orange means "worktree", not "warning". Reusing severity names would blur semantics the `message-severity-tokens` spec keeps separate (e.g. "warning is visually distinct from working").
- *Why not new hand-picked hex per theme?* The `color-mix` derivation already tracks every theme; hex would need an 18-map table.

### D2 — Colour mapping
| Meaning | Token | Examples |
|---|---|---|
| Identity: pi / new session | `--tint-green-*` | tray New Session, card `+ Session`, automation "enabled" badge (replaces `#6ee7b7`) |
| Identity: worktree | `--tint-orange-*` | tray New Worktree, card Worktree chip, card worktree badge |
| Identity: fork, links, selected toggle | `--tint-blue-*` | card Fork, worktree source toggle `aria-pressed` |
| Selected session card | `--tint-blue-border` (ring + border), `--tint-blue-bg` | replaces `SessionCard.tsx:885,1014` `ring-1 ring-blue-500/30 border-blue-500/60 bg-blue-500/5` |
| Identity: goals | `--tint-purple-*` | goal `+ New session`, subgoal add (replaces `indigo-*`) |
| Destructive | `--tint-red-*` | goal delete |
| Severity (warning/error/success/info) | `--severity-*` | worktree collision/orphan blocks (replaces `yellow-*`), error text (replaces `red-400`) |
| Status (working/idle/needs-you/ended) | `--status-*` | **shapes and dots only** |

**D2b — status colour on shape, not text.** `--status-working` is `--accent-yellow`: 1.84:1 as text in light. Status words ("Resuming…", "idle") render `--text-secondary` beside a coloured `StatusShapeBadge`-style shape. Replaces `SessionCard.tsx:85` `text-yellow-400` "Resuming…", which today is a bare word: this adds a small `--status-working` shape before it (the only layout change in this change, review #12).

### D3 — Readable text tokens
Headings, field labels, help and error-adjacent text: labels `--text-primary` (600 weight), headings and help `--text-secondary`. The uppercase + `--text-muted` section-heading style (`text-xs uppercase tracking-wider text-[var(--text-muted)]`) becomes `text-[12px] font-semibold text-[var(--text-secondary)]` — no uppercase (readability of all-caps at 11 px is poor and it was the least legible text measured). `--text-muted` stays only in `disabled:` variants (exempt from WCAG 1.4.3) and on `aria-hidden="true"` decoration (separators, glyphs). Timestamps and counts are information, so they use `--text-secondary`. This makes the rule mechanically checkable (test-plan E5) without a new attribute.

### D4 — Primary action
`rounded-md bg-[var(--accent-solid)] px-3 text-white font-semibold` + disabled `disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]`. `--accent-solid` is declared only in `:root` and `[data-theme="light"]` (both `#2563eb`) and is **not** in `CSS_VAR_KEYS` / the 18 theme maps, so primary actions stay stock blue under every named theme. Accepted trade-off (review #11): white on `#2563eb` = 5.17:1 in every theme, and theming the primary per palette is a separate decision; the `theme-system` requirement states the invariance. Secondary stays the contract's `border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]`.

### D5 — Size floors
- Text: nothing < 11 px; interactive (buttons, labels, links) and help text ≥ 12 px. Dense metadata (model name, path, cost) may stay 11 px — matches `ui-contract.md` "dense" row.
- Targets: every button `min-h-[44px]` below `sm`; from `sm:` chips and toggles `sm:min-h-[32px]`, form buttons `sm:min-h-[36px]`; horizontal padding ≥ `px-2.5` so width ≥ 44 px on mobile. Icon-only buttons (close ×, kebab) `min-w-[44px] sm:min-w-[32px]`.
- Recipe name in code: a small shared class list constant is **not** introduced (single-use per file would be premature abstraction); each file inlines the classes, and `ui-contract.md` holds the canonical strings.

### D6 — Focus
Every `<button>`/`<a>` on the surfaces gets the existing `focus-ring` utility (already used by `FolderSpawnButtons`). No new utility.

### D7 — Verification
- Port the probe to Playwright against the docker harness (`tests/e2e/ui-token-alignment.spec.ts`): folder card, worktree dialog (opened), goal detail (seeded goal), automation dialog (opened), select prompt (fixture). Scope the checks to the changed surfaces so unrelated components (folder header git pill, kb stale badge) don't fail this change — they are listed in `ux-test.md` as follow-up.
- Unit scan (test-plan E3, one regex shared by spec, D7 and test) over the spec's surface list: no `(text|bg|border|ring|outline|divide|shadow|from|via|to)-(green|orange|blue|yellow|indigo|red|amber|purple|emerald|sky)-\d`, no `#[0-9a-fA-F]{3,8}` and no `rgba(` inside `className`/`style`.
- Existing tests that change (review #3/#5): `packages/goal-plugin/src/__tests__/GoalDetailClaim.test.tsx:125,134` (`.bg-emerald-400\/70` gauge selector → testid), `tests/e2e/pi-runtime-picker.spec.ts:514` and `packages/client/src/components/settings/__tests__/settings-page-composition.test.tsx:451` (`"Sessions spawn"`), `packages/client/src/components/__tests__/SessionCard.test.tsx:1457` (worktree title copy) and `:103,1040,1059` (`border-blue-500/60`), `packages/goal-plugin/src/__tests__/status-meta.test.ts:16` ("Respawning"), `packages/shared/src/__tests__/doctor-core.test.ts` + `tests/e2e/diagnostics-spawn-runtime.spec.ts:40` (doctor "Spawn runtime" row).

### D8 — ui-contract.md
Fix the primary-button row (D4), add a "Colour roles" table (D2), the size floors (D5), "status colour on shape, not text" (D2b), and "use `--text-muted` only for decoration". Stale theme-count claims are left alone (out of scope).

### D9 — Copy: "new session", never "spawn"
"Spawn" is process jargon. User-facing English copy says **new session** (create), **start** (verb), **restart** (for respawn). Internal names stay: protocol messages (`spawn_session`), functions (`spawnSession`), config keys (`spawnStrategy`, `maxConcurrentSpawns`), testids, file names and **i18n keys** (renaming keys would break the Hungarian/Chinese tables and `i18n-legacy-aliases.ts`). Hungarian (`indítás`) and the client Chinese strings in `lib/i18n/i18n.tsx` (`启动`) already say start/launch and are unchanged. **Exception (review #7):** goal-plugin zh (`packages/goal-plugin/src/i18n.ts:71,94,96`) says 重生 ("respawn") → changed to 重启 ("restart") alongside the English. Error banners already read "Pi started but never connected…" and are unchanged.

**Scope of "user-facing" (review #4):** anything a user can read in the dashboard: `i18nT`/`t` fallbacks, `i18n-en-source.json`, plugin `src/i18n.ts` English catalogs, `configSchema.json` `title`/`description`, and server/shared strings that reach the UI (error messages, doctor labels). The inventory below is the known set; **the E7 scan is authoritative** — it covers the catalogs and fallbacks above *and* every prose-like string literal in rendered source (cycle-2 #5: the goal status label is a hard-coded literal) — task 3b.1 works from the scan, not only the table, and fixes every call site of a key (e.g. `piRuntime.laneSpawn` in `PiRuntimeSection.tsx:228` and `PiRuntimeStatusRow.tsx:42`; `fieldCount` at `CreateAutomationDialog.tsx:734,793`; review #6).

Initial inventory (2026-09-27, `i18nT`/`t` fallbacks + `packages/client/src/lib/i18n-en-source.json`; 23 strings):

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

Additional strings found in review (#4, #8):

| key / location | where | now | new |
|---|---|---|---|
| `piRuntime.customSpawn` | client `PiRuntimeSection.tsx:424` | Custom spawn entry (pi) | Custom start entry (pi) |
| `doctor-core.ts:1032` | shared doctor (Diagnostics UI) | Spawn runtime (resolved) | Session runtime (resolved) |
| `doctor-core.ts:1140` | shared doctor | …cannot spawn agent sessions | …cannot start agent sessions |
| `packages/automation-plugin/src/configSchema.json:33` | automation-plugin settings | …at spawn time | …when the session starts |
| `packages/server/src/lifecycle/recovery-server.ts:357` | recovery page shown in browser | Respawning… give it a few seconds, then reload. | Restarting… give it a few seconds, then reload. |
| `packages/server/src/lifecycle/recovery-server.ts:363` | server → UI error | Failed to respawn: | Failed to restart session: |
| `packages/server/src/browser-handlers/session-action-handler.ts:232` | server → UI error | No session file — cannot respawn on reload | No session file — cannot restart on reload |
| goal status `respawning` label | goal-plugin `GoalsBoardClaim.tsx:27`, `useGoals.ts:64` (hard-coded literals) | Respawning | Restarting |

Where each change goes: the `i18nT`/`t` fallback at **every** call site, plus the catalog entry **where one exists** — `packages/client/src/lib/i18n-en-source.json` holds only 9 of these keys; plugin keys live in each plugin's `src/i18n.ts` (goal-plugin, automation-plugin, subagents-plugin for `rolesDepAliasesReport`); the rest are code-only fallbacks or literals.

## Risks / Trade-offs

- **Dark theme drift** → tints mix 46% toward `--text-primary`, so dark text is slightly lighter than `*-400`; checked in mockup screenshots, visually equivalent.
- **Taller controls** → session cards grow a few px; card action row wraps on narrow sidebars. Accepted (targets were 14–23 px).
- **Merge overlap with `add-acp-session-driver`** → both edit `FolderSpawnButtons`, `WorktreeSpawnDialog`, `GoalDetailClaim`. The ACP mockups already use these recipes; second lander rebases.
- **Class-name tests** → snapshot/class assertions break; updated in the same task as each file.

## Migration Plan

Client-only: `npm run build` + restart. Rollback = revert. No data or config.

## Open Questions

- Should the kb "stale" badge and folder-header git pill (also failing, outside the 8 files) be a follow-up change? Proposed: yes, same recipe.
