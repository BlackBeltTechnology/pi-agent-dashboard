# pi-trust-mirror-types.ts — index

Browser-safe types: `MirrorSourceKind`, `MirrorIgnoreReason`, `MirrorWithheldReason`, `MIRROR_REASON_LABELS`, `PiTrustSnapshot`/`PiTrustSnapshotEntry`. No Node imports. See change: mirror-dashboard-trust-to-pi.

`MirrorSourceKind` + `yolo` (live-only); `MirrorWithheldReason` + `identity-weak` + 7 `live-*` codes (18 total); `MIRROR_WITHHELD_LABELS`; `PiTrustSnapshot.liveCount` (count only, never identities). See change: mirror-dashboard-trust-live-remote.
