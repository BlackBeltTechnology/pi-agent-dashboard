// Types for credential-key-worker.mjs (plain ESM, no TS in the worker itself).
export interface KeychainJob {
  op: "read" | "create";
  service: string;
  account: string;
}
export interface KeychainEntryLike {
  getPassword(): string | null | undefined;
  setPassword(password: string): void;
}
export type EntryFactory = (service: string, account: string, options?: unknown) => KeychainEntryLike;
export declare const ENTRY_OPTIONS: { readonly linux: { readonly store: "secret-service" } };
export declare function deepestCauseMessage(err: unknown): string;
export declare function shortenDetail(text: unknown): string;
export declare function runKeychainJob(job: KeychainJob, entryFactory: EntryFactory): Promise<{ value: string | null; created: boolean }>;
export declare function loadEntryFactory(): Promise<EntryFactory>;
