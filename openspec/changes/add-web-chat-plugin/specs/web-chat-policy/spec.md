## ADDED Requirements

### Requirement: Customer principals are confined to the web-chat public API

The `web-chat-policy` plugin, when named in `identity.trustedPolicyPlugin`, SHALL register a host access policy that allows a principal whose issuer is in the customer issuer list only for the action `plugin:web-chat:public`, denies that principal every other non-session action (including `plugin:web-chat:read` and `plugin:web-chat:write`, which guard the operator panel), and allows every other principal. Session roads are not governed by the host policy; customers have no session access because web-chat sessions are ownerless. The customer issuer list SHALL come from the policy plugin's own config `customerIssuers` (so customers stay confined even when the `web-chat` plugin is disabled); an empty list SHALL register no policy and log that it is inactive. A refused registration throws (see `host-access-policy`) and SHALL be logged with its code. It SHALL export its pure decision function so an operator can compose it into their own policy plugin; `web-chat` verifies confinement by probing whichever policy is registered (see `web-chat-customer-auth`), not by trusting a published signal. When it is not the named policy plugin, its registration is refused and it SHALL log that it is inactive.

#### Scenario: Customer denied a core road
- **WHEN** a customer principal requests a non-session road such as an OpenSpec or terminal action
- **THEN** the policy SHALL deny it

#### Scenario: Customer denied the operator panel
- **WHEN** a customer principal requests `plugin:web-chat:read`
- **THEN** the policy SHALL deny it

#### Scenario: Customer allowed on the public API
- **WHEN** a customer principal requests `plugin:web-chat:public`
- **THEN** the policy SHALL allow it

#### Scenario: Operator unaffected
- **WHEN** a principal from a non-customer issuer requests any action
- **THEN** the policy SHALL allow it

#### Scenario: Confinement holds while web-chat is disabled
- **WHEN** the `web-chat` plugin is disabled and a customer principal requests a core non-session road
- **THEN** the policy SHALL still deny it

#### Scenario: Refused registration is logged
- **WHEN** another plugin is named in `identity.trustedPolicyPlugin`
- **THEN** `web-chat-policy`'s registration SHALL throw `policy_not_trusted` and the plugin SHALL log that it is inactive
