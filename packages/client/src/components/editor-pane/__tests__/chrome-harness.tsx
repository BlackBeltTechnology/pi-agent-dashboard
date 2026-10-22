/**
 * Shared harness for the pane-chrome tests (pane bar, document bar, rail Search,
 * bulk close, Search tabs). Seeds persisted pane state, stubs `/api/health`,
 * the viewer, the terminal view and `ResizeObserver`.
 * See change: scope-anchor-editor-pane-controls.
 */
import {
  createSlotRegistry,
  PluginContextProvider,
  ShellSessionsProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { EDITOR_PANE_KEY_PREFIX, type OpenFile } from "../../../lib/layout/editor-pane-state.js";
import { TREE_VISIBLE_KEY_PREFIX } from "../../../lib/util/tree-visible.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";
import { createFileHandlerStore, type FileHandlerStore } from "../file-handler/file-handler-store.js";
import { FileHandlerStoreProvider } from "../file-handler/use-file-handler-store.js";

/** Per-file in-memory `localStorage` (the shared file-backed one races other workers). */
export function installMemoryStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  });
}

const PREFIX_VIEWER: Record<string, OpenFile["viewer"]> = {
  "term:": "terminal",
  "url:": "url",
  "diff:": "diff",
  "live:": "live-server",
  "browser:": "plugin",
};
const EXT_VIEWER: Record<string, OpenFile["viewer"]> = { pdf: "pdf", docx: "docx" };

/** A seeded tab. Viewer defaults from the path. */
export function tab(path: string, extra: Partial<OpenFile> = {}): OpenFile {
  const prefix = Object.keys(PREFIX_VIEWER).find((p) => path.startsWith(p));
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : "";
  const viewer = (prefix ? PREFIX_VIEWER[prefix] : EXT_VIEWER[ext]) ?? "monaco";
  return { path, viewer, addedAt: 1, ...extra };
}

export function seedPane(sessionId: string, openFiles: OpenFile[], activeIndex = 0, treeOpenRoots: string[] = []): void {
  localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}${sessionId}`, JSON.stringify({ openFiles, activeIndex, treeOpenRoots }));
}

export const readPane = (sessionId: string) =>
  JSON.parse(localStorage.getItem(`${EDITOR_PANE_KEY_PREFIX}${sessionId}`) ?? "null") as {
    openFiles: OpenFile[];
    activeIndex: number;
    treeOpenRoots: string[];
  };

export const treeVisibleKey = (sessionId: string) => `${TREE_VISIBLE_KEY_PREFIX}${sessionId}`;

/** `/api/health` + defaults for every other request. */
export function stubFetch(health: unknown = { capabilities: { systemOpen: false } }) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), "http://x");
    calls.push(u.pathname + u.search);
    if (u.pathname === "/api/health") return new Response(JSON.stringify(health));
    return new Response(JSON.stringify({ success: true, data: { entries: [] } }));
  });
  globalThis.fetch = impl as unknown as typeof fetch;
  return { calls, impl };
}

/** Controllable `ResizeObserver`: `setWidth` fires every live observer. */
export function stubResizeObserver() {
  const live = new Set<{ cb: ResizeObserverCallback }>();
  class FakeRO {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe() {
      live.add(this);
    }
    unobserve() {}
    disconnect() {
      live.delete(this);
    }
  }
  vi.stubGlobal("ResizeObserver", FakeRO);
  return {
    setWidth(width: number) {
      act(() => {
        for (const o of live) o.cb([{ contentRect: { width } } as ResizeObserverEntry], o as unknown as ResizeObserver);
      });
    },
  };
}

export interface MountOpts {
  sessionId?: string;
  cwd?: string;
  /** `session` (file search + change detection) or `folder` (neither). */
  kind?: "session" | "folder";
  terminals?: Array<{ id: string; title?: string }>;
  onKillTerminal?: (id: string) => void;
  onCreateTerminal?: (cwd: string) => void;
  registry?: ReturnType<typeof createSlotRegistry>;
  store?: FileHandlerStore;
  onFilenameSearch?: (q: string, regex: boolean) => void;
  /** Rendered next to the pane inside the provider (probes). */
  extra?: React.ReactNode;
}

export function tree(o: MountOpts = {}) {
  const sessionId = o.sessionId ?? "s1";
  const store = o.store ?? createFileHandlerStore();
  const session = (o.kind ?? "session") === "session";
  return (
    <PluginContextProvider registry={o.registry ?? createSlotRegistry()}>
      <ShellSessionsProvider
        value={new Map([[sessionId, { id: sessionId, cwd: o.cwd ?? "/proj", source: "tui", status: "active", startedAt: 0 } as DashboardSession]])}
      >
      <FileHandlerStoreProvider value={store}>
        <SplitWorkspaceProvider
          sessionId={sessionId}
          cwd={o.cwd ?? "/proj"}
          orientation="h"
          changeDetection={session}
          onFilenameSearch={session ? (o.onFilenameSearch ?? vi.fn()) : undefined}
          terminals={
            (o.terminals ?? []).map((t) => ({
              id: t.id,
              cwd: o.cwd ?? "/proj",
              shell: "/bin/zsh",
              title: t.title,
              status: "active",
              createdAt: 1,
            })) as never
          }
          onKillTerminal={o.onKillTerminal}
          onCreateTerminal={o.onCreateTerminal}
        >
          <EditorPane />
          {o.extra}
        </SplitWorkspaceProvider>
      </FileHandlerStoreProvider>
      </ShellSessionsProvider>
    </PluginContextProvider>
  );
}

export function mount(o: MountOpts = {}) {
  return render(tree(o));
}
