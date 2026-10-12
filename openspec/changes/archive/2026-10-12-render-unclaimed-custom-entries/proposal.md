## Why

In the last 14 days of session logs (615 `.jsonl` files) two `customType`s showed up in chat as
raw pretty-printed JSON because nothing claims them:

| customType | Rows / sessions | Emitter |
|---|---|---|
| `web-search-results` | 115 / 27 | `pi-web-access` (3rd-party) `pi.appendEntry` |
| `subagent-admission-refused` | 79 / 22 | our own bridge (`packages/extension/src/bridge.ts`, fan-out admission gate) |

- **`subagent-admission-refused`** is a durable forensic record. The refused `Agent` tool call
  already shows as failed, with its reason. No shipped group matches this type, so it falls into
  `other`, and turning off the "Subagents" toggle does not hide it.
- **`web-search-results`** is already gated by the shipped `search` group (visible by default).
  The problem is rendering, not grouping: the useful data (queries, answers, result links,
  fetched URLs) shows up as an unreadable JSON dump.
  - Payload subtypes seen in all logs: `search` 260, `fetch` 181, `research` 6.
  - Fetch rows come in two shapes: 118 store their URLs under `urlMetadata[]`; 63 (the older
    form) store them under `urls[]` with a `content` field.
  - The emitter source was not checked. The installed `pi-web-access` build did not contain the
    string, so the payload shapes come from logged entries only.
- **Other unclaimed types** (e.g. the `context-manager` type planned in `context-manager-kernel`)
  will hit the same JSON-dump fallback.

## What Changes

- **New shipped custom event group `diagnostics`** (`^subagent-admission-refused$`), hidden by
  default. Existing users get it through the existing shipped-group merge (new id → appended). The
  durable entry is still written exactly as before; this change only affects how it shows in chat.
- **New client-only dashboard plugin `web-access`** (`packages/web-access-plugin`). It claims the
  `custom-entry-renderer` slot for `web-search-results` and declares `pi-web-access` as a
  requirement. This is advisory: it is reported in the plugins UI, and the claim stays active so
  rows in old sessions still render.
  - **Collapsed:** one line, derived from the row body.
    - A search reads "Web search · N queries · M results"; a fetch reads "Web fetch · N URLs".
    - `research` and any other subtype show the label only.
    - A count is shown only when the matching value in the body is actually an array; otherwise
      the count is omitted.
  - **Expanded:** built from the lazily fetched full payload.
    - Search: up to 20 queries, each with its provider(s), answer and error, plus up to 20
      results per query (title, link, snippet). Overflow is shown as "+N more".
    - Fetch: up to 50 URLs (from `urlMetadata[]` or `urls[]`).
    - `research` and other subtypes: the payload as plain text, bounded to the same
      last-200-lines display form.
    - Rows without an entry id show no expand toggle (existing contract).
    - Fetch: each URL with its title, size and error.
    - Payload unavailable: the stored body is shown as plain text, plus the failure reason when a
      fetch actually failed.
  - **Links:** only `http(s)` URLs without embedded credentials become clickable. The link text
    is the original text; the target is the normalized URL, opened with
    `rel="noopener noreferrer"`. All other text renders as plain text.
  - **Burst behaviour change:** because the type is now claimed, `web-search-results` rows are
    absorbed into tool bursts instead of splitting them. This is the existing behaviour for
    claimed rows (`group-tool-bursts.ts`).
- **Smarter generic fallback.** When a fallback row's body is untruncated and parses as a JSON
  object, the generic card shows a bounded key/value view: up to 50 keys, scalar values inline,
  nested values as compact plain-text JSON. Otherwise it shows plain text exactly as today. It
  still never interprets markdown or linkifies.

## Capabilities

### New Capabilities
- `web-search-entry-rendering`: the `web-access` plugin's rendering of `web-search-results`
  custom entries (collapsed summary, expanded detail, link safety, degradation).

### Modified Capabilities
- `custom-event-groups`: shipped defaults gain a `diagnostics` group covering subagent admission
  refusals, hidden by default.
- `custom-entry-rendering`: the generic fallback shows untruncated JSON-object bodies as a bounded
  structured view (modifies "Custom rows SHALL render as a bounded generic fallback").

## Impact

- **New package** `packages/web-access-plugin` (client entry only). It goes through the full
  plugin registration checklist: `publish.yml` PACKAGES, `BUNDLED_PLUGINS`, client dependency +
  `@source` line, regenerated `plugin-registry.tsx`, vitest projects, knip workspaces, i18n
  catalogs (en / zh-CN / hu).
- **Shared:** `packages/shared/src/custom-event-groups.ts` (`SHIPPED_CUSTOM_EVENT_GROUPS`).
- **Client:** `packages/client/src/components/chat/CustomEntryCard.tsx` (structured view), plus a
  new pure parse module. `event-reducer.ts` adds `export` to `CUSTOM_BODY_MAX_CHARS`; nothing
  else in the reducer changes.
- **`CHANGELOG.md`:** an `[Unreleased]` entry noting that `diagnostics` is hidden by default.
- **Unchanged:** the bridge, the durable record, the reducer's behavior, replay, and the event
  store.
- **Compatibility:** for existing users, `diagnostics` merges in hidden. If a user's own earlier
  group already matches the refusal type, that group keeps winning (first-match-wins). A user who
  wants refusals back re-enables the group in the View popover or in settings.
- **Rollback:** reverting the code does NOT unhide refusals. The `diagnostics` group stays in
  users' `custom-event-groups.json` (the store keeps every valid entry) with `default: false`. To
  restore visibility, users enable the group or delete it from the file. This is documented in the
  CHANGELOG entry.

## Discipline Skills

- `security-hardening`: extension-authored URLs and text are rendered as links (scheme
  allow-list, `noopener noreferrer`, no markdown/HTML interpretation), and the fallback parses
  untrusted input (it must never throw).
- `review-code`: before commit, on the new plugin and the fallback change.
