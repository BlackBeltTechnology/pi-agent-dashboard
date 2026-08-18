# electron-app-icons Specification

## Purpose

Defines the desktop application's icon set: one master icon, the per-platform variants each OS requires, macOS tray template icons, and refreshed PWA icons. Requires generation via a script so every variant stays derived from the master rather than hand-edited into drift.

## Requirements

### Requirement: Master app icon
A centered 1024×1024 PNG master icon SHALL exist at `packages/electron/resources/icon.png` featuring the π glyph optically centered on the dark navy rounded-rectangle background.

#### Scenario: Master icon exists and is centered
- **WHEN** the icon generation script runs
- **THEN** the master PNG at `packages/electron/resources/icon.png` SHALL be 1024×1024 with the π glyph optically centered

### Requirement: Platform icon variants
The build process SHALL generate platform-specific icon variants from the master PNG.

#### Scenario: macOS .icns generated
- **WHEN** the icon generation script runs
- **THEN** `packages/electron/resources/icon.icns` SHALL be created containing resolutions from 16×16 to 512×512@2x

#### Scenario: Windows .ico generated
- **WHEN** the icon generation script runs
- **THEN** `packages/electron/resources/icon.ico` SHALL be created containing resolutions from 16×16 to 256×256

#### Scenario: Icons wired into Forge config
- **WHEN** the Electron app is packaged
- **THEN** `forge.config.ts` `packagerConfig.icon` SHALL reference `./resources/icon` (no extension, Forge picks per platform)

### Requirement: macOS tray template icons
Monochrome template images SHALL exist for the macOS menu bar tray icon.

#### Scenario: Tray template icons exist
- **WHEN** the tray is created on macOS
- **THEN** it SHALL load `trayTemplate.png` (16×16) and `trayTemplate@2x.png` (32×32) from the resources directory
- **AND** these images SHALL be white π silhouettes on transparent background

### Requirement: PWA icons updated
The PWA icons SHALL use the same centered π design as the Electron app icon.

#### Scenario: PWA icons match app icon
- **WHEN** the icon generation script runs
- **THEN** `public/icon-512.png` and `public/icon-192.png` SHALL be updated with the recentered design

### Requirement: Icon generation script
A dev script SHALL automate icon variant generation from the master PNG.

#### Scenario: Script generates all variants
- **WHEN** `npm run icons` (or equivalent) is run from `packages/electron/`
- **THEN** it SHALL generate `.icns`, `.ico`, and resized PNGs from the master icon
