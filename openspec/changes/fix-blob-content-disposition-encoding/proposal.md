# fix-blob-content-disposition-encoding

## Why

`GET /api/plugins/invoicebot/blob` builds its `Content-Disposition` header by
interpolating the resolved filename raw:

```ts
.header("Content-Disposition", `inline; filename="${name.replace(/"/g, "")}"`)
```

HTTP header values are Latin-1. Any filename byte outside that range makes Node
reject the header, so the whole response fails with `500 ERR_INVALID_CHAR`
instead of serving the document. Measured against a real retained original whose
handle carries Hungarian accents
(`…EVOCOM_SzoftverfejlesztőÉsSzolgáltatóBt.pdf`):

```
status=500
{"statusCode":500,"code":"ERR_INVALID_CHAR","error":"Internal Server Error",
 "message":"Invalid character in header content [\"content-disposition\"]"}
```

Documents with ASCII-only filenames return `200 application/pdf` from the same
route, so byte delivery, ranges and containment are healthy — only the header
construction is broken. In the browser the 500 surfaces as
`Failed to load PDF document.`, making every accented invoice's preview
permanently unopenable.

The interpolation is also an unvalidated-input seam: the filename reaches a
header value with only `"` stripped, so control characters, CR/LF and path
separators are passed through unchecked.

## What Changes

- Build `Content-Disposition` with a **sanitised ASCII `filename` fallback plus
  an RFC 5987 `filename*=UTF-8''<percent-encoded>` parameter**, so accented names
  survive intact for modern clients and degrade safely for old ones.
- Guarantee **no byte outside printable US-ASCII can reach a header value** —
  control characters, CR/LF, quotes, backslashes and path separators are stripped
  or encoded in the fallback token.
- Treat the filename as untrusted input throughout (header-injection safe).
- Keep the existing success contract byte-identical: status codes, `Content-Type`,
  `Accept-Ranges`, `Content-Range`, `Content-Length`, `X-Content-Type-Options`
  and the served bytes are unchanged.

## Impact

- Affected specs: `invoicebot-blob-delivery`
- Affected code: `packages/invoicebot-plugin/src/server/blob.ts` (new header
  builder), `packages/invoicebot-plugin/src/server/routes.ts` (blob route uses it)
- No client, protocol or REST-shape change: the same URL returns the same bytes,
  only the header encoding is corrected.

## Discipline Skills

- `security-hardening` — the filename is untrusted input flowing into a response
  header; header injection and control-character handling are in scope.
