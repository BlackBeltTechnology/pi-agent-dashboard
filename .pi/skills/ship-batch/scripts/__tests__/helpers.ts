import { newItem, setState } from "../scheduler.ts";
import type { BatchState, Item, ItemState, Observations, Params, SessionObs } from "../types.ts";

export const T0 = 1_700_000_000_000;

export const PARAMS: Params = {
  parallel: 2,
  maxLive: 4,
  nudges: 1,
  settleMs: 30_000,
  startTimeoutMs: 300_000,
  model: "@coding",
};

export function mkState(
  spec: Record<string, ItemState | (Partial<Item> & { state: ItemState })>,
  params: Partial<Params> = {},
): BatchState {
  const items = Object.entries(spec).map(([change, v]) => {
    const o = typeof v === "string" ? { state: v } : v;
    const item = newItem(change, T0);
    setState(item, o.state, T0);
    Object.assign(item, { ...o, state: o.state });
    return item;
  });
  return {
    version: 1,
    groupId: "g",
    groupName: "G",
    repo: "/repo",
    params: { ...PARAMS, ...params },
    planArchive: [],
    items,
    alreadyShipped: [],
    createdAt: T0,
    updatedAt: T0,
    notes: [],
  };
}

export const item = (s: BatchState, change: string): Item => s.items.find((i) => i.change === change) as Item;

export function mkObs(over: Partial<Omit<Observations, "sessions">> & { sessions?: Record<string, Partial<SessionObs>> } = {}): Observations {
  const sessions: Record<string, SessionObs> = {};
  for (const [id, s] of Object.entries(over.sessions ?? {})) {
    sessions[id] = { id, cwd: `/repo/.worktrees/os-${id}`, status: "idle", startedAt: T0, ...s };
  }
  const { sessions: _ignored, ...rest } = over;
  return {
    connected: true,
    connectedSince: T0 - 3_600_000,
    questions: new Set(),
    archived: new Set(),
    ...rest,
    sessions,
  };
}
