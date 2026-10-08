/**
 * OpenSpecMapContext — the per-cwd `openspecMap` (kept in App state by
 * `useMessageHandler`) exposed to attachment resolution so any session surface
 * can resolve `attachedProposal` without prop-drilling the whole map.
 * Absent provider → empty map (every attachment resolves `unresolved`, i.e. the
 * bare layout, unless the caller passes a `changes` fallback).
 * See change: resolve-archived-attached-proposal.
 */
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createContext, useContext } from "react";

const EMPTY: ReadonlyMap<string, OpenSpecData> = new Map();

export const OpenSpecMapContext = createContext<ReadonlyMap<string, OpenSpecData>>(EMPTY);

export function useOpenSpecMap(): ReadonlyMap<string, OpenSpecData> {
  return useContext(OpenSpecMapContext);
}
