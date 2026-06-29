## ADDED Requirements

### Requirement: Tailwind source scan covers all plugin client packages

The Tailwind v4 entry stylesheet (`packages/client/src/index.css`) SHALL declare
`@source` directives that cover every package shipping client-side React
components with Tailwind utility classes, so that utilities referenced only in
plugin source are not purged from the production stylesheet. The scan SHALL
include one explicit `@source "../../<plugin>/src/client"` directive per
client-bearing plugin package, in addition to client-bearing packages that do
not nest under `src/client` (`client-utils/src`, `dashboard-plugin-runtime/src`).

A bare star glob over sibling `src/client` directories (e.g.
`@source "../../*/src/client"`) does NOT expand in this Tailwind v4 setup and
additionally embeds the comment-terminating `*/` sequence; explicit
enumeration is therefore required. A plugin author adding a new
`packages/<plugin>/src/client` directory SHALL add a corresponding `@source`
line so that plugin's Tailwind utilities are emitted.

#### Scenario: Goal-plugin hover utilities are emitted

- **GIVEN** `goal-plugin/src/client/FolderGoalsSection.tsx` applies
  `hover:text-indigo-400`, `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`
- **WHEN** the production build runs (`npm run build`)
- **THEN** `packages/client/dist/assets/index-*.css` SHALL contain
  `hover:text-indigo-400`, `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`

#### Scenario: Existing plugin utilities are not regressed

- **WHEN** the production build runs
- **THEN** the emitted stylesheet SHALL still contain `hover:text-blue-400`
  (used by the automation and openspec folder rows)

#### Scenario: Each client-bearing plugin has an explicit @source line

- **GIVEN** a plugin package `packages/<plugin>/src/client` that uses Tailwind
  utility classes
- **WHEN** `packages/client/src/index.css` is inspected
- **THEN** it SHALL contain a `@source "../../<plugin>/src/client"` directive
  for that package
- **AND** `goal-plugin` and `automation-plugin` SHALL each have such a directive
