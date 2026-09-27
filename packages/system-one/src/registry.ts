/**
 * Consumer self-registration (design D8). One file per consumer:
 * `~/.pi/agent/system-one/consumers/<sha256(id)>.json` (0600, atomic). Written
 * at most once per id per process for an unchanged declaration; a changed
 * declaration rewrites it. Write failures never fail `predict`.
 * See change: add-system-one-registry.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { onReset } from "./config.js";
import { atomicWrite0600 } from "./fs-util.js";
import { consumersDir } from "./paths.js";
import type { ConsumerDeclaration } from "./types.js";

export const CONSUMER_ID = /^[a-z0-9][a-z0-9:._-]{0,127}$/;

const written = new Map<string, string>();
onReset(() => written.clear());

export const consumerFile = (id: string): string =>
  join(consumersDir(), `${createHash("sha256").update(id).digest("hex")}.json`);

function canonical(d: ConsumerDeclaration): string {
  return JSON.stringify({
    id: d.id,
    label: d.label ?? null,
    failurePolicy: d.failurePolicy,
    requires: d.requires ?? null,
    fixtures: d.fixtures ?? null,
  });
}

export function registerConsumer(d: ConsumerDeclaration): void {
  const key = canonical(d);
  if (written.get(d.id) === key) return;
  written.set(d.id, key);
  try {
    const record = { ...JSON.parse(key), lastSeen: new Date().toISOString() };
    atomicWrite0600(consumerFile(d.id), `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // best effort; the next process retries
  }
}
