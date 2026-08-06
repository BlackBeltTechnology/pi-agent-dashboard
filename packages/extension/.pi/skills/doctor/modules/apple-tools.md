---
name: apple-tools
scope: iMCP (Apple PIM) provisioning state for the apple-tools plugin.
symptoms:
  - apple tools not working
  - imcp not provisioned
  - calendar tool fails
  - apple calendar contacts reminders
  - imcp-server not found
depends-on: [env-node]
derives-from:
  - packages/apple-tools/src/install.ts (runInstaller check mode — the shared checker)
  - packages/apple-tools/src/doctor.ts (doctorProbe — read-only verdict)
  - packages/apple-tools/src/detect.ts (MIN_MACOS 15.3, candidate paths)
---

## SCOPE
Whether iMCP is provisioned for the `apple-tools` plugin on this host: platform,
macOS version floor, `imcp-server` discovery, and the two config writes. macOS
only — a non-macOS host is inert, never a fault.

## KNOWLEDGE
The verdict derives from the SAME write-suppressed checker the CLI `--check` and
the settings panel use (`doctorProbe` → `runInstaller(env, { check: true })`), so
all surfaces report the same nine-member terminal state:
`UNSUPPORTED_PLATFORM`, `OS_VERSION_UNKNOWN`, `OS_TOO_OLD`, `NO_INSTALL_METHOD`,
`INSTALL_FAILED`, `CONFIG_UNPARSEABLE`, `CONFIG_WRITE_FAILED`,
`READY_PENDING_GRANTS`, `READY`.
- The probe is read-only: 0 config writes, 0 install attempts.
- Non-macOS reports `UNSUPPORTED_PLATFORM` and is NOT a remediation item.
- TCC permission grants are menu-bar only and undetectable ahead of a call — a
  granted vs pending distinction cannot be probed.

## CHECKS
- `doctorProbe(createInstallerEnv(), packagePresent)` from
  `@blackbelt-technology/pi-dashboard-apple-tools` (via its source module).
- Compare the resulting `state` with `pi-apple-tools-install --check` — they MUST
  match (single implementation).
- `packagePresent` = is `@blackbelt-technology/pi-dashboard-apple-tools` installed.

## FIX ROUTING
- `NO_INSTALL_METHOD` / binary absent → run `pi-apple-tools-install` (installs the
  iMCP cask when Homebrew is present, else prints the download link).
- `OS_TOO_OLD` / `OS_VERSION_UNKNOWN` → upgrade macOS to >= 15.3.
- `READY_PENDING_GRANTS` → open the iMCP menu-bar app and grant permissions
  (manual, unautomatable).
- A permission-class failure at call time → menu-bar remediation, NOT re-install.

## DERIVES-FROM
Source: `packages/apple-tools/src/install.ts`, `packages/apple-tools/src/doctor.ts`,
`packages/apple-tools/src/detect.ts`. Hash sidecar: `apple-tools.knowledge.hash`.
