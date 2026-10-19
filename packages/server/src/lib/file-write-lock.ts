/**
 * Per-target write serialization shared by `POST /api/file/write` (text) and
 * `POST /api/file/write-binary` (plugin handlers). The hash/mtime check +
 * atomic rename must run as one critical section per file; keyed by the
 * target's REALPATH so a symlink alias cannot run two writes to one file
 * concurrently. The chain swallows errors so one failed write does not poison
 * the next. See changes: directory-settings-page-and-scoped-md-editing,
 * add-editor-pane-file-handlers (D4).
 */
const fileWriteLocks = new Map<string, Promise<unknown>>();

export function serializeWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (fileWriteLocks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.then(
    () => {},
    () => {},
  );
  fileWriteLocks.set(key, tail);
  void tail.then(() => {
    if (fileWriteLocks.get(key) === tail) fileWriteLocks.delete(key);
  });
  return run;
}
