# command-substring-filter Specification

## Purpose

Filter a list of commands to those matching a user-supplied query, using a case-insensitive substring match over each command's name and description, so the command list narrows as the user types.

## Requirements

### Requirement: Case-insensitive substring matching

The filter SHALL match a command when the query appears as a case-insensitive substring of the command's name OR its description. Both the name and the description are searched. Descriptions that are absent SHALL be treated as non-matching for that field.

#### Scenario: Query matches command name

- **WHEN** a query is provided and a command's name contains the query as a substring, ignoring letter case
- **THEN** that command is included in the result

#### Scenario: Query matches command description

- **WHEN** a query is provided and a command's description contains the query as a substring, ignoring letter case
- **AND** the command's name does not contain the query
- **THEN** that command is included in the result

#### Scenario: Command has no description

- **WHEN** a query is provided and a command has no description
- **AND** the command's name does not contain the query
- **THEN** that command is excluded from the result

### Requirement: Empty and non-matching queries

The filter SHALL return all commands unchanged when the query is empty, and SHALL return an empty list when no command matches the query.

#### Scenario: Empty query returns all commands

- **WHEN** the query is empty
- **THEN** every command is returned in its original order

#### Scenario: No command matches the query

- **WHEN** a non-empty query matches neither the name nor the description of any command
- **THEN** the result is an empty list
