## ADDED Requirements

### Requirement: Bundled-extension activation runs before dynamic install
The dependency installer SHALL expose `installBundledExtensions(onProgress?)` and the wizard SHALL invoke it before `installRecommendedExtensions(...)`.

#### Scenario: Ordering
- **WHEN** the wizard runs the install sequence
- **THEN** it SHALL call `installBundledExtensions()` first, then `installRecommendedExtensions(skipPackages=<ids that succeeded>)`

#### Scenario: No bundled-extensions directory
- **WHEN** `<resourcesPath>/bundled-extensions/` does not exist (dev builds, opt-in flag off)
- **THEN** `installBundledExtensions()` SHALL return `0` without error and the wizard SHALL proceed normally

#### Scenario: Progress reporting shape
- **WHEN** `installBundledExtensions()` reports progress
- **THEN** each event SHALL use the existing `InstallProgress` type with `step` set to the extension's `displayName` and `status` ∈ `{ "running", "done", "error" }`

### Requirement: Recommended installer respects skipPackages from bundle
The existing `installStandalone` / `installRecommendedExtensions` paths SHALL treat ids provided in `skipPackages` as already-satisfied and report `{ status: "done", output: "Already installed (bundled)" }`.

#### Scenario: Skip reason is bundled
- **WHEN** an id is in `skipPackages` because `installBundledExtensions()` activated it
- **THEN** the progress event for that step SHALL include `output: "Already installed (bundled)"` so the wizard UI can distinguish bundled from system installs
