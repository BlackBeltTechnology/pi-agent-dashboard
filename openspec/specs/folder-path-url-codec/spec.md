# folder-path-url-codec Specification

## Purpose

Encode absolute folder paths (cwd) into URL-safe segments and decode them back, so paths can appear in `/folder/:encodedCwd/*` routes without breaking URL parsing. Encoding uses UTF-8 + base64url; decoding reverses it and reports malformed input as `null`.

## Requirements

### Requirement: Encode folder path to URL-safe segment

The system SHALL encode an absolute folder path string into a URL-safe base64url segment. It SHALL first UTF-8 encode the input, base64-encode the resulting bytes, then produce base64url by replacing `+` with `-`, `/` with `_`, and stripping trailing `=` padding.

#### Scenario: ASCII path encoded to base64url

- **WHEN** `encodeFolderPath` receives an ASCII path such as `/home/user`
- **THEN** it returns the base64 encoding of the UTF-8 bytes
- **AND** any `+` is replaced with `-`, any `/` is replaced with `_`, and trailing `=` padding is removed

#### Scenario: Non-ASCII folder name does not throw

- **WHEN** `encodeFolderPath` receives a path containing non-ASCII characters such as `/home/münchen`
- **THEN** the input is UTF-8 encoded before base64 encoding so it does not throw
- **AND** it returns a valid URL-safe base64url segment

### Requirement: Decode URL-safe segment to folder path

The system SHALL decode a base64url segment back into the original folder path string. It SHALL restore base64 by replacing `-` with `+` and `_` with `/`, re-add `=` padding to a length multiple of 4, base64-decode, and UTF-8 decode the bytes with strict (fatal) validation.

#### Scenario: Valid segment round-trips to original path

- **WHEN** a segment produced by `encodeFolderPath` for a path is passed to `decodeFolderPath`
- **THEN** it returns the original folder path string exactly
- **AND** the round trip preserves both ASCII and non-ASCII characters

#### Scenario: Missing padding restored before decoding

- **WHEN** `decodeFolderPath` receives a segment whose length is not a multiple of 4
- **THEN** it appends `(4 - (length % 4)) % 4` `=` characters before base64-decoding
- **AND** decoding proceeds without a padding error

### Requirement: Reject malformed segments

The system SHALL return `null` when a segment cannot be decoded, rather than throwing. Decoding failures include invalid base64 content and byte sequences that are not valid UTF-8 (rejected by the fatal UTF-8 decoder).

#### Scenario: Invalid base64 returns null

- **WHEN** `decodeFolderPath` receives a segment that is not valid base64 after character restoration
- **THEN** the thrown error is caught internally
- **AND** it returns `null`

#### Scenario: Non-UTF-8 bytes return null

- **WHEN** `decodeFolderPath` receives a segment that base64-decodes to bytes that are not valid UTF-8
- **THEN** the fatal UTF-8 decoder throws and the error is caught
- **AND** it returns `null`
