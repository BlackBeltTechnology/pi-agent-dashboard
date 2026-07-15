# i18n Audit — comp_1.txt (60 client components)

Generated: 2026-07-14

| file:line | category | string | hasI18nImport |
|---|---|---|---|
| `OpenSpecActivityBadge.tsx:7` | label-map | `"Exploring"` | no |
| `OpenSpecActivityBadge.tsx:8` | label-map | `"New Change"` | no |
| `OpenSpecActivityBadge.tsx:9` | label-map | `"Specifying"` | no |
| `OpenSpecActivityBadge.tsx:10` | label-map | `"Fast-Forward"` | no |
| `OpenSpecActivityBadge.tsx:11` | label-map | `"Applying"` | no |
| `OpenSpecActivityBadge.tsx:12` | label-map | `"Verifying"` | no |
| `OpenSpecActivityBadge.tsx:13` | label-map | `"Archiving"` | no |
| `OpenSpecActivityBadge.tsx:14` | label-map | `"Syncing Specs"` | no |
| `OpenSpecActivityBadge.tsx:15` | label-map | `"Onboarding"` | no |
| `OpenSpecActivityBadge.tsx:41` | fallback-label | `"OpenSpec"` | no |
| `OpenSpecStepper.tsx:88` | label-map | `"Explore"` | no |
| `OpenSpecStepper.tsx:89` | label-map | `"Proposal"` | no |
| `OpenSpecStepper.tsx:90` | label-map | `"Design"` | no |
| `OpenSpecStepper.tsx:92` | label-map | `"Tasks"` | no |
| `OpenSpecStepper.tsx:93` | label-map | `"Apply"` | no |
| `OpenSpecStepper.tsx:94` | label-map | `"Archive"` | no |
| `PairLanding.tsx:68` | error-message | `"This pairing link is missing its code. Re-scan the QR from the dashboard."` | no |
| `PairLanding.tsx:72` | error-message | `"This pairing link is malformed. Re-scan the QR from the dashboard."` | no |
| `PairLanding.tsx:104` | error-message | `"Could not verify the server's identity (pin mismatch or unreachable). Pairing refused."` | no |
| `PairLanding.tsx:120` | error-message | `"Pairing expired or was rejected. Re-scan the QR to start over."` | no |
| `PairLanding.tsx:148` | JSX-text | `>Pair this device<` | no |
| `PairLanding.tsx:161` | JSX-text | `>Type this code on the dashboard to approve this device:<` | no |
| `PiVersionAdvisory.tsx:31` | JSX-text | `>How to upgrade<` | no |
| `MergeConfirmDialog.tsx:34` | error-message | `"no data"` | yes |
| `QueuePanel.tsx:125` | confirm-dialog | `"Remove this follow-up entry?"` | yes |
| `MobileActionMenu.tsx:240` | confirm-dialog | `"Session is currently running. Exit anyway?"` | yes |
| `ProviderAuthSection.tsx:36` | throw-error | `"Failed to load provider auth handlers"` | yes |
| `ProviderAuthSection.tsx:171` | error-message | `"Login timed out. Please try again."` | yes |
| `ProviderAuthSection.tsx:209` | fallback-error | `"Authorization expired"` | yes |
| `KnownServersSection.tsx:42` | error-message | `"Host and valid port are required"` | yes |
| `ModelProxySection.tsx:301` | error-message | `"Label is required"` | yes |
| `ModelProxySection.tsx:308` | fallback-error | `"Failed to create key"` | yes |
| `ModelProxySection.tsx:426` | fallback-error | `"Failed to load keys"` | yes |
| `ModelProxySection.tsx:447` | error-message | `"Port must be 1024–65535"` | yes |
| `ModelProxySection.tsx:466` | fallback-error | `"Failed to revoke key"` | yes |
| `ModelProxySection.tsx:475` | fallback-error | `"Failed to delete key"` | yes |
| `ModelProxySection.tsx:483` | fallback-error | `"Refresh failed"` | yes |
| `NetworkDiscoverySection.tsx:55` | fallback-error | `"Scan failed"` | yes |
| `NetworkDiscoverySection.tsx:90` | error-message | `"Enter a host like 192.168.1.42:8000 or http://office-mac.local:8000"` | yes |
| `NetworkDiscoverySection.tsx:94` | error-message | `"...is already in your known servers."` | yes |
| `NetworkDiscoverySection.tsx:104` | fallback-error | `"Failed to add server"` | yes |
| `PackageReadmeDialog.tsx:41` | fallback-error | `"Failed to fetch README"` | yes |
| `PairedDevicesSection.tsx:31` | fallback-error | `"failed to load"` | yes |
| `PairedDevicesSection.tsx:48` | fallback-error | `"failed to revoke"` | yes |
| `PairingView.tsx:125` | fallback-error | `"approval failed"` | yes |
| `PairingView.tsx:68` | fallback-error | `"failed to load pairing payload"` | yes |
| `PathPicker.tsx:128` | fallback-error | `"Failed to browse"` | yes |
| `PathPicker.tsx:252` | fallback-error | `"mkdir failed"` | yes |
| `PluginsSection.tsx:352` | error-message | `"Cannot enable: missing dep(s) — {blockers}"` | yes |

## Summary

- **Total untranslated strings**: 50
- **Files affected**: 16 of 60
- **Files completely missing i18n import** (11 files, multiple contain untranslated strings):
  - `PairLanding.tsx` — 6 strings (biggest offender)
  - `OpenSpecActivityBadge.tsx` — 10 strings
  - `OpenSpecStepper.tsx` — 6 strings
  - `PiVersionAdvisory.tsx` — 1 string
- **Files with i18n import but still have hardcoded error messages**: `QueuePanel.tsx`, `MobileActionMenu.tsx`, `ProviderAuthSection.tsx`, `KnownServersSection.tsx`, `ModelProxySection.tsx`, `NetworkDiscoverySection.tsx`, `PackageReadmeDialog.tsx`, `PairedDevicesSection.tsx`, `PairingView.tsx`, `PathPicker.tsx`, `PluginsSection.tsx`, `MergeConfirmDialog.tsx` — 28 strings total (mostly `setError("...")` fallbacks and `confirm()` dialog strings)
