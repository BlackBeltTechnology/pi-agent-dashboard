/**
 * Server editor tests (change extract-mcp-client-plugin, tasks 7.4 + 7.5):
 * schema-driven rendering with full type coverage, transport tabs, invalid
 * save, the read-only View + "Override at Pi global" flow, patch minimality
 * (changed keys only, unknown fields preserved), atomic-override notes,
 * secret masking with per-field reveal that resets on reopen, and the
 * `boolean | string[]` toggle-with-list.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import schemaDoc from "../../../schema/mcp-config.schema.json";
import { invalidateEffective } from "../hooks.js";
import { ServerEditor, type ServerEditorProps } from "../ServerEditor.js";
import { defsOf } from "../schema.js";

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useT: () => (_key: string, _params?: unknown, fallback?: string) => fallback ?? _key,
}));

const SCHEMA = schemaDoc as unknown as Record<string, unknown>;
const SCHEMA_PROPS = Object.keys(
  (defsOf(SCHEMA).ServerEntry?.properties ?? {}) as Record<string, unknown>,
);

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

interface RecordedPut {
  url: string;
  body: Record<string, unknown>;
}

/** The last recorded PUT's `set` object — waitFor guarantees it exists. */
function lastSet(puts: RecordedPut[]): Record<string, unknown> {
  const body = puts[puts.length - 1]?.body;
  if (body === undefined) throw new Error("no PUT recorded");
  return body.set as Record<string, unknown>;
}

/** The last recorded PUT's body. */
function lastBody(puts: RecordedPut[]): Record<string, unknown> {
  const body = puts[puts.length - 1]?.body;
  if (body === undefined) throw new Error("no PUT recorded");
  return body;
}

/** Serves `GET /schema`; records every server `PUT` instead of writing. */
function stubFetch(): { puts: RecordedPut[] } {
  const puts: RecordedPut[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/schema")) return jsonOk(SCHEMA);
      if ((init?.method ?? "GET") === "PUT" && u.includes("/servers/")) {
        puts.push({ url: u, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return jsonOk({ ok: true });
      }
      throw new Error(`unexpected request: ${u}`);
    }),
  );
  return { puts };
}

function renderEditor(over: Partial<ServerEditorProps> = {}) {
  const props: ServerEditorProps = {
    name: "srv",
    entry: { command: "/bin/a" },
    editable: true,
    readOnly: false,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...over,
  };
  return { props, ...render(<ServerEditor {...props} />) };
}

/** Every field row testid visible in the container, minus input/error/value suffixes. */
function visibleFieldNames(container: HTMLElement): Set<string> {
  const names = new Set<string>();
  for (const el of container.querySelectorAll("[data-testid]")) {
    const testid = el.getAttribute("data-testid") ?? "";
    if (
      testid.startsWith("mcp-field-") &&
      !testid.startsWith("mcp-field-input-") &&
      !testid.startsWith("mcp-field-error-") &&
      !testid.startsWith("mcp-field-value-")
    ) {
      names.add(testid.slice("mcp-field-".length));
    }
  }
  return names;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  invalidateEffective();
});

describe("type coverage (task 7.4)", () => {
  it("renders a field row for EVERY ServerEntry property across tabs", async () => {
    stubFetch();
    const { container } = renderEditor({ name: null, entry: {} });
    await screen.findByTestId("mcp-editor-footer");

    const seen = new Set<string>();
    for (const tab of ["command", "url", "socket"]) {
      fireEvent.click(screen.getByTestId(`mcp-tab-${tab}`));
      for (const name of visibleFieldNames(container)) seen.add(name);
    }
    for (const prop of SCHEMA_PROPS) {
      expect(seen.has(prop), `missing field row for ${prop}`).toBe(true);
    }
    // Advanced is collapsed by default but its rows still exist in the DOM.
    expect((screen.getByTestId("mcp-advanced") as HTMLDetailsElement).open).toBe(false);
  });
});

