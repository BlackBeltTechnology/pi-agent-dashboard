/**
 * Real-host harness of the mail card tests: the REAL shell reducer builds the chat row
 * from a `pi.sendMessage` custom message (`message_end`, role `custom`), the REAL
 * `CustomEntryRow` resolves the plugin claim (or the generic fallback card) and
 * mounts it inside the real `ErrorBoundary` / `Suspense`. Loaded by path (a static
 * cross-package import would break this package's tsc rootDir).
 * See change: add-agent-teams-ui.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { DISPLAY_PRESETS, type DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { render } from "@testing-library/react";
import type { ComponentType, ReactElement } from "react";
import { vi } from "vitest";
import { CUSTOM_TYPE_IDLE, CUSTOM_TYPE_MAIL, CUSTOM_TYPE_NOTICE } from "../../shared/mail-format.js";
import { MailEntryCard } from "../MailEntryCard.js";

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../client/src");

export interface ChatRow {
  id: string;
  role: string;
  content?: string;
  customType?: string;
  timestamp: number;
  [k: string]: unknown;
}
interface ReducerModule {
  createInitialState(): unknown;
  reduceEvent(state: unknown, event: unknown): { messages: ChatRow[] };
}
const reducer = (await import(/* @vite-ignore */ path.join(CLIENT, "lib/chat/event-reducer.ts"))) as ReducerModule;
const rowMod = (await import(/* @vite-ignore */ path.join(CLIENT, "components/chat/CustomEntryRow.tsx"))) as { CustomEntryRow: ComponentType<{ msg: ChatRow; sessionId?: string }> };
const prefsMod = (await import(/* @vite-ignore */ path.join(CLIENT, "lib/state/DisplayPrefsContext.tsx"))) as { DisplayPrefsProvider: ComponentType<{ value: unknown; children: ReactElement }> };
const themeMod = (await import(/* @vite-ignore */ path.join(CLIENT, "components/settings/ThemeProvider.tsx"))) as { ThemeProvider: ComponentType<{ children: ReactElement }> };

export type ReducerState = { messages: ChatRow[] };

/** Reduce one `pi.sendMessage` custom message onto `state` (a fresh state when omitted). */
export function reduceCustom(content: string, customType: string = CUSTOM_TYPE_MAIL, state?: unknown, timestamp = 1): ReducerState {
  return reducer.reduceEvent(state ?? reducer.createInitialState(), {
    eventType: "message_end",
    timestamp,
    data: { message: { role: "custom", customType, content, display: true } },
  });
}

/** The single custom row the reducer builds for `content`. */
export function rowOf(content: string, customType: string = CUSTOM_TYPE_MAIL): ChatRow {
  const row = reduceCustom(content, customType).messages.find((m) => m.role === "custom");
  if (!row) throw new Error("the reducer built no custom row");
  return row;
}

export function teamRegistry(Component: ComponentType<never> = MailEntryCard as never) {
  const registry = createSlotRegistry();
  for (const customType of [CUSTOM_TYPE_MAIL, CUSTOM_TYPE_IDLE, CUSTOM_TYPE_NOTICE]) registry.addClaim({ pluginId: "agent-teams", priority: 100, slot: "custom-entry-renderer", customType, Component } as never);
  return registry;
}

export function hostRows(rows: ChatRow[], opts: { registry?: ReturnType<typeof createSlotRegistry>; prefs?: DisplayPrefs; hide?: Partial<DisplayPrefs> } = {}) {
  if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  }
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => undefined;
  const { CustomEntryRow } = rowMod;
  const { DisplayPrefsProvider } = prefsMod;
  const { ThemeProvider } = themeMod;
  const tree = (
    <PluginContextProvider registry={opts.registry ?? teamRegistry()}>
      <ThemeProvider>
        <DisplayPrefsProvider value={{ global: opts.prefs ?? DISPLAY_PRESETS.standard, getSessionOverride: () => opts.hide }}>
          <div>
            {rows.map((row) => (
              <CustomEntryRow key={row.id} msg={row} sessionId="S-lead" />
            ))}
          </div>
        </DisplayPrefsProvider>
      </ThemeProvider>
    </PluginContextProvider>
  );
  return render(tree);
}

/** Render one body through reducer → host row → plugin card. */
export const hostRow = (content: string, customType: string = CUSTOM_TYPE_MAIL, opts: Parameters<typeof hostRows>[1] = {}) => hostRows([rowOf(content, customType)], opts);
