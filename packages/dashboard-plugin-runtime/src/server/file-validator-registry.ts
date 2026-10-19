/**
 * Registry of plugin file validators for `editor-pane-file-handler` edit claims
 * (change: add-editor-pane-file-handlers D4).
 *
 * A plugin's server entry calls `ctx.registerFileValidator({ claimId, module,
 * enabled? })`; `createServerPluginContext` has already vetted it (own edit
 * claim, module path confined to the plugin package) and stores the resolved
 * ABSOLUTE module path here. The server's `POST /api/file/write-binary` looks a
 * validator up per request and runs it in a bounded worker pool. A validator can
 * only reject a save; it can never admit what core refuses.
 *
 * Singleton (`getFileValidatorRegistry`), like the WS route registry: the
 * context factory and the route must see ONE registry without threading it
 * through every call site. Keyed `<pluginId>/<claimId>`; a second registration
 * for the same claim replaces the first.
 */

export interface FileValidatorRegistration {
  pluginId: string;
  claimId: string;
  /** Absolute, realpath-confined path of the validator module (exports `validate(bytes, ext)`). */
  modulePath: string;
  /**
   * Main-thread predicate evaluated before anything else for this claim. `false`
   * refuses the save (403), so a plugin can switch off a sub-feature without a
   * restart. Absent = always enabled.
   */
  enabled?: () => boolean;
}

export class FileValidatorRegistry {
  private byClaim = new Map<string, FileValidatorRegistration>();

  private key(pluginId: string, claimId: string): string {
    return `${pluginId}/${claimId}`;
  }

  register(reg: FileValidatorRegistration): void {
    this.byClaim.set(this.key(reg.pluginId, reg.claimId), reg);
  }

  get(pluginId: string, claimId: string): FileValidatorRegistration | undefined {
    return this.byClaim.get(this.key(pluginId, claimId));
  }

  /** Drop every validator a plugin registered (activation failure / teardown). */
  unregisterPlugin(pluginId: string): void {
    for (const [k, v] of this.byClaim) if (v.pluginId === pluginId) this.byClaim.delete(k);
  }
}

let _registry: FileValidatorRegistry | null = null;

/** Process-wide registry (context factory + write-binary route). */
export function getFileValidatorRegistry(): FileValidatorRegistry {
  if (!_registry) _registry = new FileValidatorRegistry();
  return _registry;
}

/** Reset the singleton (tests). */
export function clearFileValidatorRegistry(): void {
  _registry = null;
}
