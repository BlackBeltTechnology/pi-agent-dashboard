# error-detection delta

## REMOVED Requirements

### Requirement: Provider error message humanization

**Reason.** `errorMessage` is typed `Type.TOptional<Type.TString>` in pi's
protocol — a bare string with no structure — and providers populate it from
`String(error)`, so its content is unconstrained. The helper assumed a JSON
envelope shape that no provider guarantees: Google carries no `error.type`, and
`error.code` is a number there and a string at OpenAI.

It was also mostly inert. It guarded with `startsWith("{")`, and pi's own
documented payload for `auto_retry_start.errorMessage` is
`529 {"type":"error",…}` — a status code, a space, then JSON — so the guard
rejected the most common real value and the helper did nothing. When it *did*
fire it discarded the status code, `request_id`, `retry-after` and any nested
detail; and when `error.message` was absent it fell through and rendered the
raw JSON string as the headline.

**Migration.** All three call sites in `event-reducer.ts` pass the raw
`errorMessage` through unchanged. No other package, plugin, barrel or e2e test
imported the helper. The rendering surface is unchanged — `SessionBanner`
already prints with `whitespace-pre-wrap break-words`, truncates past
`collapseThreshold` behind Show more / Show less, and offers Copy.
