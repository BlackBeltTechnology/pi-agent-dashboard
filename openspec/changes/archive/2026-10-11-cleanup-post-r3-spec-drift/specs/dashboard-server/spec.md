## MODIFIED Requirements

### Requirement: Doctor does not probe for tsx
No Doctor surface SHALL execute `where tsx` / `which tsx`, resolve a `tsx` package, or report tsx as a TypeScript loader. This covers both Electron Doctor (`packages/electron/src/lib/doctor.ts`) and the shared checks it and the server's doctor route delegate to (`packages/shared/src/doctor-core.ts`). The server can only boot on the Node-native loader or jiti (`selectTsLoader` returns `native` or `jiti`), so tsx can never satisfy the check. The "TypeScript loader" row SHALL check only the selected loader: the Node-native register module by default, or jiti when `PI_DASHBOARD_TS_LOADER=jiti` or when Node lacks native type stripping.

#### Scenario: Doctor output omits tsx
- **WHEN** Doctor runs against a clean install
- **THEN** no diagnostic row mentions tsx
- **AND** the server-launch-test row passes when `node` + the selected loader are present
- **AND** with the default native loader the row SHALL NOT report "No jiti loader" when pi is absent

#### Scenario: jiti mode ignores an installed tsx
- **WHEN** the jiti loader is selected AND no jiti package resolves from the managed install or the bundled tree
- **AND** tsx is installed (managed, bundled, or on `PATH`)
- **THEN** the "TypeScript loader" row SHALL report status `error` with code `doctor.ts_loader_not_found`
- **AND** the row and its remediation text SHALL NOT mention tsx

#### Scenario: jiti mode reports the resolved jiti
- **WHEN** the jiti loader is selected AND jiti resolves from the managed install or the bundled tree
- **THEN** the "TypeScript loader" row SHALL report status `ok` naming the jiti version and location
