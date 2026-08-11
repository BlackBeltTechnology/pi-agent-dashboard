# invoicebot-blob-delivery — delta

## ADDED Requirements

### Requirement: Header-safe Content-Disposition filename encoding

The blob route SHALL construct its `Content-Disposition` header so that no byte
outside printable US-ASCII ever reaches a header value. For a filename containing
non-ASCII characters the header SHALL carry BOTH a sanitised ASCII `filename`
parameter AND an RFC 5987 `filename*=UTF-8''<percent-encoded>` parameter. The
filename SHALL be treated as untrusted input: control characters, CR/LF, quotes,
backslashes and path separators SHALL NOT appear literally in the header value.
The response's status code, `Content-Type`, `Accept-Ranges`, `Content-Range`,
`Content-Length`, `X-Content-Type-Options` and body bytes SHALL be unchanged by
this encoding.

#### Scenario: accented filename is served, not rejected

- **WHEN** a valid handle resolves to a file whose name contains non-ASCII
  characters (for example `Szoftverfejlesztő` or `É`)

- **THEN** the response SHALL be `200` with `Content-Type: application/pdf`
- **AND** the `Content-Disposition` header SHALL contain an ASCII-only `filename`
  parameter AND a `filename*=UTF-8''` parameter encoding the original name
- **AND** the response SHALL NOT fail with an invalid-header error

#### Scenario: ASCII filename keeps its plain form

- **WHEN** the resolved filename is already header-safe printable US-ASCII
- **THEN** the `Content-Disposition` header SHALL be exactly
  `inline; filename="<name>"`, byte-identical to the previous behaviour
- **AND** no `filename*` parameter SHALL be added

#### Scenario: header injection attempt is neutralised

- **WHEN** the resolved filename contains a quote, backslash, CR/LF or other
  control character
- **THEN** those characters SHALL NOT appear literally in the header value
- **AND** the response SHALL still be a well-formed successful blob response

#### Scenario: encoding does not disturb range delivery

- **WHEN** a satisfiable `Range` request targets a file with a non-ASCII filename
- **THEN** the response SHALL be `206` with the correct `Content-Range` and the
  requested bytes, carrying the same encoded `Content-Disposition`
