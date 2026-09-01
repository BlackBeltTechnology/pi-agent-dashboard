# ascii-table-detection Specification

## Purpose

Detects ASCII/box-drawing table blocks in agent output and wraps them in code fences so they render as aligned monospace rather than being mangled by the markdown renderer. Defines the detection boundaries — existing fenced blocks are left alone — and requires a pure function interface so the rule is testable in isolation.

## Requirements

### Requirement: Detect ASCII table blocks
The `wrapAsciiTables` function SHALL detect consecutive lines containing box-drawing characters (`─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬`) or plain ASCII table patterns (`+---+`). A block of 2 or more consecutive matching lines SHALL be considered an ASCII table block.

#### Scenario: Box-drawing table detected
- **WHEN** content contains 3+ consecutive lines with box-drawing characters like `┌──┬──┐`, `│ A │ B │`, `└──┴──┘`
- **THEN** the block SHALL be detected as an ASCII table

#### Scenario: Plain ASCII table detected
- **WHEN** content contains lines matching `+---+---+` patterns
- **THEN** the block SHALL be detected as an ASCII table

#### Scenario: Single decorative line not detected
- **WHEN** content contains a single line with box-drawing characters surrounded by normal text
- **THEN** it SHALL NOT be detected as an ASCII table (requires 2+ consecutive lines)

#### Scenario: Bare pipe lines not detected
- **WHEN** content contains lines with only `|` characters (standard markdown table syntax)
- **THEN** they SHALL NOT be detected as ASCII tables (handled by remarkGfm)

### Requirement: Wrap detected blocks in code fences
Detected ASCII table blocks SHALL be wrapped in triple-backtick fenced code blocks to ensure monospace rendering.

#### Scenario: Block wrapped
- **WHEN** an ASCII table block is detected
- **THEN** a line containing ` ``` ` SHALL be inserted before and after the block

#### Scenario: Content before and after preserved
- **WHEN** an ASCII table block appears between normal text
- **THEN** the surrounding text SHALL be unchanged

### Requirement: Skip existing code fences
Lines inside existing fenced code blocks (``` or ~~~) SHALL NOT be processed by the detector.

#### Scenario: ASCII table inside code block
- **WHEN** box-drawing characters appear inside an existing fenced code block
- **THEN** they SHALL NOT be double-wrapped

### Requirement: Pure function interface
The `wrapAsciiTables` function SHALL be a pure function accepting a string and returning a string. It SHALL have no side effects.

#### Scenario: No ASCII tables in content
- **WHEN** content contains no ASCII table blocks
- **THEN** the output SHALL be identical to the input