describe("transport tabs (task 7.4)", () => {
  it("initial tab comes from the entry's transport; other transports' fields are hidden", async () => {
    stubFetch();
    renderEditor({ entry: { command: "/bin/a", args: ["--x"], env: { A: "1" } } });
    await screen.findByTestId("mcp-field-command");
    expect(screen.getByTestId("mcp-tab-command").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("mcp-field-url")).toBeNull();
    expect(screen.queryByTestId("mcp-field-socket")).toBeNull();
  });

  it("a url entry opens on the url tab", async () => {
    stubFetch();
    renderEditor({ entry: { url: "https://u/mcp" } });
    await screen.findByTestId("mcp-field-url");
    expect(screen.getByTestId("mcp-tab-url").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("mcp-field-command")).toBeNull();
  });

  it("switching tab hides the other transport's fields and clears its keys from the patch", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a", args: ["--x"], env: { A: "1" } } });
    await screen.findByTestId("mcp-field-command");

    fireEvent.click(screen.getByTestId("mcp-tab-url"));
    expect(screen.queryByTestId("mcp-field-command")).toBeNull();
    expect(screen.queryByTestId("mcp-field-env")).toBeNull();
    expect(screen.getByTestId("mcp-field-headers")).toBeTruthy();

    fireEvent.change(screen.getByTestId("mcp-field-input-url"), { target: { value: "https://u/mcp" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect(lastSet(puts)).toEqual({ url: "https://u/mcp" });
    expect(lastBody(puts).unset).toEqual(["command", "args", "env"]);
    expect(lastBody(puts).scope).toBe("global");
  });
});

describe("invalid save (task 7.4)", () => {
  it("shows an inline error + summary and issues no write", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a" } });
    const command = await screen.findByTestId("mcp-field-input-command");
    fireEvent.change(command, { target: { value: "" } });

    fireEvent.click(screen.getByTestId("mcp-save"));
    expect(await screen.findByTestId("mcp-field-error-command")).toBeTruthy();
    const summary = screen.getByTestId("mcp-summary-error");
    expect(summary.textContent).toContain("command");
    expect(puts.length).toBe(0);
  });
});

describe("read-only View for shared servers (task 7.4)", () => {
  it("renders fields as text and offers Override at Pi global instead of Save", async () => {
    stubFetch();
    renderEditor({ entry: { command: "/bin/s", lifecycle: "eager" }, editable: false });
    await screen.findByTestId("mcp-editor-footer");

    const dialog = screen.getByTestId("mcp-editor-dialog");
    expect(dialog.querySelectorAll("input,select,textarea").length).toBe(0);
    expect(dialog.textContent).toContain("/bin/s");
    expect(screen.queryByTestId("mcp-save")).toBeNull();
    expect(screen.getByTestId("mcp-editor-override").textContent).toBe("Override at Pi global");
  });

  it("page-wide read-only disables Save even for an editable server", async () => {
    stubFetch();
    renderEditor({ readOnly: true });
    await screen.findByTestId("mcp-editor-footer");
    expect((screen.getByTestId("mcp-save") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("override + patch minimality (task 7.4)", () => {
  it("override writes only changed fields", async () => {
    const { puts } = stubFetch();
    renderEditor({
      entry: { command: "/bin/s", lifecycle: "lazy", env: { redacted: true, keys: [] } },
      editable: false,
    });
    await screen.findByTestId("mcp-editor-override");
    fireEvent.click(screen.getByTestId("mcp-editor-override"));

    fireEvent.change(screen.getByTestId("mcp-field-input-lifecycle"), { target: { value: "eager" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect(lastBody(puts)).toEqual({ scope: "global", set: { lifecycle: "eager" }, unset: [] });
  });

  it("unknown fields survive editing", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a", futureThing: { x: 1 } } });
    await screen.findByTestId("mcp-field-input-command");
    fireEvent.change(screen.getByTestId("mcp-field-input-command"), { target: { value: "/bin/b" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect(lastSet(puts)).toEqual({ command: "/bin/b" });
    expect(lastBody(puts).unset).toEqual([]);
    expect("futureThing" in lastSet(puts)).toBe(false);
    expect((lastBody(puts).unset as string[]).includes("futureThing")).toBe(false);
  });
});

describe("atomic override (task 7.4)", () => {
  const REDACTED_ENV = {
    redacted: true,
    keys: [
      { name: "PATH", secret: false },
      { name: "API_TOKEN", secret: true },
      { name: "CLIENT_SECRET", secret: true },
    ],
  };

  it("starts empty and states how many inherited keys/secrets stop applying", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/s", env: REDACTED_ENV }, editable: false });
    await screen.findByTestId("mcp-editor-override");
    fireEvent.click(screen.getByTestId("mcp-editor-override"));

    const overrideBtn = screen.getByTestId("mcp-override-env");
    expect(screen.queryByTestId("mcp-override-note-env")).toBeNull();
    fireEvent.click(overrideBtn);

    const note = screen.getByTestId("mcp-override-note-env");
    expect(note.textContent).toMatch(/3 inherited keys incl\. 2 secrets will no longer apply/);
    expect(screen.getByTestId("mcp-record-add-env")).toBeTruthy(); // editable, starts empty

    fireEvent.click(screen.getByTestId("mcp-save"));
    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect(lastBody(puts)).toEqual({ scope: "global", set: { env: {} }, unset: [] });
  });

  it("shows the inherited key names read-only before overriding", async () => {
    stubFetch();
    renderEditor({ entry: { command: "/bin/s", env: REDACTED_ENV }, editable: false });
    await screen.findByTestId("mcp-record-row-env.API_TOKEN");
    expect(screen.queryByTestId("mcp-override-env")).toBeNull(); // view mode: no mutating action
  });
});

describe("secret masking (task 7.5)", () => {
  it("masks an own bearerToken with a reveal toggle that resets on reopen", async () => {
    stubFetch();
    const first = renderEditor({ entry: { url: "https://u/mcp", bearerToken: "tok-123" } });
    const input = (await screen.findByTestId("mcp-field-input-bearerToken")) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("tok-123");

    fireEvent.click(screen.getByTestId("mcp-reveal-bearerToken"));
    expect((screen.getByTestId("mcp-field-input-bearerToken") as HTMLInputElement).type).toBe("text");

    first.unmount();
    stubFetch();
    renderEditor({ entry: { url: "https://u/mcp", bearerToken: "tok-123" } });
    const reopened = (await screen.findByTestId("mcp-field-input-bearerToken")) as HTMLInputElement;
    expect(reopened.type).toBe("password");
  });

  it("masks every headers row (field x-secret) with a per-row reveal", async () => {
    stubFetch();
    renderEditor({ entry: { url: "https://u", headers: { Authorization: "Bearer x", Accept: "json" } } });
    const auth = (await screen.findByTestId("mcp-record-value-headers.Authorization")) as HTMLInputElement;
    expect(auth.type).toBe("password");
    // `headers` is schema-marked x-secret: every row masks, key name aside.
    const accept = screen.getByTestId("mcp-record-value-headers.Accept") as HTMLInputElement;
    expect(accept.type).toBe("password");

    fireEvent.click(screen.getByTestId("mcp-reveal-headers.Authorization"));
    expect((screen.getByTestId("mcp-record-value-headers.Authorization") as HTMLInputElement).type).toBe("text");
  });

  it("an inherited secret renders the placeholder with no reveal and stays out of the patch", async () => {
    const { puts } = stubFetch();
    renderEditor({
      entry: { url: "https://u/mcp", bearerToken: { redacted: true } },
      editable: false,
    });
    await screen.findByTestId("mcp-redacted-bearerToken");
    expect(screen.queryByTestId("mcp-reveal-bearerToken")).toBeNull();

    // Override and save without typing: the sentinel is NOT sent.
    fireEvent.click(screen.getByTestId("mcp-editor-override"));
    fireEvent.click(screen.getByTestId("mcp-save"));
    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect("bearerToken" in lastSet(puts)).toBe(false);
  });

  it("typing a new value sends it", async () => {
    const { puts } = stubFetch();
    renderEditor({
      entry: { url: "https://u/mcp", bearerToken: { redacted: true } },
      editable: false,
    });
    await screen.findByTestId("mcp-editor-override");
    fireEvent.click(screen.getByTestId("mcp-editor-override"));
    fireEvent.change(screen.getByTestId("mcp-field-input-bearerToken"), { target: { value: "new-tok" } });
    fireEvent.click(screen.getByTestId("mcp-save"));
    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect(lastSet(puts).bearerToken).toBe("new-tok");
  });

  it("a redacted record renders its known key names", async () => {
    stubFetch();
    renderEditor({
      entry: {
        command: "/bin/s",
        env: { redacted: true, keys: [{ name: "API_TOKEN", secret: true }, { name: "PATH", secret: false }] },
      },
      editable: false,
    });
    await screen.findByTestId("mcp-record-row-env.API_TOKEN");
    expect(screen.getByTestId("mcp-record-row-env.PATH")).toBeTruthy();
    expect(screen.getByTestId("mcp-record-row-env.API_TOKEN").textContent).toContain("••••••••");
  });
});

describe("union boolean | string[] (task 7.4)", () => {
  it("checking reveals the list and the patch carries an array", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a" } });
    await screen.findByTestId("mcp-field-directTools");
    expect(screen.queryByTestId("mcp-list-add-directTools")).toBeNull();

    fireEvent.click(screen.getByTestId("mcp-advanced").querySelector("summary") as HTMLElement);
    fireEvent.click(screen.getByTestId("mcp-field-input-directTools"));
    fireEvent.click(screen.getByTestId("mcp-list-add-directTools"));
    fireEvent.change(screen.getByTestId("mcp-list-input-directTools-0"), { target: { value: "fetch" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect(lastSet(puts).directTools).toEqual(["fetch"]);
  });

  it("unchecking hides the list and the patch carries a boolean", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a" } });
    await screen.findByTestId("mcp-field-input-directTools");
    fireEvent.click(screen.getByTestId("mcp-field-input-directTools"));
    fireEvent.click(screen.getByTestId("mcp-field-input-directTools")); // uncheck again
    expect(screen.queryByTestId("mcp-list-add-directTools")).toBeNull();

    fireEvent.click(screen.getByTestId("mcp-save"));
    await vi.waitFor(() => expect(puts.length).toBe(1));
    expect(lastSet(puts).directTools).toBe(false);
  });
});

describe("dialog accessibility shell", () => {
  it("is a named modal and Escape closes it", async () => {
    stubFetch();
    const onClose = vi.fn();
    renderEditor({ onClose });
    const dialog = await screen.findByTestId("mcp-editor-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toContain("srv");

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
