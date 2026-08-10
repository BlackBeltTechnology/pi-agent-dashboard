# file-diff-directory-tree-build Specification

## Purpose

Convert a flat list of file diff entries into a nested directory tree for display. Entries inside the workspace are split by path segment into a directory hierarchy with single-child directory chains collapsed; entries outside the workspace are grouped as leaves under a synthetic sentinel node.

## Requirements

### Requirement: Empty and workspace partitioning

The build SHALL partition entries by workspace membership and handle the empty case before constructing any tree.

#### Scenario: Empty input
- **WHEN** the entry list is empty
- **THEN** the result SHALL be an empty list of tree nodes

#### Scenario: Partition by previewability
- **WHEN** entries are provided
- **THEN** entries whose `previewable` is not `false` SHALL be treated as inside the workspace and split into the relative directory tree
- **AND** entries whose `previewable` is `false` SHALL be excluded from the relative tree and reserved for the outside-workspace group

### Requirement: Nested directory tree construction

The build SHALL construct a nested tree from inside-workspace entries by splitting each path on `/`.

#### Scenario: Split path into directory and file nodes
- **WHEN** an inside-workspace entry has a path with multiple `/`-separated segments
- **THEN** each non-final segment SHALL become a directory node and the final segment SHALL become a file node
- **AND** the file node SHALL carry the originating file diff entry
- **AND** each node's path SHALL be the join of the segments up to and including that node

#### Scenario: Shared directory prefixes merge
- **WHEN** two inside-workspace entries share a leading directory segment
- **THEN** they SHALL share the same directory node rather than creating duplicate directory nodes

### Requirement: Ordering

The build SHALL order every level of the tree with directories before files, each group alphabetically.

#### Scenario: Directories before files
- **WHEN** a directory contains both subdirectories and files
- **THEN** subdirectories SHALL be ordered before files at that level

#### Scenario: Alphabetical within group
- **WHEN** a level contains multiple directories or multiple files
- **THEN** entries within the same kind SHALL be ordered alphabetically by name

### Requirement: Single-child directory chain collapse

The build SHALL collapse a directory whose only child is itself a directory into a single combined node.

#### Scenario: Collapse a chain of single directory children
- **WHEN** a directory has exactly one child and that child is a directory
- **THEN** the two SHALL be merged into one node whose name is the parent name and child name joined by `/`
- **AND** the merge SHALL repeat while the resulting node still has exactly one directory child

#### Scenario: Do not collapse a directory whose single child is a file
- **WHEN** a directory has exactly one child and that child is a file
- **THEN** the directory SHALL NOT be collapsed and SHALL retain its own name

#### Scenario: Do not collapse a directory with multiple children
- **WHEN** a directory has more than one child
- **THEN** the directory SHALL NOT be collapsed

### Requirement: Outside-workspace sentinel group

The build SHALL group outside-workspace entries as flat leaves under a single synthetic directory node appended after the relative tree.

#### Scenario: Sentinel group node
- **WHEN** at least one entry is outside the workspace
- **THEN** a synthetic directory node named "outside workspace" SHALL be appended to the top-level result
- **AND** its path SHALL be the reserved sentinel path value

#### Scenario: Leaf per outside-workspace entry
- **WHEN** an entry is outside the workspace
- **THEN** it SHALL appear as a file leaf under the sentinel node, not split into directory levels
- **AND** its display name SHALL be the basename of the path split on `/` or `\`, falling back to the full path when no separator is present

#### Scenario: Outside-workspace leaves ordered alphabetically
- **WHEN** multiple entries are outside the workspace
- **THEN** their leaves SHALL be ordered alphabetically by display name

#### Scenario: No sentinel group when all entries are inside
- **WHEN** no entry is outside the workspace
- **THEN** no sentinel node SHALL be added to the result
