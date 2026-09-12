/**
 * L1 component tests for the three states (test-plan E22, E23, X1/X3-shaped
 * client behaviour) plus the apply-semantics copy rules (F7).
 *
 * The rendered-in-a-browser versions of the state assertions live in the L3
 * Playwright spec; these cover the same branches at component level so a
 * regression is caught without the docker harness.
 *
 * See change: add-blackhole-plugin.
 */
import {
  type RegisteredSource,
  SettingsDraftProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type {
  UiConfirmDialogProps,
  UiModelSelectorProps,
  UiThinkingLevelSelectorProps,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, KNOWN_KEYS, validateBlackholeConfig } from "../../shared/blackhole-config.js";
import { BlackholeSettings, buildPayload, toDraft } from "../BlackholeSettings.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function MockModelSelector(props: UiModelSelectorProps) {
  return (
    <div data-testid="mock-model-selector" data-current={props.current}>
      <button data-testid="mock-model-trigger">{props.current ?? "select model"}</button>
      {(props.models ?? []).map((m) => {
        const label = `${m.provider}/${m.id}`;
        return (
          <button
            key={label}
            data-testid={`model-opt-${label}`}
            onClick={() => props.onSelect(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MockThinkingLevelSelector(props: UiThinkingLevelSelectorProps) {
  return (
    <div data-testid="mock-thinking-level-selector" data-current={props.current}>
      {(props.supportedLevels ?? []).map((lvl) => (
        <button key={lvl} data-testid={`level-opt-${lvl}`} onClick={() => props.onSelect(lvl)}>
          {lvl}
        </button>
      ))}
    </div>
  );
}

function MockConfirmDialog(props: UiConfirmDialogProps) {
  return (
    <div data-testid="mock-confirm-dialog">
      <p data-testid="confirm-dialog-message">{props.message}</p>
      <button data-testid="confirm-dialog-confirm" onClick={props.onConfirm}>
        {props.confirmLabel ?? "Confirm"}
      </button>
      <button data-testid="confirm-dialog-cancel" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}

function renderSettings(sources?: Map<string, RegisteredSource>) {
  const draftRegistry = {
    upsert: (id: string, s: RegisteredSource) => {
      sources?.set(id, s);
    },
    remove: (id: string) => {
      sources?.delete(id);
    },
  };

  return render(
    withUiPrimitiveProvider(
      {
        [UI_PRIMITIVE_KEYS.modelSelector]: MockModelSelector,
        [UI_PRIMITIVE_KEYS.thinkingLevelSelector]: MockThinkingLevelSelector,
        [UI_PRIMITIVE_KEYS.confirmDialog]: MockConfirmDialog,
      },
      <SettingsDraftProvider registry={draftRegistry}>
        <BlackholeSettings />
      </SettingsDraftProvider>,
    ),
  );
}

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: "",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

function allDefaultConfig(over: Record<string, unknown> = {}) {
  const fields: Record<string, { value: unknown; default: unknown; isDefault: boolean }> = {};
  for (const key of KNOWN_KEYS) {
    const def = (DEFAULTS as Record<string, unknown>)[key];
    const has = Object.hasOwn(over, key);
    fields[key] = { value: has ? over[key] : def, default: def, isDefault: !has };
  }
  return {
    status: "ok",
    filePath: "/tmp/agent/pi-blackhole/pi-blackhole-config.json",
    exists: false,
    unmanagedKeys: [],
    fields,
  };
}

/** Wire `fetch` for the endpoints the component reads (config + status). */
function handleConfigRoute(
  opts: {
    config?: unknown;
    configStatus?: number;
    putStatus?: number;
    putBody?: unknown;
    onPut?: (body: Record<string, unknown>) => void;
  },
  init?: RequestInit,
): Response {
  if (init?.method === "PUT") {
    const body = JSON.parse(init.body as string);
    opts.onPut?.(body);
    const status = opts.putStatus ?? 200;
    return jsonRes(opts.putBody ?? allDefaultConfig(), status < 400, status);
  }
  const status = opts.configStatus ?? 200;
  return jsonRes(opts.config ?? allDefaultConfig(), status < 400, status);
}

function mockFetch(opts: {
  installed?: boolean;
  config?: unknown;
  configStatus?: number;
  models?: unknown;
  modelsStatus?: number;
  onPut?: (body: Record<string, unknown>) => void;
  putStatus?: number;
  putBody?: unknown;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/plugins/blackhole/config")) {
      return handleConfigRoute(opts, init);
    }
    if (url.includes("/api/plugins/blackhole/status")) {
      return jsonRes({ installed: opts.installed ?? true });
    }
    if (url.includes("/api/models")) {
      const status = opts.modelsStatus ?? 200;
      return jsonRes(opts.models ?? { object: "list", data: [] }, status < 400, status);
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
}

describe("not-installed state (E23, F6)", () => {
  it("renders the install command and no config control when the registry reports it missing", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ installed: false });
    const { getByTestId, container } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-not-installed")).toBeTruthy());
    expect(getByTestId("blackhole-install-command").textContent).toBe("pi install npm:pi-blackhole");
    expect(container.querySelectorAll("input, select, textarea").length).toBe(0);
  });

  it("is produced by this component, not by the host declining to mount it", async () => {
    // The component is mounted unconditionally; the not-installed branch is its
    // own output. If the host had withheld it, nothing would render at all.
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ installed: false });
    const { getByTestId } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-not-installed")).toBeTruthy());
  });

  it("answers from the plugin's own /status route, not the host plugin list (repoint, 3.1a)", async () => {
    const fetchMock = mockFetch({ installed: false });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-not-installed")).toBeTruthy());
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/plugins/blackhole/status"))).toBe(true);
    expect(urls.every((u) => !u.includes("/api/plugins\"") && !u.endsWith("/api/plugins"))).toBe(true);
  });
});

describe("installed but never run (E22)", () => {
  it("renders the defaults form rather than the not-installed state", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ installed: true });
    const { getByTestId, queryByTestId } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());
    expect(queryByTestId("blackhole-not-installed")).toBeNull();
    expect((getByTestId("blackhole-input-observeAfterTokens") as HTMLInputElement).value).toBe("15000");
    expect(getByTestId("blackhole-default-badge-observeAfterTokens")).toBeTruthy();
  });

  it("does not fabricate a not-installed state when the probe has not reported yet", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string) => {
      if (url.includes("/config")) return jsonRes(allDefaultConfig());
      if (url.includes("/status")) return jsonRes({ installed: true });
      if (url.includes("/api/models")) return jsonRes({ object: "list", data: [] });
      return jsonRes({ plugins: [{ id: "blackhole", status: null }] });
    });
    const { getByTestId, queryByTestId } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());
    expect(queryByTestId("blackhole-not-installed")).toBeNull();
  });
});

