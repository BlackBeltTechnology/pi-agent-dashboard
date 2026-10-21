/**
 * canvas() declare normalization (Decision 5). Scenarios S13, S14, S15, S33.
 * See change: auto-canvas.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeCanvasDeclare,
  validateCanvasDeclareShape,
} from "../canvas-declare.js";

describe("normalizeCanvasDeclare", () => {
  it("S13 — a file target gets the server cwd", () => {
    const r = normalizeCanvasDeclare(
      { target: { kind: "file", path: "report.md" } },
      "/p",
    );
    expect(r).toMatchObject({
      ok: true,
      candidate: {
        prio: "DECLARE",
        target: { kind: "file", cwd: "/p", path: "report.md" },
        kind: "markdown",
      },
      mode: "replace",
    });
  });

  it("S14 — traversal is rejected with an error result (not {ok:true})", () => {
    const r = normalizeCanvasDeclare(
      { target: { kind: "file", path: "../../etc/passwd" } },
      "/p",
    );
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/absolute|\.\./i);
  });

  it("S14b — an absolute path is rejected too", () => {
    expect(
      normalizeCanvasDeclare({ target: { kind: "file", path: "/etc/passwd" } }, "/p").ok,
    ).toBe(false);
  });

  it("S15 — a server target routes to a chip, bypassing selection (NOT a ViewTarget)", () => {
    const r = normalizeCanvasDeclare(
      { target: { kind: "server", port: 5173 } },
      "/p",
    );
    expect(r).toEqual({ ok: true, chip: { kind: "server", port: 5173, title: undefined } });
    // No candidate/ViewTarget on the server path.
    expect("candidate" in r).toBe(false);
  });

  it("S33 — the announced host is never carried; the chip has only a port", () => {
    const r = normalizeCanvasDeclare(
      // A model could pretend to announce a host elsewhere; the input shape
      // has no host field, and the chip carries only the port. The dashboard
      // always probes 127.0.0.1:port on tap.
      { target: { kind: "server", port: 8080 } },
      "/p",
    );
    if (r.ok && "chip" in r) {
      expect(Object.keys(r.chip).sort()).toEqual(["kind", "port", "title"]);
      expect((r.chip as unknown as Record<string, unknown>).host).toBeUndefined();
    } else {
      throw new Error("expected a server chip");
    }
  });

  it("url passes through as a ViewTarget", () => {
    const r = normalizeCanvasDeclare(
      { target: { kind: "url", url: "https://youtu.be/abc" } },
      "/p",
    );
    expect(r).toMatchObject({ ok: true, candidate: { target: { kind: "url", url: "https://youtu.be/abc" } } });
  });
});

describe("validateCanvasDeclareShape (cwd-free ack)", () => {
  it("accepts a clean relative file path", () => {
    expect(validateCanvasDeclareShape({ target: { kind: "file", path: "a/b.md" } })).toBeNull();
  });
  it("rejects traversal without needing a cwd", () => {
    expect(validateCanvasDeclareShape({ target: { kind: "file", path: "../x" } })).not.toBeNull();
  });
  it("rejects a bad port", () => {
    expect(validateCanvasDeclareShape({ target: { kind: "server", port: 0 } })).not.toBeNull();
  });
  it("rejects a missing target", () => {
    expect(validateCanvasDeclareShape(undefined)).not.toBeNull();
  });

  it("rejects a malformed url", () => {
    expect(
      validateCanvasDeclareShape({ target: { kind: "url", url: "not a url" } }),
    ).toMatch(/valid URL/i);
  });

  it("accepts a well-formed url", () => {
    expect(
      validateCanvasDeclareShape({ target: { kind: "url", url: "https://youtu.be/x" } }),
    ).toBeNull();
  });
});

describe("loopback url declare routes to the confirm chip (E9)", () => {
  it("keeps the path and the port, produces no candidate", () => {
    const r = normalizeCanvasDeclare(
      { target: { kind: "url", url: "http://127.0.0.1:5173/app?x=1" }, title: "Dev" },
      "/p",
    );
    expect(r).toEqual({ ok: true, chip: { kind: "server", port: 5173, title: "Dev", path: "/app?x=1" } });
    expect("candidate" in r).toBe(false);
  });
  it("omits path for a root url and infers the default port", () => {
    const r = normalizeCanvasDeclare({ target: { kind: "url", url: "http://localhost/" } }, "/p");
    expect(r).toEqual({ ok: true, chip: { kind: "server", port: 80, title: undefined } });
  });
  it("a LAN/public url is still a candidate", () => {
    const r = normalizeCanvasDeclare({ target: { kind: "url", url: "http://192.168.1.5:5173/" } }, "/p");
    expect(r).toMatchObject({ ok: true, candidate: { target: { kind: "url" } } });
  });
});
