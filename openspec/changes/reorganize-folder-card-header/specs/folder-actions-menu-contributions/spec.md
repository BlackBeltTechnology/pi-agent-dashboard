## ADDED Requirements

### Requirement: Folder actions menu accepts declarative item contributions

The folder actions menu SHALL accept contributed items from plugins and first-party folder
sections through a dedicated contribution slot. A contribution SHALL be declarative data —
a stable id, a group, a label, an icon, an optional badge, an optional disabled state, and a
select handler — and SHALL NOT be arbitrary rendered markup.

The host SHALL own presentation: grouping, ordering, separators, keyboard semantics, focus
management, and the mobile presentation. A contributor SHALL NOT be able to influence those.

#### Scenario: Plugin contributes an item as data

- **WHEN** a plugin contributes a folder actions menu item
- **THEN** the contribution SHALL consist of an id, group, label, icon, optional badge, optional disabled flag, and a select handler
- **AND** the contribution SHALL NOT include rendered markup

#### Scenario: Host renders contributed items uniformly

- **WHEN** contributed items from different plugins render in the menu
- **THEN** they SHALL share the host's item styling, spacing and interaction behaviour
- **AND** a contributor SHALL NOT be able to override them

#### Scenario: Contributed item carries a badge

- **GIVEN** a KB slot reporting 1 stale file
- **WHEN** its reindex item renders in the menu
- **THEN** the item SHALL display a badge conveying the stale count

### Requirement: Menu groups are a fixed host-owned taxonomy

Contributed items SHALL declare membership in one of a fixed set of host-defined groups:
workspace membership, directory, create, open, and maintenance. A contributor SHALL NOT
define its own group.

Groups SHALL render in a stable host-defined order, and a group SHALL render only when it
contains at least one item. Because groups are named by verb rather than by slot, an item
whose origin is not obvious from its label SHALL carry a slot-qualified label.

#### Scenario: Empty group does not render

- **GIVEN** a folder for which no plugin contributes a create-group item
- **WHEN** the menu opens
- **THEN** the create group heading SHALL NOT render

#### Scenario: Group order is stable regardless of contributor load order

- **GIVEN** two plugins contributing items in different registration orders across reloads
- **WHEN** the menu opens
- **THEN** the group order SHALL be identical each time

#### Scenario: Ambiguous item labels are slot-qualified

- **WHEN** the OpenSpec archive and specs items render in the open group
- **THEN** their labels SHALL name the OpenSpec slot they act on

### Requirement: Per-slot refresh collapses into one folder refresh

The menu SHALL expose a single folder-level refresh item that refetches every slot's data
for that directory. Individual slots SHALL NOT contribute their own refresh items.

A slot-specific maintenance action that is not a plain refetch — for example rebuilding a
knowledge-base index — SHALL remain its own item.

#### Scenario: One refresh covers every slot

- **WHEN** the user selects the folder refresh item
- **THEN** every slot section for that folder SHALL refetch its data

#### Scenario: Slots contribute no refresh items

- **WHEN** the menu opens for a folder with automations, goals, KB and OpenSpec slots present
- **THEN** exactly one refresh item SHALL render

#### Scenario: Index rebuild is not folded into refresh

- **GIVEN** a folder whose knowledge base has stale files
- **WHEN** the menu opens
- **THEN** a distinct reindex item SHALL render alongside the folder refresh item
