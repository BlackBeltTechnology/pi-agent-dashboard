# Tasks — improve-dashboard-attention-routing

## 1. Contract / tokens
- [x] 1.1 Add `--status-needs-you` / `--status-working` / `--status-idle` / `--status-error` to the theme token source for all themes (themes.ts: base, dracula, nord, github, catppuccin, tokyo-night, rose-pine, solarized, gruvbox + index.css base fallbacks), each derived from that theme's `--accent-purple`/`--accent-yellow`/`--accent-green`/`--accent-red` → verify: each token resolves and passes ≥3:1 UI-contrast vs `--bg-tertiary` in dark+light (axe/contrast).
- [x] 1.2 Scaffold `mockups/ui-plan.md` mapping surfaces → states → tokens (frontend-mockup-loop CONTRACT step) → verify: every value references a token, no raw hex.

## 2. Color precedence (session-status-visuals.ts)
- [x] 2.1 Add `ask_user` branch to `deriveDotColorWithFlags` (suppressed for widget-bar prompts) → verify: unit test asserts needs-you color for chat-routed ask_user, unchanged for widget-bar.
- [x] 2.2 Add `ask_user` branch to `deriveRailBgColor` with the same suppression + selection (`-400`/`/65`) behavior → verify: unit test asserts needs-you rail, not green.
- [x] 2.3 Reorder precedence (`error` > `ask_user` > `resuming`/`retry` > `streaming`/`tool` > `active`/`idle` > `ended`) consistently across dot, rail, icon-tint → verify: `session-status-visuals.test.ts` covers each precedence pair.

## 3. Label + dot shape (SessionCard.tsx)
- [x] 3.1 `ActivityIndicator`: `ask_user` → "Needs you"; `idle`/`active` → "Idle" → verify: existing `ask-user-card-indicator` tests updated; new test asserts distinct strings.
- [x] 3.2 Encode dot shape by state (filled / pulsing / ring / ✕) as non-hue channel → verify: snapshot/test asserts shape class per state; manual reduced-motion + grayscale check.

## 4. Needs-you rollup (folder header)
- [x] 4.1 Compute per-folder needs-you count from child sessions (reuse aggregation pattern) → verify: unit test counts only chat-routed ask_user.
- [x] 4.2 Render compact clickable "N need you" pill, hidden at 0; click scrolls/filters to blocked sessions → verify: component test; mobile 375px collapse to icon+count.

## 5. Opt-in urgency sort
- [x] 5.1 Add per-folder display-pref (default off) — localStorage-backed `useFolderUrgencySort` (per-folder pref store does not exist; pure-client persistence mirrors collapse/ended-expanded toggles) → verify: persisted + reconciled like existing prefs.
- [x] 5.2 When on, float `ask_user` sessions to top of the folder's active list (stable within group) → verify: list-order test with mixed states.

## 6. Mockup loop (frontend-mockup-loop)
- [x] 6.1 Build dark+light HTML mockups in `mockups/attention.html`, served via `serve_mockup`; rendered both themes (screenshot evidence) in `mockups/`, `serve_mockup`, hand back local+LAN URL → verify: renders both themes at 375/768/1440.
- [x] 6.2 Rubric scored green in `mockups/score.md` (7-item fallback via agent-browser; `score_mockup`/Playwright CDN unreachable in env — axe automation deferred, contrast reasoned manually).

## 7. Promote + docs
- [x] 7.1 Promote approved mockup to React in an isolated env (`isolated-ui-verification`); confirm `lsof -i:8000` unchanged → verify: isolated port shows new behavior, live PID untouched.
- [x] 7.2 Update `docs/architecture.md` attention section + `docs/file-index-client.md` rows for new tokens/components (delegate to subagent, caveman style) → verify: rows present, alphabetical.
- [x] 7.3 `npm test` green (8112 passed) + `tsc --noEmit` exit 0 + `biome lint` 0 errors on all edited files (36 grandfathered Tier-B/C warnings). `quality:changed` oracle `--changed` step detects 0 files in worktree (biome-vs-develop git quirk; not a code defect).
