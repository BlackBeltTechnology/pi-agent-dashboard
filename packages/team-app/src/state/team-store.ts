/**
 * Per-host shared data (identity profile + projects), read by BOTH the app and
 * its `HeaderContext` (which a host may render outside the app tree).
 * See change: add-team-plugin (D10/D16).
 */
import { NoCredentialError, NotAdmittedError } from "@blackbelt-technology/pi-dashboard-app-kit";
import { type AppHost, useAppHost, useOptionalIdentity } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ApiError, createApi, type TeamApi } from "../api/client.js";
import type { Me, ProjectInfo, Target } from "../api/types.js";
import { resolveStartTarget, targetStore, useStoredTarget } from "./target-store.js";

type TeamStatus = "loading" | "ready" | "error" | "unauthorized" | "not-admitted";

interface TeamState {
  status: TeamStatus;
  me?: Me;
  projects: ProjectInfo[];
}

export interface TeamStore {
  api: TeamApi;
  getState(): TeamState;
  subscribe(cb: () => void): () => void;
  refresh(): Promise<void>;
}

function classify(err: unknown): TeamStatus {
  if (err instanceof NoCredentialError) return "unauthorized";
  if (err instanceof NotAdmittedError) return "not-admitted";
  if (err instanceof ApiError) {
    if (err.status === 401) return "unauthorized";
    if (err.status === 403) return "not-admitted";
  }
  return "error";
}

const stores = new WeakMap<object, TeamStore>();

function getTeamStore(host: Pick<AppHost, "api">): TeamStore {
  let s = stores.get(host);
  if (s) return s;
  const api = createApi(host);
  let state: TeamState = { status: "loading", projects: [] };
  const listeners = new Set<() => void>();
  let inflight: Promise<void> | null = null;
  const set = (next: TeamState) => {
    state = next;
    for (const l of listeners) l();
  };
  s = {
    api,
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    refresh() {
      inflight ??= (async () => {
        try {
          const [me, projects] = await Promise.all([api.me(), api.projects()]);
          set({ status: "ready", me, projects });
        } catch (err) {
          set({ status: classify(err), projects: state.projects, me: state.me });
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
  };
  stores.set(host, s);
  return s;
}

export function useTeam() {
  const host = useAppHost();
  const store = useMemo(() => getTeamStore(host), [host]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const stored = useStoredTarget();
  // Embedded hosts have no identity context (already signed in). Standalone: never touch the
  // team API before the identity layer says a credential exists (or none is needed).
  const identity = useOptionalIdentity();
  const authed = !identity || identity.authenticated;
  useEffect(() => {
    if (!authed) return;
    const s = store.getState().status;
    if (s === "loading" || s === "unauthorized") void store.refresh();
  }, [store, authed]);
  const target: Target = resolveStartTarget(stored, state.projects);
  return {
    host,
    api: store.api,
    state,
    refresh: store.refresh,
    target,
    setTarget: (t: Target) => targetStore.set(t),
  };
}
