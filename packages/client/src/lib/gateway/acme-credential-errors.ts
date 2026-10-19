/**
 * Credential-write errors of ACME sources, kept per source id so the group can show them.
 *
 * A new source is saved from the "Add domain certificate" editor, but a failed
 * credentials write after a successful entry write is shown by the source's GROUP
 * (the source stays saved; the group shows the credentials gate plus the error). The
 * two components do not share a parent that owns the state, so the message — never a
 * secret — lives in this tiny store. Cleared on a successful credentials write, a
 * removal, and when the group dismisses it.
 *
 * See change: add-acme-dns01-certs (design D11).
 */
import { useSyncExternalStore } from "react";

const errors = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

const emit = (): void => {
  version += 1;
  for (const l of listeners) l();
};

export function setAcmeCredentialError(sourceId: string, message: string): void {
  errors.set(sourceId, message);
  emit();
}

export function clearAcmeCredentialError(sourceId: string): void {
  if (errors.delete(sourceId)) emit();
}

/** The last credentials-write error of `sourceId`, or `null`. */
export function useAcmeCredentialError(sourceId: string): string | null {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  return errors.get(sourceId) ?? null;
}
