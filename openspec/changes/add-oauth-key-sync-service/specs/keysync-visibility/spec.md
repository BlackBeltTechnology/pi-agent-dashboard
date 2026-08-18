## ADDED Requirements

### Requirement: Each account is private or shared
Every enrolled account SHALL carry a visibility of `private` or `shared`, owned by the member who enrolled it, and SHALL default to `private` on enrolment.

#### Scenario: New account defaults to private
- **WHEN** a member enrols an account without explicitly sharing it
- **THEN** the account is `private` and no other member's requests can select it

#### Scenario: Only the owner changes visibility
- **WHEN** a member who does not own an account attempts to change its visibility
- **THEN** the request is rejected and the visibility is unchanged

### Requirement: Sharing publishes an account to every member
A `shared` account SHALL be selectable by every member with role `member` or `admin`.

#### Scenario: Shared account becomes available
- **WHEN** an owner changes an account from `private` to `shared`
- **THEN** other members' subsequent requests may select that account

### Requirement: Unsharing withdraws the account immediately
Clearing the `shared` flag SHALL remove the account from every other member's selection pool, taking effect on their next request.

#### Scenario: In-flight requests are unaffected, subsequent ones are
- **WHEN** an owner unshares an account while another member has a request in flight on it
- **THEN** the in-flight request completes, and that member's next request selects a different account

#### Scenario: Unsharing the last available account
- **WHEN** an owner unshares an account that was the only one available to another member
- **THEN** that member's next request fails with a clear error rather than silently falling back to the owner's private accounts
