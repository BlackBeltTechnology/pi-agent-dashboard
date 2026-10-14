# @blackbelt-technology/pi-dashboard-photocraft — deprecated

**This package is superseded by [`@blackbelt-technology/pi-dashboard-craft-apps`](../craft-apps/README.md)**, which
provisions and drives all thirteen ArtCraft Crafting Apps (PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft,
EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft) and ships the PhotoCraft
skill together with a `craft-studio` router skill and one skill per app.

This final release is a **shim**: it depends on `craft-apps` and keeps the `pi-photocraft` bin at the same path, so
existing `.pi/mcp.json` entries (`node …/pi-photocraft mcp`) and scripts keep working unchanged.

## Migrate

```bash
pi install npm:@blackbelt-technology/pi-dashboard-craft-apps     # skills + pi-craft + pi-photocraft
pi-craft photocraft mcp --register                               # replaces the old entry (name stays "photocraft")
```

`PHOTOCRAFT_VERSION`, `PHOTOCRAFT_BIN`, `PHOTOCRAFT_HOME` and the `tools/photocraft/<version>` cache are unchanged, so
no binary is downloaded again. `pi-photocraft replace-region` stays a PhotoCraft subcommand of `pi-photocraft`.

## Rollback

Un-deprecate this package (`npm deprecate … ""`) and pin the previous release; the cache is shared and compatible.
