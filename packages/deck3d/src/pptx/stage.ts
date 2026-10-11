/**
 * Atomic output staging (design D1 `stage.ts`): every output is written into
 * a sibling temp directory and moved into place only after all of it was
 * written. A failure before the commit removes the staging dir and leaves the
 * target exactly as it was.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Write hook — tests inject a failing writer to prove atomicity. */
export type WriteFn = (path: string, data: Uint8Array | string) => void;
/** Rename hook — tests inject a failing rename to prove the commit rolls back. */
export type RenameFn = (from: string, to: string) => void;

export const defaultWrite: WriteFn = (path, data) => writeFileSync(path, data);

export class Stage {
  readonly dir: string;

  constructor(
    readonly target: string,
    private readonly write: WriteFn = defaultWrite,
    private readonly rename: RenameFn = renameSync,
  ) {
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    this.dir = mkdtempSync(join(parent, `.${basename(target)}.deck3d-import-`));
  }

  file(rel: string, data: Uint8Array | string): void {
    const path = join(this.dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    this.write(path, data);
  }

  discard(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  /**
   * Move the staged top-level entries into `target`. A fresh target is ONE
   * rename. For an existing deck each replaced entry is first renamed aside
   * (inside the staging dir); if ANY rename fails, every entry already
   * swapped is put back, so a failed re-import leaves the deck exactly as it
   * was. The staging dir (with the asides) is removed on every path.
   */
  commit(entries: string[]): void {
    if (!existsSync(this.target)) {
      this.rename(this.dir, this.target);
      return;
    }
    const swapped: Array<{ to: string; aside?: string }> = [];
    try {
      for (const name of entries) {
        const from = join(this.dir, name);
        if (!existsSync(from)) continue;
        const to = join(this.target, name);
        const aside = existsSync(to) ? join(this.dir, `${name}.old`) : undefined;
        if (aside) this.rename(to, aside);
        swapped.push({ to, aside });
        this.rename(from, to);
      }
    } catch (err) {
      // Roll back with the real fs calls: the injected one may keep failing.
      for (const { to, aside } of swapped.reverse()) {
        if (aside) {
          rmSync(to, { recursive: true, force: true });
          renameSync(aside, to);
        } else rmSync(to, { recursive: true, force: true });
      }
      throw err;
    } finally {
      this.discard();
    }
  }
}
