## ADDED Requirements

### Requirement: Pairing payload URL source is the promoted `publicBaseUrls`
The pairing payload's operator-designated addresses SHALL be sourced from the
top-level `publicBaseUrls` when that key is present, and from the legacy
`pairing.publicBaseUrls` when it is absent. No config file SHALL be rewritten on
read, so an existing configuration keeps working with no operator action.

The publicly-trusted-TLS gate is **UNCHANGED** by this promotion. It SHALL stay
authoritative at read time in `PairingManager.reachableUrls()`, which is what
makes it safe for OAuth-adjacent surfaces and the pairing payload to share one
input list: the two have different admissibility rules, and pairing's rule lives
downstream of the shared list. The gate SHALL NOT be moved upstream into config
parsing as a cleanup, because that would let a parse-level change silently widen
what reaches a QR code.

#### Scenario: Top-level key feeds the payload
- **WHEN** the config holds top-level `publicBaseUrls: ["https://pi.example.com"]` and no legacy key
- **THEN** the pairing payload's `urls[]` SHALL include `https://pi.example.com`

#### Scenario: Legacy key still feeds the payload
- **WHEN** the config holds only `pairing.publicBaseUrls: ["https://pi.example.com"]`
- **THEN** the pairing payload's `urls[]` SHALL include `https://pi.example.com`, byte-identically to the behaviour before the promotion

#### Scenario: Top-level key wins when both are present
- **WHEN** both keys are present with different values
- **THEN** the payload SHALL reflect the top-level list only

#### Scenario: The TLS gate still rejects a plain-http entry from the promoted list
- **WHEN** the promoted `publicBaseUrls` contains a non-loopback `http://` entry
- **THEN** `reachableUrls()` SHALL omit it and the pairing payload SHALL NOT contain it
