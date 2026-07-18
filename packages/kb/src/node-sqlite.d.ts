// Ambient shim for the Node built-in `node:sqlite` module.
//
// `node:sqlite` is experimental; its typings (`sqlite.d.ts`) ship in
// `@types/node` >= 22.5. This repo pins `@types/node` 20.x, which has no such
// declaration, so `tsc` (the root `npm run lint` AND `packages/kb`'s own build)
// fails `TS2307: Cannot find module 'node:sqlite'`. This declares ONLY the
// surface `sqlite-store.ts` uses so the module resolves without a dependency
// bump. Delete this file when `@types/node` is bumped to >= 22.5.
//
// See change: adopt-pi-074-080-features (CI-unblock for the pre-existing
// develop `node:sqlite` lint failure).
declare module "node:sqlite" {
  export interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    iterate(...params: unknown[]): IterableIterator<unknown>;
  }
  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    allowExtension?: boolean;
  }
  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    open(): void;
    close(): void;
  }
}
