# Scenario-design gap decisions — harden-auth-credentials

Hard-gate answers for the spec gaps scenario-design surfaced (stage: design).
Each line: gap → chosen answer (letter refers to the candidate list in the
drafting output). Principle: fail closed, match existing behaviour, prefer the
simpler mechanism. Answers that change a spec are applied to the deltas before
the test plan is folded.

## Auth (B17, B16r, B18, B4r)

- A-G1 secret-length warning frequency → once per process lifetime.
- A-G2 whitespace-only secret → kept + warned (no forced logout).
- A-G3 audit value sanitization → chars outside `[\w.:-]` replaced with `_`; 8-char id prefix taken after sanitizing.
- A-G4 refused rotations → audited: `[pairing] rotate_refused id=<8> reason=<code> ip=<ip>` (theft signal). Unknown-id revoke not audited.
- A-G5 audit write failure → fail-open (mutation completes).
- A-G6 boundary equality → expired/invalid at `now >= limit` (TTL, 30 d ceiling, grace).
- A-G7 A→B→C chain → only the immediately previous bearer has a grace; A invalid at the second rotation.
- A-G8 superseded bearer after grace → plain 401 (no code) on every route incl. rotate.
- A-G9 rotate limiter → 10/min per device, sliding 60 s window, 429 + `Retry-After`.
- A-G10 registry persist failure on rotate → 500 `rotation_failed`, no state change, old bearer valid.
- A-G11 non-conforming holder declaration → treated as no declaration (only exact `holder:"browser"` counts).
- A-G12 expired bearer from a locally/network-trusted peer → a presented bearer is always judged: 401 `bearer_expired`.
- A-G13 malformed `expiresAt`/`pairedAt` → fail closed: row treated as expired.
- A-G14 grace vs own expiry → old bearer valid until `min(rotation + 60 s, own expiresAt)`.
- A-G15 25 % threshold base → issue→`expiresAt` of the current bearer (respects the 30 d cap).
- A-G16 first `expiresAt` → pairing redeem/poll response gains `expiresAt`; slot stores `{token, expiresAt}`.
- A-G17 rotation retry → on the next REST call, at most once per minute.
- A-G18 re-pair on `bearer_expired` → navigate once to the pairing landing page; deduplicated across concurrent 401s.
- A-G19 Electron/CLI detection → keyring path is a separate module that never calls the browser-slot code (verified at implementation).
- A-G20 `localStorage.setItem` throws after rotation → keep the new bearer in memory for the page session + one warning notice.
- A-G21 LAN carve-out with forwarding headers → carve-out skipped (current code); spec wording adds "with no forwarding headers".
- A-G22 verify-path performance → no per-verify latency row; invariant: no extra synchronous file read/write on the hot path.

