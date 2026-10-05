# bpmn-package-render-root Specification

## Purpose
Define how the `bpmn-package-explorer` skill assembles a render root (`render.mjs` `assembleRenderRoot`): the served directory that links a BPMN package's artifacts next to the viewer shell, so it loads correctly regardless of how the package directory was given.

## Requirements

### Requirement: Render root links real artifacts for any package dir form

`assembleRenderRoot(packageDir, outDir)` SHALL create each artifact link in the render root with an absolute target, so every linked file resolves to the package artifact whether `packageDir` is absolute or relative to the current working directory.

#### Scenario: Relative package dir
- **WHEN** the render root is assembled with a package dir given relative to the working directory
- **THEN** reading the entry `.bpmn` and `package.yaml` through the render root returns the package files' contents

#### Scenario: Absolute package dir unchanged
- **WHEN** the render root is assembled with an absolute package dir
- **THEN** the render root is identical to the behavior before this change
