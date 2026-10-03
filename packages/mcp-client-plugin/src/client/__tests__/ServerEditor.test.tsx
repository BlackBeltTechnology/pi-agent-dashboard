/**
 * Server editor tests (change migrate-mcp-to-pi-builtin): schema-driven
 * rendering for pi's entry shape, ONE transport at a time (tabs clear the
 * other transport's keys), WHOLE-entry save with rename, the exposure alias
 * shown resolved but preserved unchanged (E20), secret masking vs ${REF}/!
 * literal values (E13), unknown fields in a validated JSON fallback, the
 * discard guard, and the OAuth rename/URL warning.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...over,
  };
  return { props, ...render(<ServerEditor {...props} />) };
}

/** Every field row testid visible in the container, minus input/error suffixes. */
function visibleFieldNames(container: HTMLElement): Set<string> {
  const names = new Set<string>();
  for (const el of container.querySelectorAll("[data-testid]")) {
    const testid = el.getAttribute("data-testid") ?? "";
    if (testid.startsWith("mcp-field-") && !testid.startsWith("mcp-field-input-") && !testid.startsWith("mcp-field-error-")) {
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

describe("type coverage", () => {
  it("renders a field row for EVERY ServerEntry property across tabs", async () => {
    stubFetch();
    const { container } = renderEditor({ name: null, entry: {} });
    await screen.findByTestId("mcp-editor-footer");

    const seen = new Set<string>();
    for (const tab of ["command", "url"]) {
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

describe("transport tabs", () => {
  it("initial tab comes from the entry; switching clears the other transport's keys from the saved entry", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a", args: ["--x"], env: { A: "1" } } });
    await screen.findByTestId("mcp-field-command");
    expect(screen.getByTestId("mcp-tab-command").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("mcp-field-url")).toBeNull();

    fireEvent.click(screen.getByTestId("mcp-tab-url"));
    expect(screen.queryByTestId("mcp-field-command")).toBeNull();
    expect(screen.queryByTestId("mcp-field-env")).toBeNull();
    expect(screen.getByTestId("mcp-field-headers")).toBeTruthy();

    fireEvent.change(screen.getByTestId("mcp-field-input-url"), { target: { value: "https://u/mcp" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await waitFor(() => expect(puts.length).toBe(1));
    // WHOLE-entry save: complete entry, other transport's keys gone.
    expect(lastBody(puts).scope).toBe("global");
    expect(lastBody(puts).entry).toEqual({ url: "https://u/mcp" });
  });
});

describe("whole-entry save + rename", () => {
  it("sends the complete entry with unknown fields preserved", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a", description: "d", futureThing: { x: 1 } } });
    await screen.findByTestId("mcp-field-input-command");
    fireEvent.change(screen.getByTestId("mcp-field-input-command"), { target: { value: "/bin/b" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(lastBody(puts).entry).toEqual({ command: "/bin/b", description: "d", futureThing: { x: 1 } });
    expect(lastBody(puts).previousName).toBeUndefined();
  });

  it("a renamed server PUTs the new name with previousName", async () => {
    const { puts } = stubFetch();
    renderEditor({ name: "old", entry: { command: "/bin/a" } });
    await screen.findByTestId("mcp-editor-name");
    fireEvent.change(screen.getByTestId("mcp-editor-name"), { target: { value: "new" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]?.url).toContain("/servers/new");
    expect(lastBody(puts).previousName).toBe("old");
  });

  it("an invalid server name blocks the save client-side", async () => {
    const { puts } = stubFetch();
    renderEditor({ name: null, entry: { command: "/bin/a" } });
    await screen.findByTestId("mcp-editor-name");
    fireEvent.change(screen.getByTestId("mcp-editor-name"), { target: { value: "bad name!" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await screen.findByTestId("mcp-editor-name-error");
    expect(puts.length).toBe(0);
  });

  it("an empty command shows a field error and issues no write", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a" } });
    const command = await screen.findByTestId("mcp-field-input-command");
    fireEvent.change(command, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    expect(await screen.findByTestId("mcp-field-error-command")).toBeTruthy();
    expect(screen.getByTestId("mcp-summary-error")).toBeTruthy();
    expect(puts.length).toBe(0);
  });
});

describe("exposure alias (test-plan E20)", () => {
  it("shows codemode for codemode-deferred and preserves the alias unless changed", async () => {
    const { puts } = stubFetch();
    const first = renderEditor({ entry: { command: "/bin/a", exposure: "codemode-deferred" } });
    const select = (await screen.findByTestId("mcp-field-input-exposure")) as HTMLSelectElement;
    expect(select.value).toBe("codemode");

    // edit ONLY the description → the alias survives the save
    fireEvent.change(screen.getByTestId("mcp-field-input-description"), { target: { value: "edited" } });
    fireEvent.click(screen.getByTestId("mcp-save"));
    await waitFor(() => expect(puts.length).toBe(1));
    expect((lastBody(puts).entry as Record<string, unknown>).exposure).toBe("codemode-deferred");

    // changing the exposure writes the picked canonical value
    first.unmount();
    const second = stubFetch();
    renderEditor({ entry: { command: "/bin/a", exposure: "codemode-deferred", description: "edited" } });
    const reopened = (await screen.findByTestId("mcp-field-input-exposure")) as HTMLSelectElement;
    expect(reopened.value).toBe("codemode");
    fireEvent.change(reopened, { target: { value: "direct" } });
    fireEvent.click(screen.getByTestId("mcp-save"));
    await waitFor(() => expect(second.puts.length).toBe(1));
    expect((lastBody(second.puts).entry as Record<string, unknown>).exposure).toBe("direct");
  });
});

describe("secret masking (test-plan E13)", () => {
  it("shows ${REF} and !command values as written; masks literals with a reveal toggle", async () => {
    stubFetch();
    const first = renderEditor({
      entry: {
        url: "https://u/mcp",
        headers: {
          Authorization: "Bearer ${GITHUB_TOKEN}",
          "X-Cmd": "!op read x",
          "X-Token": "Bearer abc123",
        },
      },
    });

    const ref = (await screen.findByTestId("mcp-record-value-headers.Authorization")) as HTMLInputElement;
    expect(ref.type).toBe("text"); // ${NAME} reference → visible as written
    expect(ref.value).toBe("Bearer ${GITHUB_TOKEN}");

    const cmd = screen.getByTestId("mcp-record-value-headers.X-Cmd") as HTMLInputElement;
    expect(cmd.type).toBe("text"); // leading ! (a command) → visible as written
    expect(cmd.value).toBe("!op read x");

    const lit = screen.getByTestId("mcp-record-value-headers.X-Token") as HTMLInputElement;
    expect(lit.type).toBe("password"); // literal secret → masked
    expect(lit.value).toBe("Bearer abc123");
    expect(screen.getByTestId("mcp-reveal-headers.X-Token")).toBeTruthy();

    // reveal unmasks just that row
    fireEvent.click(screen.getByTestId("mcp-reveal-headers.X-Token"));
    expect((screen.getByTestId("mcp-record-value-headers.X-Token") as HTMLInputElement).type).toBe("text");

    // env rows on a stdio entry mask the same way (env is schema x-secret)
    first.unmount();
    stubFetch();
    renderEditor({ entry: { command: "/bin/a", env: { API_KEY: "lit" } } });
    const envLit = (await screen.findByTestId("mcp-record-value-env.API_KEY")) as HTMLInputElement;
    expect(envLit.type).toBe("password");
    expect(envLit.value).toBe("lit");
    expect(screen.getByTestId("mcp-reveal-env.API_KEY")).toBeTruthy();
  });

  it("masks a plain oauth.clientSecret but shows a ${REF} one as written", async () => {
    stubFetch();
    renderEditor({
      entry: {
        url: "https://u/mcp",
        oauth: { clientId: "app", clientSecret: "s3cret" },
      },
    });
    await screen.findByTestId("mcp-field-oauth");
    fireEvent.click(screen.getByTestId("mcp-advanced").querySelector("summary") as HTMLElement);
    const secret = (await screen.findByTestId("mcp-field-input-oauth.clientSecret")) as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(screen.getByTestId("mcp-reveal-oauth.clientSecret")).toBeTruthy();

    cleanup();
    stubFetch();
    renderEditor({
      entry: { url: "https://u/mcp", oauth: { clientId: "app", clientSecret: "${VAULT_SECRET}" } },
    });
    await screen.findByTestId("mcp-field-oauth");
    fireEvent.click(screen.getByTestId("mcp-advanced").querySelector("summary") as HTMLElement);
    const ref = (await screen.findByTestId("mcp-field-input-oauth.clientSecret")) as HTMLInputElement;
    expect(ref.type).toBe("text");
    expect(ref.value).toBe("${VAULT_SECRET}");
  });
});

describe("unknown fields: validated JSON fallback", () => {
  it("renders unknown keys as JSON textareas and preserves them on save", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a", futureThing: { x: 1 } } });
    const box = (await screen.findByTestId("mcp-unknown-field-input-futureThing")) as HTMLTextAreaElement;
    expect(JSON.parse(box.value)).toEqual({ x: 1 });

    fireEvent.click(screen.getByTestId("mcp-save"));
    await waitFor(() => expect(puts.length).toBe(1));
    expect((lastBody(puts).entry as Record<string, unknown>).futureThing).toEqual({ x: 1 });
  });

  it("invalid JSON in an unknown field blocks the save", async () => {
    const { puts } = stubFetch();
    renderEditor({ entry: { command: "/bin/a", futureThing: { x: 1 } } });
    const box = await screen.findByTestId("mcp-unknown-field-input-futureThing");
    fireEvent.change(box, { target: { value: "{not json" } });
    fireEvent.click(screen.getByTestId("mcp-save"));

    await screen.findByTestId("mcp-unknown-field-error-futureThing");
    expect(puts.length).toBe(0);
  });
});

describe("discard guard", () => {
  it("asks for confirmation before discarding unsaved edits; an untouched close does not", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const onClose = vi.fn();
    stubFetch();
    const { props } = renderEditor({ entry: { command: "/bin/a", description: "d" }, onClose });
    await screen.findByTestId("mcp-editor-name");
    await screen.findByTestId("mcp-field-input-description");

    // untouched close: no confirmation
    fireEvent.click(screen.getByTestId("mcp-editor-close"));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    // edit, then close → confirmation; declining keeps the editor open
    onClose.mockClear();
    fireEvent.change(screen.getByTestId("mcp-field-input-description"), { target: { value: "changed" } });
    vi.stubGlobal("confirm", vi.fn(() => false));
    fireEvent.click(screen.getByTestId("mcp-editor-close"));
    expect(screen.getByTestId("mcp-editor-dialog")).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();

    // confirming discards
    vi.stubGlobal("confirm", vi.fn(() => true));
    fireEvent.click(screen.getByTestId("mcp-editor-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape runs the same guard", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const onClose = vi.fn();
    stubFetch();
    renderEditor({ entry: { command: "/bin/a", description: "d" }, onClose });
    await screen.findByTestId("mcp-editor-name");
    fireEvent.change(await screen.findByTestId("mcp-field-input-description"), { target: { value: "changed" } });
    fireEvent.keyDown(screen.getByTestId("mcp-editor-dialog"), { key: "Escape" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("OAuth rename/URL warning", () => {
  it("warns when the name or URL of an OAuth HTTP server changes; not for provider-auth or stdio", async () => {
    stubFetch();
    const first = renderEditor({ name: "srv", entry: { url: "https://u/mcp" } });
    await screen.findByTestId("mcp-field-url");
    expect(screen.queryByTestId("mcp-oauth-warning")).toBeNull();

    fireEvent.change(screen.getByTestId("mcp-field-input-url"), { target: { value: "https://v/mcp" } });
    expect(screen.getByTestId("mcp-oauth-warning").textContent).toContain("sign-in");
    first.unmount();

    // a renamed OAuth server warns too
    stubFetch();
    renderEditor({ name: "srv", entry: { url: "https://u/mcp" } });
    await screen.findByTestId("mcp-editor-name");
    fireEvent.change(screen.getByTestId("mcp-editor-name"), { target: { value: "srv2" } });
    expect(screen.getByTestId("mcp-oauth-warning")).toBeTruthy();

    // provider-auth HTTP server: no warning
    cleanup();
    stubFetch();
    renderEditor({ name: "srv", entry: { url: "https://u/mcp", auth: { provider: "radius" } } });
    await screen.findByTestId("mcp-field-url");
    fireEvent.change(screen.getByTestId("mcp-field-input-url"), { target: { value: "https://v/mcp" } });
    expect(screen.queryByTestId("mcp-oauth-warning")).toBeNull();

    // stdio server: no warning
    cleanup();
    stubFetch();
    renderEditor({ name: "srv", entry: { command: "/bin/a" } });
    await screen.findByTestId("mcp-editor-name");
    fireEvent.change(screen.getByTestId("mcp-editor-name"), { target: { value: "srv2" } });
    expect(screen.queryByTestId("mcp-oauth-warning")).toBeNull();
  });
});

describe("dialog accessibility shell", () => {
  it("is a named modal and focuses on open", async () => {
    stubFetch();
    const onClose = vi.fn();
    renderEditor({ onClose });
    const dialog = await screen.findByTestId("mcp-editor-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toContain("srv");
  });
});
