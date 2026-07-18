# WhatsNewPackageRow.tsx — index

Exports `WhatsNewPackageRow` + `WhatsNewPackageRowProps`. Wraps `PackageRow` with What's-New changelog affordance for any installed npm package. Owns `usePiChangelog` + `WhatsNewDialog` state (safe inside `.map()`). `OPEN_UPPER_BOUND = "9999.0.0"` sentinel. Silent skip when no changelog.
