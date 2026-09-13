## Why

The quota plugin's meter renders in `content-inline-footer`, *below* the composer hints — visually orphaned from the other per-session context furniture (`OPENSPEC | GIT | STATUS`) that lives in the `ComposerSessionActions` context strip *above* the composer. Users look at the strip to answer "what is this session doing / attached to"; quota belongs in the same glance, and it should say which provider the session's currently selected model draws from.

The plugin's header comment records why it originally stayed in the footer: the composer's *context slider* is draft-conditional (vanishes on empty input). That rationale does not apply to the `ComposerSessionActions` strip, which is session-conditional — it renders whenever the chat view is bound to a session, regardless of draft.

## What Changes

- **New shell slot `composer-context-group`** (`many`, `react-only`, claim `{ component }`) — contributions render inside `ComposerSessionActions` after `GIT` and before `STATUS`. Unlike `session-card-badge` it is NOT wrapped in the streaming `<fieldset disabled>`: contributions are read-only context, so they must stay fully visible mid-run. The runtime exports a `ComposerContextGroup` primitive (`{ label, children }` → divider + uppercase label + content as one non-wrapping unit) styled to match the strip's own `OPENSPEC`/`GIT`/`STATUS` groups, which stay as they are. The strip's early-return guard learns about the new slot so the group shows even when no other group does. A claimant that has nothing to show returns `null` and no divider/label appears.
- **Quota plugin moves its widget claim** `content-inline-footer` → `composer-context-group`, wrapping its chips in `<ComposerContextGroup label="Quota">`. Widget becomes one chip per enabled provider showing **every** window inline (`5h [bar] 14%  7d [bar] 32%`), pace colour on the fill, `now` tick, and a dashed `not live` tag when the server marks the provider `stale` (previously dialog-only). Click still opens the existing `QuotaDialog` pre-selected to that provider. No providers with windows → the widget renders nothing (no group). New strings are localized via the plugin catalog.
- **Session-model awareness.** The group receives `session.model`; the provider prefix (`anthropic/…` → `anthropic`, `openai-codex/…` → `openai-codex`) selects the matching chip, which renders first with an accent ring (provider name only — no model id in the chip). When at least one provider has data but the session's provider is not among them (disabled, or no adapter, e.g. `google-vertex`), a leading dashed, non-interactive note `<model-id> · no quota` precedes the chips. Selection is derived, not stored — switching model in the selector moves the ring immediately.
- **Wrap safety.** `ComposerContextGroup` renders divider + label + children as one non-shrinking flex item so the label never orphans at a line end when the strip wraps.
- `content-inline-footer` slot is untouched (still consumed by flows-plugin, which the host `shrink-0` wrapper from `fix-quota-widget-clipping` continues to protect); the quota plugin simply stops claiming it.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `dashboard-shell-slots`: add `composer-context-group` to the frozen `SlotId` taxonomy (additive → minor semver; tier rejection follows the existing generic "Each slot accepts a payload tier" requirement via `SLOT_META`), its typed context props `{ session, pluginContext }`, the consumer contract (rendered inside the context strip after GIT, exempt from streaming disable), and the exported `ComposerContextGroup` primitive.
- `chat-view`: the `ComposerSessionActions` strip requirement gains a plugin-contributed position between `GIT` and `STATUS`, not gated by streaming; groups are one non-wrapping unit.
- `provider-quota-surfacing`: "Client SHALL render a per-provider quota widget" changes from footer mini-slider to context-strip chip with all windows inline, stale tag, and session-provider emphasis / no-adapter note.

## Impact

- `packages/shared/src/dashboard-plugin/slot-types.ts`, `slot-props.ts` — new slot id + props (additive; versions move in lockstep at `release-cut`).
- `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` — `ComposerContextGroupSlot` consumer (mirrors `ContentInlineFooterSlot`); new exported `ComposerContextGroup` primitive.
- `packages/client/src/components/session/ComposerSessionActions.tsx` — mount the consumer between GIT and STATUS, pass `session`, extend the early-return guard. Own groups untouched.
- `packages/quota-plugin/src/client.tsx`, `package.json`, `i18n.ts` — re-claim slot, new chip widget, provider matching from `session.model`, `stale` tag, new catalog strings; header comment rewritten.
- Tests: slot-consumer unit tests, `ComposerSessionActions` tests, quota-plugin client tests (chip order, ring, no-adapter note, stale tag). Possibly one Playwright spec asserting the group renders in the strip.
- Docs: `docs/` slot list + per-file `AGENTS.md` rows (via DocScribe).
- Mockup reference: `tmp/mockups/quota-context-strip/index.html` (variant B / B2 / B3 / C).

## Discipline Skills

- `review-code` — non-trivial change across shared/runtime/client/plugin before commit.
- `doubt-driven-review` — adding a slot id to the frozen taxonomy is a public plugin API step; stress-test the name/payload before it stands.

No auth/untrusted-input/secrets surface; no latency budget; no new endpoint — `security-hardening`, `performance-optimization`, `observability-instrumentation` do not apply.
