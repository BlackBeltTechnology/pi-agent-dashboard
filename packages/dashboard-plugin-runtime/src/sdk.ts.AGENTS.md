# sdk.ts — index

`./sdk`: bundled pure helpers. `encodeFolderPath`, `decodeFolderPath`, `folderRouteHref(cwd, suffix)`, `HOST_FX_CLASSES`, `UI_PRIMITIVE_KEYS`, `UiPrimitiveMap`, slot-props types, `HostApiRange`, pure `satisfiesHostApiRange`. NEVER `PLUGIN_HOST_API_VERSION`/`satisfiesHostApi` (a bundled copy would carry the build-time version). No react import, no module state. See change: decouple-plugins-from-core.
