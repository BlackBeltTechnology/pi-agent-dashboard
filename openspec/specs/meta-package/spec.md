# meta-package Specification

## Purpose

Defines the published package layout: a meta-package that depends on every sub-package and exposes the CLI binary plus the pi extension and skills, and an extension package that remains independently installable and declares its own pi fields.

## Requirements

### Requirement: Meta-package depends on all sub-packages
The root package `@blackbelt-technology/pi-dashboard` SHALL declare dependencies on server, extension, and client packages.

#### Scenario: Installing meta-package gets everything
- **WHEN** a user runs `npm install @blackbelt-technology/pi-dashboard`
- **THEN** server, extension, and client packages SHALL all be installed

### Requirement: Meta-package exposes CLI binary
The meta-package SHALL expose the `pi-dashboard` binary by proxying to the server package's CLI entry point.

#### Scenario: pi-dashboard command works from meta-package
- **WHEN** `@blackbelt-technology/pi-dashboard` is installed globally
- **AND** a user runs `pi-dashboard start`
- **THEN** the server package's CLI SHALL execute

### Requirement: Meta-package exposes pi extension and skills
The meta-package SHALL declare `pi.extensions` and `pi.skills` fields that reference the extension package's entry points.

#### Scenario: Pi loads extension from meta-package
- **WHEN** pi discovers `@blackbelt-technology/pi-dashboard` as an installed package
- **THEN** pi SHALL load the bridge extension from the extension sub-package

#### Scenario: Pi loads skills from meta-package
- **WHEN** pi discovers `@blackbelt-technology/pi-dashboard` as an installed package
- **THEN** pi SHALL find the `pi-dashboard` skill from the extension sub-package

### Requirement: Extension package is independently installable
The extension package SHALL be independently installable for pi agents that connect to a remote server.

#### Scenario: Extension-only install on remote machine
- **WHEN** a user installs only `@blackbelt-technology/pi-dashboard-extension`
- **THEN** the bridge extension SHALL connect to a configured remote dashboard server
- **AND** no server or client code SHALL be present

### Requirement: Extension package declares pi fields
The extension package SHALL declare its own `pi.extensions` and `pi.skills` fields so it works as a standalone pi package.

#### Scenario: Pi loads extension directly
- **WHEN** `@blackbelt-technology/pi-dashboard-extension` is installed (without the meta-package)
- **THEN** pi SHALL discover and load the bridge extension and skills
