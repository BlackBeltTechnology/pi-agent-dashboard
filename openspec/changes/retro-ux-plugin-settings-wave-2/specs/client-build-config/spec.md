## MODIFIED Requirements

### Requirement: Tailwind source scan covers all plugin client packages

The Tailwind v4 entry stylesheet (`packages/client/src/index.css`) SHALL declare
`@source` directives that cover every package shipping client-side React
components with Tailwind utility classes, so that utilities referenced only in
plugin source are not purged from the production stylesheet. The scan SHALL
include one explicit `@source "../../<plugin>/src/client"` directive per
client-bearing plugin package, in addition to client-bearing packages that do
not nest under `src/client` (`client-utils/src`, `dashboard-plugin-runtime/src`).
A plugin package whose client components live directly under `src/` (no
`src/client` directory, e.g. `grammar-plugin`, `quota-plugin`,
`flows-anthropic-bridge-plugin`, `roles-plugin`, `demo-plugin`) SHALL be covered by an explicit
`@source "../../<plugin>/src"` directive.

A bare star glob over sibling `src/client` directories (e.g.
`@source "../../*/src/client"`) does NOT expand in this Tailwind v4 setup and
additionally embeds the comment-terminating `*/` sequence; explicit
enumeration is therefore required. A plugin author adding a new
`packages/<plugin>/src/client` directory SHALL add a corresponding `@source`
line so that plugin's Tailwind utilities are emitted.

A repository test SHALL enumerate every plugin package whose manifest declares a
client entry or a `settings-section` claim and fail, naming the package, when no
`@source` directive covers the directory holding that package's client code.

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

#### Scenario: Plugins without a src/client directory are covered

- **GIVEN** `grammar-plugin`, `quota-plugin` and `flows-anthropic-bridge-plugin` keep their settings components directly under `src/`
- **WHEN** `packages/client/src/index.css` is inspected
- **THEN** it SHALL contain `@source "../../grammar-plugin/src"`, `@source "../../quota-plugin/src"` and `@source "../../flows-anthropic-bridge-plugin/src"`

#### Scenario: Previously missing plugins are covered

- **WHEN** `packages/client/src/index.css` is inspected
- **THEN** it SHALL contain a directive covering each of `apple-tools`, `blackhole-plugin`, `browser-plugin`, `chat-gateway`, `cost-estimator`, `roles-plugin` and `demo-plugin`

#### Scenario: Missing directive fails the repository test

- **WHEN** a plugin package with a `settings-section` claim has no covering `@source` directive
- **THEN** the repository test SHALL fail and name that package
