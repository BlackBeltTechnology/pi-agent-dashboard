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

export const defaultWrite: WriteFn = (path, data) => writeFileSync(path, data);

export class Stage {
  readonly dir: string;

  constructor(
    readonly target: string,
    private readonly write: WriteFn = defaultWrite,
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
   * Move the staged top-level entries into `target`. A replaced directory is
   * renamed aside first and removed only after the new one is in place.
   */
  commit(entries: string[]): void {
    if (!existsSync(this.target)) {
      renameSync(this.dir, this.target);
      return;
    }
    try {
      for (const name of entries) {
        const from = join(this.dir, name);
        if (!existsSync(from)) continue;
        const to = join(this.target, name);
        if (existsSync(to)) {
          // Aside INSIDE the staging dir, so `discard` removes it.
          renameSync(to, join(this.dir, `${name}.old`));
        }
        renameSync(from, to);
      }
    } finally {
      this.discard();
    }
  }
}
