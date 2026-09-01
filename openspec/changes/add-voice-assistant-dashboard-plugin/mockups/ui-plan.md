# voice-assistant plugin — UI plan

Grounded in `packages/client/src/components/session/SessionCard.tsx` (action-bar
button classes, badge/subcard conventions) and `packages/client/src/index.css`
(theme tokens, both themes below). No raw hex/px in the mockups — every color
is `var(--token)`, matching what ships.

## Surfaces → tokens → states

| Surface | Slot | Tokens used | States |
|---|---|---|---|
| Dictation action-bar buttons | `session-card-action-bar` | `--accent-green`/`--accent-red` @ 30% border per existing Resume/Fork button convention (`border-green-500/30 text-green-400 hover:bg-green-500/10`) | idle → recording → (stopping) → idle; not-installed*; delivery-failed; stt-not-configured |
| Dictation capture-source picker | `session-card-action-bar` (inline `<select>`) | neutral form tokens (`--bg-primary` field, `--border-primary`) — deliberately NOT hue-coded, it selects a source rather than signalling state | server (default) / browser / hidden entirely when `window.isSecureContext` is false / locked while recording |
| Dictation status badge | `session-card-badge` | `--status-working` (recording, reuses the existing "streaming" yellow), `--status-error` | idle (hidden) / recording / error |
| Meeting-copilot action-bar buttons | `session-card-action-bar` | `--accent-purple` (distinct from dictation's green — two independent controls must not share a hue, Gestalt similarity) | idle → listening → idle; knowledge-required; error |
| Meeting-copilot status badge | `session-card-badge` | `--status-needs-you` purple family for "listening" (reuses existing purple token), `--status-error` | idle (hidden) / listening / error |
| Live wall | `session-card-action-bar` "View live wall" → core `live-server-preview` embed (no plugin claim) | dashboard chrome only (`--bg-secondary` tab bar); the embedded sandboxed iframe renders upstream's OWN `wall.css`, intentionally not dashboard tokens (opaque-origin isolation) | not-running / embedded / popped-out-to-browser |
| Knowledge browser entry | `sidebar-folder-section` | folder-row tokens, sibling of kb-plugin's `FolderKbSection` | present per folder, independent of any running session |
| Knowledge browser page | `shell-overlay-route` @ `/folder/:encodedCwd/voice-assistant-knowledge` | `--bg-tertiary` cards, `--text-tertiary` metadata | empty / populated / invalid-folder — full-bleed (matches `KbSettingsPanel`), NOT a dialog; back binds to `onBack` |
| Config editor | `settings-section` | standard form field tokens (`--bg-tertiary` inputs, `--border-primary`) | no-file (offer create) / editing / saved |

*"not-installed" state dropped — the redesigned plugin has no install step; only STT-not-configured and knowledge-not-configured gates remain (per specs `voice-assistant-dictation-control` / `voice-assistant-copilot-control`).

## Naming

Product/plugin renamed `set-copilot` → `voice-assistant` throughout (proposal, design, specs, tasks, mockups) — upstream project references (`tatargabor/set-copilot`, its CLI, `set-copilot.config.json`, the vendored `src/vendor/set-copilot/` path) are left as-is since they name the actual open-source library, not this plugin. Dictation actions renamed to match: upstream's `ds`/`dd` → this plugin's `dict-start`/`dict-end`, shown as the literal button label (monospace, command-style) with a plain-English `title` for accessibility/recognition (Nielsen #6).

## Cited rules (see also `packages/mockup-loop/.pi/skills/frontend-mockup-loop/references/ux-best-practices.md`)

1. **Visibility of system status (Nielsen #1)** — dictation/copilot always show a live badge; wall view streams with no manual refresh.
2. **Gestalt similarity / distinct hue per independent control** — dictation (green, matches existing Resume-button convention) vs. meeting-copilot (purple, matches existing needs-you/attention convention) never share a color, so two simultaneously-visible controls read as separate systems at a glance.
3. **Error prevention + recognition over recall (Nielsen #5, #6)** — disabled start buttons carry an inline reason (STT not configured / knowledge sources required) instead of a generic disabled state the user must investigate.
4. **Visibility + recoverability of errors (Nielsen #9)** — delivery-failed dictation keeps the stitched text visible with a retry action, never silently drops captured speech (mirrors the vendored `handover.ts` fail-open contract).
5. **WCAG 1.4.3 contrast (AA, 4.5:1 body text)** — all text pairings checked against both themes' `--bg-tertiary`/`--text-*` pairs already in production use.
6. **WCAG 1.4.1 (use of color)** — badge states carry an icon + text label, not color alone (matches `StatusShapeBadge`'s existing non-hue channel precedent in SessionCard).
7. **Fitts's Law** — action-bar buttons match the existing `text-[9px] px-1 py-px` compact hit target family already shipped (consistent tap/click target size across the card footer).

## Screens in this mockup pass

1. `session-card.html` — session card with dictation + meeting-copilot action-bar buttons and badges, all states, including the v1 browser-mic capture source (picker, active-recording, and insecure-context-hidden states).
2. `wall-view.html` — live meeting wall, embedded via the core `live-server-preview` mechanism (editor-pane tab + sandboxed iframe + "open in system browser" popout) — not a plugin-owned view.
3. `knowledge-browser.html` — knowledge sources/decisions, folder-scoped overlay route (design 6b), full-bleed.
4. `config-editor.html` — settings-section config form.
5. `index.html` — nav shell linking all four + theme toggle.
