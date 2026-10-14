/**
 * `loadPurify()` must never hand out (or cache) a DOM-less DOMPurify, and every
 * consumer must then fail closed. `node:module`'s `createRequire` is faked so the
 * `isomorphic-dompurify` instance is controllable.
 *
 * See change: sanitize-untrusted-rendered-content (test-plan X3, X4).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  instances: [] as Array<{ isSupported: boolean; sanitize: (s: string) => string }>,
  loads: 0,
}));
vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => () => ({ default: fake.instances[Math.min(fake.loads++, fake.instances.length - 1)] }),
  };
});

const passThrough = () => ({ isSupported: false, sanitize: (s: string) => s });
const working = () => ({ isSupported: true, sanitize: (s: string) => s.replace(/MARKER/g, "") });

describe("loadPurify fail-closed", () => {
  beforeEach(() => {
    vi.resetModules();
    fake.loads = 0;
    fake.instances = [];
  });

  it("#X4 never caches an unsupported instance; recovers on the next call", async () => {
    fake.instances = [passThrough(), working()];
    const { loadPurify } = await import("../purify.js");
    await expect(loadPurify()).rejects.toThrow(/DOMPurify unavailable/);
    const ok = await loadPurify();
    expect(ok.isSupported).toBe(true);
    expect(await loadPurify()).toBe(ok);
  });

  it("#X3 EML body sanitize errors instead of returning unsanitized markup", async () => {
    fake.instances = [passThrough()];
    const { sanitizeBody } = await import("../eml.js");
    await expect(sanitizeBody("<p>MARKER</p>", { allowRemote: false })).rejects.toThrow(/DOMPurify unavailable/);
  });

  it("#X3 PlantUML SVG sanitize errors instead of returning unsanitized markup", async () => {
    fake.instances = [passThrough()];
    const { renderDiagram, clearDiagramCache } = await import("../diagram-render.js");
    clearDiagramCache();
    const fetchFn = vi.fn(async () => new Response("<svg>MARKER</svg>", { status: 200 })) as unknown as typeof fetch;
    const res = await renderDiagram("plantuml", "@startuml\nA -> B\n@enduml", {
      envOverride: "https://kroki.example",
      fetchFn,
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain("<svg>MARKER");
  });
});
