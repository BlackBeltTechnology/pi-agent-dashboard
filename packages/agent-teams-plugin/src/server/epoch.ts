/**
 * Server epoch: a random id minted once per server start (per plugin enable). A
 * changed epoch tells every open Team view that `rev` restarted, so it refetches;
 * it is also the first half of the snapshot ETag (`"<epoch>:<rev>"`).
 * See change: add-agent-teams-ui.
 */
import { randomBytes } from "node:crypto";

export function mintEpoch(): string {
  return randomBytes(8).toString("hex");
}

/** Used by `mountTeamsRoutes` when no epoch is injected (one per process). */
export const PROCESS_EPOCH: string = mintEpoch();
