## ADDED Requirements

### Requirement: Role-based access control
The service SHALL assign every member exactly one of the roles `admin`, `member`, or `revoked`, and SHALL enforce the role on every management and proxy route.

#### Scenario: Member cannot reach admin routes
- **WHEN** a member with role `member` requests an admin-only route
- **THEN** the request is rejected with an authorization error and the attempt is audited

#### Scenario: Revoked member is refused everywhere
- **WHEN** a member with role `revoked` presents a previously valid session or key
- **THEN** every management and proxy route rejects the request

### Requirement: Admin can grant and revoke access
An admin SHALL be able to change another member's role, and the change SHALL take effect on that member's next request. Revocation SHALL cancel every key the member holds and SHALL withdraw every account they contributed.

#### Scenario: Revocation cancels every key the member holds
- **WHEN** a member holding keys on several machines is revoked
- **THEN** every one of their keys is rejected at the next request, not merely the most recently issued — a forgotten laptop must not retain access

#### Scenario: Revocation withdraws the accounts they contributed
- **WHEN** a member who had shared accounts with the team is revoked
- **THEN** those accounts leave every other member's pool, so the team stops spending the subscription of someone with no remaining relationship to it

#### Scenario: Revocation takes effect without waiting
- **WHEN** an admin sets a member's role to `revoked` while that member has sessions running
- **THEN** the member's next proxy request is rejected, with no expiry period to wait out

#### Scenario: Restore returns prior access
- **WHEN** an admin sets a `revoked` member back to `member`
- **THEN** the member's existing keys that were not individually revoked become usable again

### Requirement: Last admin cannot be removed
The service SHALL refuse an operation that would leave the system with no member in the `admin` role.

#### Scenario: Sole admin attempts self-demotion
- **WHEN** the only admin attempts to change their own role to `member`
- **THEN** the operation is rejected and the role is unchanged
