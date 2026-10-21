# file-validator-registry.ts — index

`FileValidatorRegistry` singleton `getFileValidatorRegistry()` keyed `(pluginId, claimId)`; `registerFileValidatorFor(pluginId, info, opts)` = impl of `ctx.registerFileValidator({claimId,module,enabled?})` (own edit claim only; module relative, no `..`, realpath-confined to package, must exist; throws otherwise). Loader clears a plugin's entries on disable/failed activation/re-activation. See change: add-editor-pane-file-handlers.
