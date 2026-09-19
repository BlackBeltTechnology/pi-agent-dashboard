## ADDED Requirements

### Requirement: A containment miss may suspend pending an operator verdict

A containment miss that is prompt-eligible and occurs while suspension is
permitted SHALL suspend the request pending an operator verdict instead of
refusing immediately. On an allow verdict the original request SHALL proceed and
return its real result; on any other outcome it SHALL return the denial it
returns today.

The containment layers themselves SHALL be unchanged: suspension happens only
after every existing layer has already missed, and no layer SHALL be skipped,
reordered, or widened.

#### Scenario: An allowed verdict resumes the original read

- **GIVEN** a containment miss suspended pending a verdict
- **WHEN** the operator allows it
- **THEN** the original request SHALL proceed and return its result

#### Scenario: A denied verdict returns today's denial

- **WHEN** the operator denies, or the prompt expires
- **THEN** the response SHALL be the denial the site returns today, including its existing `error` string

#### Scenario: An ineligible miss is never suspended

- **WHEN** a containment miss is not prompt-eligible
- **THEN** the request SHALL be refused immediately as today

#### Scenario: Every containment site behaves alike

- **WHEN** a containment miss occurs at any of the containment sites
- **THEN** its suspend-or-refuse behaviour SHALL follow the same rule

### Requirement: A suspended containment miss re-checks containment before proceeding

An allow verdict SHALL cause the containment check to be satisfied for the
verdict's subject only. The resumed request SHALL NOT bypass path resolution,
symlink resolution, or any other safety layer, and SHALL NOT be admitted for a
path outside the granted subject.

#### Scenario: A sibling path is not admitted

- **GIVEN** an allow verdict for one directory
- **WHEN** a suspended request resolves to a path outside that directory
- **THEN** it SHALL still be denied

#### Scenario: Symlink resolution still applies

- **WHEN** a suspended request resumes
- **THEN** the same symlink resolution the containment check performs today SHALL still be performed