describe("parse-error state renders no form (X1, X3)", () => {
  it("shows the error, the path and recovery actions, with a disabled save control", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      configStatus: 409,
      config: {
        status: "parse-error",
        filePath: "/tmp/agent/pi-blackhole/pi-blackhole-config.json",
        message: "Unexpected token } in JSON at position 34",
      },
    });
    const { getByTestId, container } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-parse-error")).toBeTruthy());

    expect(getByTestId("blackhole-parse-message").textContent).toContain("Unexpected token");
    expect(getByTestId("blackhole-file-path").textContent).toContain("pi-blackhole-config.json");
    expect(getByTestId("blackhole-recheck")).toBeTruthy();
    expect((getByTestId("blackhole-save-blocked") as HTMLButtonElement).disabled).toBe(true);
    // No config control of any kind — not even a defaults-populated one.
    expect(container.querySelectorAll("input, select, textarea").length).toBe(0);
  });
});

describe("apply semantics (F7)", () => {
  it("never demands a restart and attributes immediate apply to the extension", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({ installed: true });
    const { getByTestId } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    const page = (getByTestId("blackhole-settings") as HTMLElement).textContent ?? "";
    expect(page).not.toMatch(/restart/i);
    const note = getByTestId("blackhole-apply-note").textContent ?? "";
    expect(note).toMatch(/pi-blackhole re-reads this file/i);
  });
});

