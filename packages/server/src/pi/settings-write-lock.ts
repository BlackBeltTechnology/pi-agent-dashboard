/**
 * Per-key async write mutex shared by every route that read-modify-writes the
 * same file. Extracted from `resource-activation-routes.ts` (behaviour
 * preserving) so the Add-ons hub toggle and the plugin toggle serialise with
 * it. Keys are file paths for settings files, or a stable name (`plugin-config`).
 *
 * Not re-entrant: never take the same key from inside its own task.
 * See change: addons-hub-feature-catalog (design D5).
 */
const locks = new Map<string, Promise<unknown>>();

/** Run `task` after every earlier task for `key` settled (failures included). */
export function withSettingsWriteLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.then(
    () => {},
    () => {},
  );
  locks.set(key, tail);
  tail
    .then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    })
    .catch(() => {});
  return run;
}

/** Lock key for the dashboard plugin config (`~/.pi/dashboard/config.json`). */
export const PLUGIN_CONFIG_LOCK_KEY = "plugin-config";

/** Lock key queueing hub toggles among themselves, outermost of the three. */
export const ADDONS_HUB_LOCK_KEY = "addons-hub-toggle";
