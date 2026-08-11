# Design — fix-blob-content-disposition-encoding

## Context

`routes.ts` composes the header inline from `basename(abs)`. The only defence is
`name.replace(/"/g, "")`. Node's HTTP layer validates header values against
Latin-1 and throws `ERR_INVALID_CHAR`, which Fastify turns into a `500` — the
response is lost *after* the status/content-type were already chosen, so the
client sees a broken document rather than a degraded filename.

## Decision 1 — RFC 6266 / RFC 5987 two-parameter form

Emit both parameters, in this order, **whenever sanitisation loses information**
(any non-ASCII or unsafe character). A filename that is already header-safe ASCII
keeps the plain `inline; filename="<name>"` form, so ordinary documents are
byte-identical to the previous behaviour and the pre-existing route assertion
stays valid unchanged:

```
inline; filename="<ascii-fallback>"; filename*=UTF-8''<percent-encoded-utf8>
```

- `filename` (quoted) — the compatibility token. ASCII-only by construction.
- `filename*` — the authoritative UTF-8 form. Every modern browser prefers it.

Rationale: RFC 6266 §4.3 defines exactly this pairing for non-ISO-8859-1 names,
and clients that do not understand `filename*` ignore it and keep working. The
alternative (dropping the filename entirely for non-ASCII names) would lose the
name on download; the alternative of Latin-1 transliteration is lossy and still
cannot represent `ő`.

## Decision 2 — the ASCII fallback is built by strict allow-list

The fallback keeps only printable US-ASCII **excluding** the characters that are
structurally dangerous in a quoted header parameter or a filesystem path:

- excluded: `"` `\` `/` and any byte `< 0x20` or `> 0x7E` (covers CR, LF, NUL,
  TAB and every accented character)
- every excluded byte becomes `_`, so the token keeps its shape and its extension

An allow-list is used rather than a deny-list because the failure mode of a
missed deny-list entry is header injection, while a missed allow-list entry is
only an underscore.

If the sanitised fallback ends up empty, `document` is used, so the parameter is
never malformed.

## Decision 3 — `filename*` is percent-encoded with `encodeURIComponent`, tightened

`encodeURIComponent` leaves `!'()*` unescaped, which are not valid in the RFC 5987
`attr-char` set. Those five are percent-encoded explicitly afterwards. The result
is by definition ASCII-only, so it can never re-introduce the original defect.

## Decision 4 — the builder lives in `blob.ts`, not the route

`blob.ts` already owns "everything about turning a handle into safe response
facts" (`resolveBlobPath`, `contentTypeFor`). Putting `contentDispositionFor`
beside them keeps the route a thin composition and makes the encoder unit-testable
without standing up Fastify. It is exported so both route-level and unit tests can
target it.

## Decision 5 — success contract frozen

The change touches exactly one header value, and only for filenames that were
previously *impossible* to serve or unsafe to interpolate. Status codes, `Content-Type`,
`Accept-Ranges`, `Content-Range`, `Content-Length`, `X-Content-Type-Options` and
the body bytes are untouched, and the existing route tests remain valid unchanged
— they are the regression net proving that.

## Risks

- A client that parses `filename` and ignores `filename*` will show an
  underscored name for accented documents. Accepted: a slightly transliterated
  download name is strictly better than a 500.
- Nothing else in the plugin builds `Content-Disposition`, so there is no second
  drift site to keep in sync.