describe("the save payload does not materialise untouched defaults", () => {
  /**
   * Writing every default into the user's file would PIN values the file had
   * deliberately left absent, so a later change to blackhole's own default
   * would stop reaching this user. Only file-set or user-edited keys go out.
   */
  it("emits NOTHING for a file that set nothing and a user who edited nothing", () => {
    expect(buildPayload(toDraft(allDefaultConfig() as never))).toEqual({});
  });

  it("emits only the keys the FILE set", () => {
    const payload = buildPayload(toDraft(allDefaultConfig({ compaction: "manual" }) as never));
    expect(payload).toEqual({ compaction: "manual" });
  });

  it("emits only the EDITED key when the file set nothing", () => {
    const draft = toDraft(allDefaultConfig() as never);
    const edited = { ...draft, values: { ...draft.values, compactAfterTokens: 90_000 } };
    expect(buildPayload(edited)).toEqual({ compactAfterTokens: 90_000 });
  });

  it("never emits a default the user did not touch alongside an edit", () => {
    const draft = toDraft(allDefaultConfig() as never);
    const edited = { ...draft, values: { ...draft.values, compactAfterTokens: 90_000 } };
    const payload = buildPayload(edited);
    expect(Object.hasOwn(payload, "observeAfterTokens")).toBe(false);
    expect(Object.hasOwn(payload, "memory")).toBe(false);
    expect(Object.hasOwn(payload, "observerModel")).toBe(false);
  });

  it("round-trips a file-set chain unchanged and emits it on save", () => {
    const cfg = allDefaultConfig({
      observerModel: { provider: "openrouter", id: "A" },
      observerFallbackModels: [{ provider: "ollama", id: "B" }],
    });
    const payload = buildPayload(toDraft(cfg as never));
    expect(payload.observerModel).toEqual({ provider: "openrouter", id: "A" });
    expect(payload.observerFallbackModels).toEqual([{ provider: "ollama", id: "B" }]);
  });

  it("produces a payload the server validator accepts", () => {
    const draft = toDraft(allDefaultConfig({ compaction: "manual" }) as never);
    const edited = { ...draft, values: { ...draft.values, compactAfterTokens: 90_000 } };
    expect(validateBlackholeConfig(buildPayload(edited)).errors).toEqual([]);
  });
});

describe("chains render from the config (E18)", () => {
  it("renders primary then fallbacks in array order", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      config: allDefaultConfig({
        observerModel: { provider: "openrouter", id: "A" },
        observerFallbackModels: [
          { provider: "ollama", id: "B" },
          { provider: "cerebras", id: "C" },
        ],
      }),
    });
    const { getByTestId } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-chain-observer")).toBeTruthy());
    expect(getByTestId("blackhole-chain-observer-entry-0").textContent).toContain("A");
    expect(getByTestId("blackhole-chain-observer-entry-1").textContent).toContain("B");
    expect(getByTestId("blackhole-chain-observer-entry-2").textContent).toContain("C");
  });
});

