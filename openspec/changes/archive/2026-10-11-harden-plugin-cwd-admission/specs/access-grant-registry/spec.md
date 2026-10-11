## MODIFIED Requirements

### Requirement: A resumed request re-runs the guard it was denied by

A verdict SHALL authorise a **re-evaluation**, never a resumption that skips the
check. When a suspended request is released, the guard that denied it SHALL run
again in full — including real-path and symlink resolution and the
forbidden-subject rule — against the filesystem as it is at release time.

A verdict captured at one moment and applied at another SHALL NOT be treated as
evidence that the subject still means what it meant when the operator answered.

For the `cwd` plane, the guard that denied the request is the known-folder admission check,
and the verdict itself answers its membership layer. On release, the plane's re-run SHALL
therefore re-resolve the subject's real path and require it to equal the verdict subject,
re-check that it exists, and re-apply the `.git`-segment and forbidden-subject rules.
- An `allow-always` release SHALL additionally re-run the full known-folder admission against
  the live known-folder set, which now includes the new pin.
- An `allow-once` release SHALL admit only the single held request, without persisting
  membership; no other layer is skipped.
This rule applies to every `cwd`-plane hold, whether raised by a core route or by a plugin
through the host seam.

#### Scenario: A swapped symlink is not admitted by a stale verdict

- **GIVEN** a suspended request whose subject was replaced by a link to a different location after the operator answered
- **WHEN** the request is released
- **THEN** the guard SHALL re-run and SHALL deny it

#### Scenario: A revoked grant is not resurrected by a pending verdict

- **GIVEN** a verdict recorded for a subject whose grant is revoked before release
- **WHEN** the request is released
- **THEN** the re-run guard SHALL reflect the revocation

#### Scenario: An allow-once release still runs every layer

- **WHEN** an allow-once verdict releases a request
- **THEN** no containment layer SHALL be skipped, reordered, or widened

#### Scenario: Allow-once on the cwd plane re-checks the subject, not membership
- **GIVEN** a held request denied on the `cwd` plane for `/x`, which is not a known folder
- **WHEN** the operator answers allow-once and `/x` still resolves to the verdict subject and is grantable
- **THEN** that single request is admitted and `/x` is not added to the known-folder set
- **AND** if `/x` had been replaced by a symlink to another directory before release, the request SHALL be denied
