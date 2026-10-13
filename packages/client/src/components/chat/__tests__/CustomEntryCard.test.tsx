/**
 * CustomEntryCard — the bounded generic fallback renderer for non-flow-event
 * custom content (change: render-inline-reasoning-and-custom-entries, task 3.3).
 *
 * Contract (design D4):
 * - `customType` renders as a visible label.
 * - The body renders VISIBLE by default (the bug being fixed is invisibility).
 * - The body is PLAIN TEXT in a `<pre>` — markdown payloads must NOT be
 *   interpreted (untrusted extension input; no injection/spoofing surface).
 * - A long payload renders inside a bounded-height region (the card must never
 *   grow unbounded; the reducer truncates content at row creation).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CUSTOM_BODY_MAX_CHARS } from "../../../lib/chat/event-reducer.js";
import { CustomEntryCard } from "../CustomEntryCard.js";
import { parseFallbackObject } from "../parse-fallback-object.js";

// X2 seam: force the structured list renderer to throw on demand.
const kv = vi.hoisted(() => ({ throwing: false }));
vi.mock("../FallbackKeyValueList.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../FallbackKeyValueList.js")>();
  return {
    ...actual,
    FallbackKeyValueList: (props: Parameters<typeof actual.FallbackKeyValueList>[0]) => {
      if (kv.throwing) throw new Error("kv render crash");
      return actual.FallbackKeyValueList(props);
    },
  };
});

// E17 seam: the row inset follows useMobile, like ToolCallStep.
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useMobile.js", () => ({ useMobile: () => mobile.value }));

afterEach(() => {
  cleanup();
  mobile.value = false;
});

describe("CustomEntryCard", () => {
  it("renders the customType label and the visible body", () => {
    const { container } = render(
      <CustomEntryCard customType="my-ext:state" body={"branch: main"} timestamp={1756300000000} />,
    );
    expect(screen.getByText("my-ext:state")).toBeTruthy();
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toBe("branch: main");
  });

  it("renders markdown-looking payloads as PLAIN TEXT (no markdown interpretation)", () => {
    const { container } = render(
      <CustomEntryCard
        customType="x"
        body={"**bold** [link](https://e.com) <img src=x onerror=alert(1)>"}
        timestamp={1756300000000}
      />,
    );
    const pre = container.querySelector("pre")!;
    // Exact text preservation — no <strong>, no <a>, no <img> created.
    expect(pre.querySelector("strong")).toBeNull();
    expect(pre.querySelector("a")).toBeNull();
    expect(pre.querySelector("img")).toBeNull();
    expect(pre.textContent).toBe("**bold** [link](https://e.com) <img src=x onerror=alert(1)>");
  });

  it("bounds a long payload in a fixed-height scroll region", () => {
    const longBody = Array.from({ length: 200 }, (_, i) => `line-${i + 1}`).join("\n");
    const { container } = render(
      <CustomEntryCard customType="x" body={longBody} timestamp={1756300000000} />,
    );
    const pre = container.querySelector("pre")!;
    // Bounded height + vertical scroll: the card region never grows unbounded.
    expect(pre.className).toMatch(/max-h-\[/);
    expect(pre.className).toContain("overflow-y-auto");
    // The (already-truncated) body is still fully present in the DOM.
    expect(pre.textContent).toContain("line-200");
  });

  it("shows the message time", () => {
    render(<CustomEntryCard customType="x" body="b" timestamp={1756300000000} />);
    // formatMessageTime output — just assert some time text node exists beyond
    // the label/body by checking the card's meta region is non-empty.
    const meta = screen.getByText("x").parentElement!;
    expect(meta.textContent!.length).toBeGreaterThan("x".length);
  });
});

describe("parseFallbackObject (change: render-unclaimed-custom-entries)", () => {
  it("E5: structured entries only for untruncated JSON objects", () => {
    expect(parseFallbackObject('{"a":1,"b":"x"}')?.entries).toEqual([
      ["a", "1"],
      ["b", "x"],
    ]);
    expect(parseFallbackObject('{"n":[1,2],"o":{"k":1}}')?.entries).toEqual([
      ["n", "[1,2]"],
      ["o", '{"k":1}'],
    ]);
    const tail = `${"x".repeat(CUSTOM_BODY_MAX_CHARS - 7)}{"a":1}`;
    expect(tail.length).toBe(CUSTOM_BODY_MAX_CHARS);
    for (const body of [
      '«3 earlier lines hidden»\n{"a":1}',
      tail,
      "[1,2]",
      "42",
      "null",
      "{}",
      "hello",
      "{bad",
    ]) {
      expect(parseFallbackObject(body), body.slice(0, 30)).toBeNull();
    }
  });

  it("E6: key count is bounded at 50 with an omitted counter", () => {
    const obj = (n: number) => JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i])));
    const cases: [number, number, number][] = [
      [1, 1, 0],
      [49, 49, 0],
      [50, 50, 0],
      [51, 50, 1],
      [120, 50, 70],
    ];
    for (const [n, shown, omitted] of cases) {
      const r = parseFallbackObject(obj(n))!;
      expect(r.entries.length).toBe(shown);
      expect(r.omitted).toBe(omitted);
    }
  });

  it("E7: ingest placeholders are shown verbatim", () => {
    const a = parseFallbackObject('{"__truncated":true,"reason":"size","thresholdBytes":262144}')!;
    expect(a.entries).toEqual([
      ["__truncated", "true"],
      ["reason", "size"],
      ["thresholdBytes", "262144"],
    ]);
    const b = parseFallbackObject('{"answer":"ab…[9000 chars hidden]…yz","results":"[array truncated]"}')!;
    expect(b.entries).toEqual([
      ["answer", "ab…[9000 chars hidden]…yz"],
      ["results", "[array truncated]"],
    ]);
  });

  it("X1: hostile bodies never throw", () => {
    expect(parseFallbackObject(`{${"[".repeat(20_000)}`)).toBeNull();
    expect(parseFallbackObject("[".repeat(20_000))).toBeNull();
    const spy = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("stringify boom");
    });
    try {
      expect(parseFallbackObject('{"a":{"b":1}}')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("CustomEntryCard structured view", () => {
  it("F1: an object body renders a key/value list, no <pre>", () => {
    const { container } = render(
      <CustomEntryCard
        customType="subagent-admission-refused"
        body='{"cause":"cap","inFlight":2,"reason":"Refused…"}'
        timestamp={1756300000000}
      />,
    );
    const dts = container.querySelectorAll("dl dt");
    expect(Array.from(dts).map((d) => d.textContent)).toEqual(["cause", "inFlight", "reason"]);
    expect(screen.getByText("subagent-admission-refused")).toBeTruthy();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("F2: HTML/markdown-looking values stay inert text", () => {
    const body = JSON.stringify({ a: "<img src=x onerror=alert(1)>", b: "[x](javascript:alert(1))" });
    const { container } = render(<CustomEntryCard customType="x" body={body} timestamp={1756300000000} />);
    const card = screen.getByTestId("custom-entry-card");
    expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(card.textContent).toContain("[x](javascript:alert(1))");
    expect(container.querySelectorAll("img").length).toBe(0);
    expect(container.querySelectorAll("a").length).toBe(0);
  });

  it("F3: prose, marker-prefixed objects and arrays keep the single <pre>", () => {
    for (const body of ["just prose", '«3 earlier lines hidden»\n{"a":1}', "[1,2,3]"]) {
      const { container, unmount } = render(<CustomEntryCard customType="x" body={body} timestamp={1756300000000} />);
      const pres = container.querySelectorAll("pre");
      expect(pres.length).toBe(1);
      expect(pres[0].textContent).toBe(body);
      expect(container.querySelector("dl")).toBeNull();
      unmount();
    }
  });

  it("F4: more than 50 keys shows an omitted-keys notice", () => {
    const body = JSON.stringify(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])));
    const { container } = render(<CustomEntryCard customType="x" body={body} timestamp={1756300000000} />);
    expect(container.querySelectorAll("dt").length).toBe(50);
    expect(screen.getByText("1 more key")).toBeTruthy();
  });

  it("X2: a throwing structured renderer falls back to the <pre> body; siblings survive", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    kv.throwing = true;
    try {
      const { container } = render(
        <div>
          <CustomEntryCard customType="sib-1" body="one" timestamp={1756300000000} />
          <CustomEntryCard customType="boom" body='{"a":1}' timestamp={1756300000000} />
          <CustomEntryCard customType="sib-2" body="two" timestamp={1756300000000} />
        </div>,
      );
      expect(screen.getByText("sib-1")).toBeTruthy();
      expect(screen.getByText("sib-2")).toBeTruthy();
      const boom = screen.getAllByTestId("custom-entry-card")[1];
      expect(boom.querySelector("pre")?.textContent).toBe('{"a":1}');
      expect(boom.querySelector("dl")).toBeNull();
      expect(container.querySelectorAll("[data-testid=custom-entry-card]").length).toBe(3);
    } finally {
      kv.throwing = false;
    }
  });
});

// See change: retro-ux-chat-rendering (test-plan E16, E17)
describe("CustomEntryCard — contract conformance", () => {
  const PALETTE = /\b(?:bg|text|border)-(?:red|blue|cyan|green|yellow|orange|purple|amber|slate|gray|black|white)(?:-\d+)?/;

  it("E16: neutral mono --text-primary type label with an 'extension entry' meta, icon aria-hidden", () => {
    const { container } = render(
      <CustomEntryCard customType="my-ext:state" body={'{"a":1}'} timestamp={1756300000000} />,
    );
    const label = screen.getByText("my-ext:state");
    expect(label.className).toContain("font-mono");
    expect(label.className).toContain("text-[var(--text-primary)]");
    const meta = screen.getByText("extension entry");
    expect(meta.className).toContain("text-[var(--text-secondary)]");
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(container.innerHTML).not.toMatch(PALETTE);
    expect(container.innerHTML).not.toContain("--text-tertiary");
  });

  it("E17: '3 more keys' is --text-secondary, the time is >= 12px, the inset matches the tool rows", () => {
    const body = JSON.stringify(Object.fromEntries(Array.from({ length: 53 }, (_, i) => [`k${i}`, i])));
    const { container } = render(<CustomEntryCard customType="x" body={body} timestamp={1756300000000} />);
    const more = screen.getByText("3 more keys");
    expect(more.className).toContain("text-[var(--text-secondary)]");
    const time = screen.getByText("extension entry").nextElementSibling as HTMLElement;
    expect(time.className).toContain("text-[12px]");
    const root = container.querySelector('[data-testid="custom-entry-card"]') as HTMLElement;
    expect(root.className).toContain("mx-4");
    expect(root.className).not.toMatch(/\bmx-2\b/);

    cleanup();
    mobile.value = true;
    const m = render(<CustomEntryCard customType="x" body={body} timestamp={1756300000000} />);
    const mobileRoot = m.container.querySelector('[data-testid="custom-entry-card"]') as HTMLElement;
    expect(mobileRoot.className).toMatch(/\bmx-2\b/);
    expect(mobileRoot.className).not.toContain("mx-4");
  });
});
