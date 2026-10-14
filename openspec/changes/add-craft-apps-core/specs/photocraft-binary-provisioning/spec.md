## REMOVED Requirements

### Requirement: Release version resolution
**Reason**: Superseded by `craft-binary-provisioning` → "Per-app release version resolution"; PhotoCraft is one registry row.
**Migration**: None for users — `PHOTOCRAFT_BIN` and `PHOTOCRAFT_VERSION` keep the same meaning (per-app `<APP>_BIN`/`<APP>_VERSION`).

### Requirement: Host platform to release asset mapping
**Reason**: Superseded by `craft-binary-provisioning` → "Host platform to release asset mapping" (same assets for PhotoCraft).
**Migration**: None.

### Requirement: Checksum verification fails closed
**Reason**: Superseded by `craft-binary-provisioning` → "Checksum verification fails closed" (identical rules).
**Migration**: None.

### Requirement: Extraction into a versioned cache
**Reason**: Superseded by `craft-binary-provisioning` → "Extraction into a per-app versioned cache"; default path `<pi agent dir>/tools/photocraft/<version>/` is unchanged and `PHOTOCRAFT_HOME` is still honoured.
**Migration**: None — existing caches are reused as cache hits.

### Requirement: Headless only
**Reason**: Superseded by `craft-binary-provisioning` → "Desktop installers only on explicit request".
**Migration**: None.

### Requirement: Provisioning reports what it did
**Reason**: Superseded by `craft-binary-provisioning` → "Provisioning report" (adds the `app` field and the `launcher` source).
**Migration**: Consumers parsing the JSON report see one additional key `app`.
