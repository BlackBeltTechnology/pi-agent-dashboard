/**
 * Per-target write serialization shared by `POST /api/file/write` and
 * `POST /api/file/write-binary`.
 *
 * The conflict check + atomic rename must run as one critical section per file,
 * else two concurrent writes can both pass the check and the later rename
 * clobbers the earlier write instead of returning 409. The key is the target's
 * REALPATH (`lockKeyFor`), so a symlink alias and its real file share one lock.
 * The chain swallows errors so one failed write does not poison the next.
 *
 * See change: directory-settings-page-and-scoped-md-editing,
 * add-editor-pane-file-handlers.
 */
import fs from "node:fs/promises";

const fileWriteLocks = new Map<string, Promise<unknown>>();

export function serializeWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (fileWriteLocks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.then(
    () => {},
    () => {},
  );
  fileWriteLocks.set(key, tail);
  tail
    .then(() => {
      if (fileWriteLocks.get(key) === tail) fileWriteLocks.delete(key);
    })
    .catch(() => {});
  return run;
}

/** Lock key for `target`: its realpath, or `target` itself when it does not exist (yet). */
export async function lockKeyFor(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}
