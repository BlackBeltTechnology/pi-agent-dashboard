# build-declaration-sdk.ts — index

`computeBuildDeclaration(plugins, {isProd, bundleRoots})` — builds the served-artifact declaration from an EXPLICIT plugin list: selects through `selectClientRegistryPlugins` then delegates the digest to `pluginRegistryHash` (no second serializer), so the declaration hash equals the embedded `PLUGIN_REGISTRY_HASH` by construction. See change: add-served-build-coherence-and-hash-parity (design D2). … → see `build-declaration-sdk.ts.AGENTS.md`
