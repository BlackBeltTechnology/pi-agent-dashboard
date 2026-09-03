# Hungarian localization (opt-in)

Hungarian support is **opt-in via an explicit `locale="hu"`** and is **never an
ambient default** — this skill is user-global and must not assume the Hungarian
document archive. English (`en`) is the default UI dictionary.

```tsx
<OpenFormsMui schema={schema} locale="hu" />
```

## What `locale="hu"` changes

- The component's own **UI chrome** (buttons, markers, notices, the error-summary
  title, computed/disabled hints) uses the Hungarian dictionary
  (`tools/src/i18n/hu.ts`). Author-supplied content (labels, options, rule
  messages) is localized separately by the schema's `translations` dictionary.
- Missing translations fall back to the schema's base text (never an empty label).

## HU formatting conventions

- **Date:** storage stays ISO `YYYY-MM-DD`; the Hungarian display convention is
  `YYYY. MM. DD.` (`HU_DATE_DISPLAY_FORMAT`).
- **Currency (HUF):** `formatHuf(1234567)` → `"1 234 567 Ft"` (space grouping, no
  decimals, `Ft` suffix), via `Intl.NumberFormat("hu-HU")`.

## Optional input masks (opt-in patterns)

Exported as `HU_MASKS` (apply via a field `mask` where useful; never enforced by
default):

| Field | Pattern | Notes |
|---|---|---|
| Tax ID (adóazonosító jel) | `##########` | 10 digits |
| Postal code (irányítószám) | `####` | 4 digits |
| Phone | `+36 ## ### ####` | national format |

These are conveniences for Hungarian forms; they remain opt-in and are not a
default of the component.

## Adding another locale

Supply a `translations` dictionary on the schema for author content, and pass the
matching `locale`. Only `en` and `hu` ship a built-in **UI** dictionary; an
unknown locale falls back to the English UI dictionary while still applying the
schema's `translations` for that locale.
