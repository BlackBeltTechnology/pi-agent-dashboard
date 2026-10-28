# Spec Delta

## MODIFIED Requirements

### Requirement: Tailwind source scan covers all plugin client packages

The Tailwind v4 entry stylesheet (`packages/client/src/index.css`) SHALL cover every package shipping client-side React components with Tailwind utility classes, so that utilities referenced only in plugin source are not purged from the production stylesheet. Client-bearing packages that are not plugins (`client-utils/src`, `dashboard-plugin-runtime/src`) keep explicit `@source` directives in `index.css`.

Plugin coverage SHALL come from `packages/client/src/generated/plugin-sources.css`, which `index.css` imports and the dashboard Vite plugin generates from manifests (`dashboard-plugin-loader` "Client-side plugin entries are bundled by Vite"). It SHALL hold one explicit `@source` directive per client-bearing plugin under `<repo>/packages`, fixture or not (independent of the build's fixture policy, so dev and production builds generate the same file): `@source "../../../<plugin>/src/client"` (paths relative to `generated/`), or `@source "../../../<plugin>/src"` for a plugin whose client components live directly under `src/` (e.g. `grammar-plugin`, `quota-plugin`, `roles-plugin`, `demo-plugin`), plus one directive per claim `module` directory outside those.

A bare star glob over sibling `src/client` directories (e.g. `@source "../../*/src/client"`) does NOT expand in this Tailwind v4 setup and additionally embeds the comment-terminating `*/` sequence; explicit enumeration is therefore required. A plugin author SHALL NOT hand-edit `index.css` or the generated file: the previous rule that an author adds a `@source` line by hand is removed, because the line is now derived from the manifest.

A repository test SHALL enumerate every plugin package whose manifest declares a client entry or a `settings-section` claim and fail, naming the package, when no directive in the generated file covers the directory holding that package's client code or a claim `module` file.

#### Scenario: Goal-plugin hover utilities are emitted

- **GIVEN** `goal-plugin/src/client/FolderGoalsSection.tsx` applies
  `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`
- **WHEN** the production build runs (`npm run build`)
- **THEN** `packages/client/dist/assets/index-*.css` SHALL contain
  `hover:text-indigo-300`, and
  `hover:border-indigo-500/70`

#### Scenario: Existing plugin utilities are not regressed

- **WHEN** the production build runs
- **THEN** the emitted stylesheet SHALL still contain `hover:text-blue-400`
  (used by the automation and openspec folder rows)

#### Scenario: Each client-bearing plugin has an explicit @source line

- **GIVEN** a plugin package `packages/<plugin>/src/client` that uses Tailwind
  utility classes
- **WHEN** `packages/client/src/generated/plugin-sources.css` is inspected
- **THEN** it SHALL contain an `@source` directive covering `packages/<plugin>/src/client`
- **AND** `goal-plugin` and `automation-plugin` SHALL each have such a directive

#### Scenario: Plugins without a src/client directory are covered

- **GIVEN** `grammar-plugin`, `quota-plugin` and `roles-plugin` keep their settings components directly under `src/`
- **WHEN** `packages/client/src/generated/plugin-sources.css` is inspected
- **THEN** it SHALL contain directives covering `grammar-plugin/src`, `quota-plugin/src` and `roles-plugin/src`

#### Scenario: Previously missing plugins are covered

- **WHEN** `packages/client/src/generated/plugin-sources.css` is inspected
- **THEN** it SHALL contain a directive covering each of `apple-tools`, `blackhole-plugin`, `browser-plugin`, `chat-gateway`, `cost-estimator`, `roles-plugin` and `demo-plugin`

#### Scenario: Missing directive fails the repository test

- **WHEN** a plugin package with a `settings-section` claim has no covering `@source` directive in the generated file
- **THEN** the repository test SHALL fail and name that package

#### Scenario: index.css lists no plugin directory

- **WHEN** `packages/client/src/index.css` is inspected
- **THEN** it SHALL import `./generated/plugin-sources.css` and SHALL contain no `@source` directive naming a plugin package
