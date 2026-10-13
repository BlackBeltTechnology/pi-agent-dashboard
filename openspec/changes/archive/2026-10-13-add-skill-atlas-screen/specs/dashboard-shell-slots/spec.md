## ADDED Requirements

### Requirement: `resource-page-section` slot

The slot taxonomy SHALL include `resource-page-section` (multiplicity `many`, react-only). It SHALL render plugin sections on the resource pages (Skills, Agents, Extensions, Prompts, Themes) of both the folder settings and the global settings. Props SHALL be `{ resourceType, scope: "folder" | "global", cwd?, pluginContext }`, where `scope` names the surface (the folder settings or the global settings), independent of any scope filter shown on that surface, and `cwd` is present exactly when `scope` is `"folder"`. A claim MAY declare a `resourceType`. Such a claim SHALL render only on that resource type's page, and a claim without one SHALL render on every resource page. Sections SHALL render above the resource grid, ordered by plugin priority, each inside the per-claim error boundary. A section that renders nothing SHALL leave no chrome behind. The slot is predicate-irrelevant: `SlotPredicateInput<"resource-page-section">` SHALL be `never`.

#### Scenario: Skill-scoped claim
- **WHEN** an enabled plugin claims `{ slot: "resource-page-section", resourceType: "skill" }`
- **THEN** its section SHALL render on the Folder Skills and Global Skills pages and SHALL NOT render on the Agents page

#### Scenario: Folder props carry cwd
- **WHEN** the section renders on the Skills page of folder `/repo`
- **THEN** it SHALL receive `scope: "folder"` and `cwd: "/repo"`

#### Scenario: Global props omit cwd
- **WHEN** the section renders on the global Skills settings page
- **THEN** it SHALL receive `scope: "global"` and no `cwd`

#### Scenario: Predicate input is never
- **WHEN** type-checking `SlotPredicateInput<"resource-page-section">`
- **THEN** the resolved type SHALL be `never`, and the slot-taxonomy exhaustiveness assertion SHALL pass

#### Scenario: Throwing section is isolated
- **WHEN** a `resource-page-section` component throws during render
- **THEN** the resource grid and other sections SHALL still render
