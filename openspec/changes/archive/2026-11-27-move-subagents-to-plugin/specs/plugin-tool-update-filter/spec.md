# Spec Delta

## Purpose

Lets a plugin bridge declare, as data, which fields to drop from `tool_execution_update` frames of a tool the plugin claims, so payload reduction for a plugin's tool lives in that plugin instead of core.

## ADDED Requirements

### Requirement: A plugin bridge SHALL declare a tool-update filter as data

A plugin bridge SHALL be able to emit `dashboard:register-tool-update-filter` with `{ pluginId, toolName, dropPaths, when? }`. `dropPaths` lists dot paths in the event payload. `when` is an optional `{ path, in }` condition on a string value. The bridge SHALL validate the declaration as untrusted input and accept data only.

#### Scenario: Declared filter drops a path for its tool
- **GIVEN** a filter `{ toolName: "Agent", dropPaths: ["partialResult.details.entries", "details.entries"], when: { path: "partialResult.details.status", in: ["queued","running"] } }`
- **WHEN** an `Agent` `tool_execution_update` with status `running` and 40 entries is forwarded
- **THEN** the forwarded payload SHALL have no `partialResult.details.entries` and every other field unchanged

#### Scenario: Condition not met keeps the payload
- **WHEN** an `Agent` `tool_execution_update` with status `completed` is forwarded under the same filter
- **THEN** the payload SHALL be forwarded with its entries unchanged

#### Scenario: Other tools are untouched
- **WHEN** a `bash` `tool_execution_update` is forwarded
- **THEN** no `Agent` filter SHALL apply to it

#### Scenario: Invalid declaration is refused
- **WHEN** a declaration has a non-string `toolName`, an empty `dropPaths`, or more than 16 paths
- **THEN** it SHALL be refused and counted, and SHALL NOT throw

### Requirement: Only the plugin claiming the tool SHALL filter it

The bridge SHALL accept a filter for a tool only from the plugin whose manifest claims a tool renderer for that tool name. One filter per tool SHALL be in force, and the claiming plugin re-declaring it SHALL be idempotent.

#### Scenario: Non-claiming plugin is refused
- **GIVEN** the subagents plugin claims the `Agent` tool renderer
- **WHEN** plugin `other` declares a filter for `Agent`
- **THEN** the declaration SHALL be refused and counted, and the subagents filter SHALL stay in force

### Requirement: Filtering SHALL NOT mutate the emitted payload

The bridge SHALL forward a copy with the dropped paths removed. The object emitted by the tool SHALL stay unchanged for every other listener.

#### Scenario: Original object keeps its entries
- **WHEN** a filtered `Agent` update is forwarded
- **THEN** the emitting producer's object SHALL still hold its entries