describe("Base model and recommended defaults (4.1-4.10)", () => {
  it("4.1 base model set: sets model in PUT, updates every tail before save (E14)", async () => {
    let putBody: any = null;
    const sources = new Map<string, RegisteredSource>();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      models: {
        object: "list",
        data: [{ id: "g/x-flash", provider: "g", reasoning: true }],
      },
      onPut: (body) => {
        putBody = body;
      },
    });

    const { getByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    // Base model card should have model selector
    const baseCard = getByTestId("blackhole-base-model-card");
    fireEvent.click(within(baseCard).getByTestId("model-opt-g/x-flash"));

    // Check every tail contains x-flash before Save
    expect(getByTestId("blackhole-chain-observer-tail-base").textContent).toContain("x-flash");
    expect(getByTestId("blackhole-chain-reflector-tail-base").textContent).toContain("x-flash");
    expect(getByTestId("blackhole-chain-dropper-tail-base").textContent).toContain("x-flash");

    // Commit draft
    await act(async () => {
      await sources.get("plugin:blackhole")?.commit();
    });

    expect(putBody?.model).toEqual({ provider: "g", id: "x-flash" });
  });

  it("4.2 base model clear (file-set): emits model: null and passes validator (E15)", async () => {
    let putBody: any = null;
    const sources = new Map<string, RegisteredSource>();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      config: allDefaultConfig({ model: { provider: "g", id: "x" } }),
      onPut: (body) => {
        putBody = body;
      },
    });

    const { getByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    fireEvent.click(getByTestId("blackhole-base-model-clear"));

    await act(async () => {
      await sources.get("plugin:blackhole")?.commit();
    });

    expect(putBody?.model).toBeNull();
    expect(validateBlackholeConfig(putBody!).errors).toEqual([]);
  });

  it("4.3 base model clear (never-set) is a no-op: save stays un-dirtied, no model key (E16)", async () => {
    let putCalled = false;
    const sources = new Map<string, RegisteredSource>();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      onPut: () => {
        putCalled = true;
      },
    });

    const { getByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    const clearBtn = getByTestId("blackhole-base-model-clear") as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(true);
    expect(sources.get("plugin:blackhole")?.isDirty).toBe(false);
    expect(putCalled).toBe(false);
  });

  it("4.4 staged content: stages flash rows, debug:true, debugLog:true, untouched omitted (E17)", async () => {
    let putBody: any = null;
    const sources = new Map<string, RegisteredSource>();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      config: allDefaultConfig(),
      models: {
        object: "list",
        data: [
          { id: "g/first-flash", provider: "g", reasoning: true },
          { id: "openrouter/second-flash", provider: "openrouter", reasoning: true },
        ],
      },
      onPut: (body) => {
        putBody = body;
      },
    });

    const { getByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    fireEvent.click(getByTestId("blackhole-recommended-defaults-btn"));

    await act(async () => {
      await sources.get("plugin:blackhole")?.commit();
    });

    expect(putBody?.observerModel).toEqual({ provider: "g", id: "first-flash", cooldownHours: 1 });
    expect(putBody?.observerFallbackModels).toEqual([
      { provider: "openrouter", id: "second-flash", cooldownHours: 1 },
    ]);
    expect(putBody?.reflectorModel).toEqual({ provider: "g", id: "first-flash", cooldownHours: 1 });
    expect(putBody?.reflectorFallbackModels).toEqual([
      { provider: "openrouter", id: "second-flash", cooldownHours: 1 },
    ]);
    expect(putBody?.dropperModel).toEqual({ provider: "g", id: "first-flash", cooldownHours: 1 });
    expect(putBody?.dropperFallbackModels).toEqual([
      { provider: "openrouter", id: "second-flash", cooldownHours: 1 },
    ]);
    expect(putBody?.debug).toBe(true);
    expect(putBody?.debugLog).toBe(true);
    expect(Object.hasOwn(putBody!, "observeAfterTokens")).toBe(false);
  });

  it("4.5 defaults staged but not written: PUT not called, host save dirty (E18)", async () => {
    let putCalled = false;
    const sources = new Map<string, RegisteredSource>();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      models: {
        object: "list",
        data: [{ id: "g/x-flash", provider: "g", reasoning: true }],
      },
      onPut: () => {
        putCalled = true;
      },
    });

    const { getByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    fireEvent.click(getByTestId("blackhole-recommended-defaults-btn"));
    expect(putCalled).toBe(false);
    expect(sources.get("plugin:blackhole")?.isDirty).toBe(true);
  });

  it("4.6 no candidate available: defaults disabled with explanation, no dialog (E19)", async () => {
    const { getByTestId, queryByTestId } = renderSettings();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      models: {
        object: "list",
        data: [{ id: "a/b-pro", provider: "a", reasoning: true }],
      },
    });

    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    const btn = getByTestId("blackhole-recommended-defaults-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(getByTestId("blackhole-recommended-defaults-card").textContent).toMatch(
      /flash|haiku|mini/i,
    );
    fireEvent.click(btn);
    expect(queryByTestId("mock-confirm-dialog")).toBeNull();
  });

  it("4.7 confirm matrix: empty chain no dialog; non-empty chain requires confirm (E20)", async () => {
    const sources = new Map<string, RegisteredSource>();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      config: allDefaultConfig({
        observerModel: { provider: "openrouter", id: "existing-a" },
      }),
      models: {
        object: "list",
        data: [{ id: "g/x-flash", provider: "g", reasoning: true }],
      },
    });

    const { getByTestId, queryByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    // Non-empty chain: click defaults opens confirm dialog
    fireEvent.click(getByTestId("blackhole-recommended-defaults-btn"));
    expect(getByTestId("mock-confirm-dialog")).toBeTruthy();

    // Cancel: draft remains unchanged
    fireEvent.click(getByTestId("confirm-dialog-cancel"));
    expect(queryByTestId("mock-confirm-dialog")).toBeNull();
    expect(sources.get("plugin:blackhole")?.isDirty).toBe(false);

    // Confirm: stages defaults
    fireEvent.click(getByTestId("blackhole-recommended-defaults-btn"));
    fireEvent.click(getByTestId("confirm-dialog-confirm"));
    expect(queryByTestId("mock-confirm-dialog")).toBeNull();
    expect(sources.get("plugin:blackhole")?.isDirty).toBe(true);
  });

  it("4.8 fewer than 3 candidates: copy states fewer than 3 staged (E21)", async () => {
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      models: {
        object: "list",
        data: [{ id: "g/only-flash", provider: "g", reasoning: true }],
      },
    });

    const { getByTestId } = renderSettings();
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    fireEvent.click(getByTestId("blackhole-recommended-defaults-btn"));
    expect(getByTestId("blackhole-recommended-defaults-card").textContent).toMatch(
      /1 of 3/i,
    );
  });

  it("4.9 PUT 400 surfaces server error message, keeps draft and save available (X1)", async () => {
    const sources = new Map<string, RegisteredSource>();
    (globalThis as { fetch?: unknown }).fetch = mockFetch({
      installed: true,
      models: {
        object: "list",
        data: [{ id: "g/x-flash", provider: "g", reasoning: true }],
      },
      putStatus: 400,
      putBody: { error: "observerModel.thinking must be one of..." },
    });

    const { getByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    fireEvent.click(getByTestId("blackhole-recommended-defaults-btn"));
    expect(sources.get("plugin:blackhole")?.isDirty).toBe(true);

    await act(async () => {
      try {
        await sources.get("plugin:blackhole")?.commit();
      } catch {
        // expected rethrow
      }
    });

    expect(getByTestId("blackhole-save-error").textContent).toContain("observerModel.thinking must be one of");
    expect(sources.get("plugin:blackhole")?.isDirty).toBe(true);
  });

  it("4.10 registry ok -> empty before defaults click: button disabled, nothing staged (X4)", async () => {
    let modelsCallCount = 0;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string) => {
      if (url.includes("/config")) return jsonRes(allDefaultConfig());
      if (url.includes("/status")) return jsonRes({ installed: true });
      if (url.includes("/api/models")) {
        modelsCallCount++;
        if (modelsCallCount === 1) {
          return jsonRes({
            object: "list",
            data: [{ id: "g/x-flash", provider: "g", reasoning: true }],
          });
        }
        return jsonRes({ object: "list", data: [] });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });

    const sources = new Map<string, RegisteredSource>();
    const { getByTestId } = renderSettings(sources);
    await waitFor(() => expect(getByTestId("blackhole-settings")).toBeTruthy());

    const btn = getByTestId("blackhole-recommended-defaults-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    // Click retry which re-fetches and gets empty data
    fireEvent.click(getByTestId("blackhole-registry-retry"));
    await waitFor(() => expect(btn.disabled).toBe(true));

    fireEvent.click(btn);
    expect(sources.get("plugin:blackhole")?.isDirty).toBe(false);
  });
});
