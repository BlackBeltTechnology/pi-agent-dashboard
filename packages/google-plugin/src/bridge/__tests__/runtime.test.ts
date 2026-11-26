/**
 * L1 shared product tool runtime (test-plan #C1–#C12, #C24–#C26; tasks 12.1–12.12, 12.24–12.26): account
 * resolution, confirm-before-API ordering, headless block, level/disabled gate, registration. Driven through
 * synthetic per-product probe tools so every product is covered. See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { activateWith, GUARD_REGISTRY_SYMBOL } from "../index.js";
import { LIST_PAGE_SIZE, pageSize, pageText, TEXT_PAGE_CHARS } from "../paging.js";
import { clip, joinSummary, listed, rowLines } from "../preview.js";
import { buildTools, createRuntime } from "../runtime.js";
import { PRODUCT_TOOLS } from "../tools/index.js";
import { createFakeGoogle, type HostAccount, jsonOf, makeToolHost, NO_UI, textOf, uiCtx } from "./fake-google.js";
import { allProbes, PRODUCTS_7 } from "./probe-tools.js";

const ALL_WRITE = Object.fromEntries(PRODUCTS_7.map((p) => [p, "write"])) as HostAccount["products"];
const ALL_READ = Object.fromEntries(PRODUCTS_7.map((p) => [p, "read"])) as HostAccount["products"];
const A: HostAccount = { sub: "s1", email: "a@blackbelt.hu", alias: "work", products: ALL_WRITE };
const B: HostAccount = { sub: "s2", email: "b@semmi.se", products: ALL_WRITE };

function host(accounts: HostAccount[] = [A, B], runtime: Parameters<typeof makeToolHost>[0] extends infer O ? (O extends { runtime?: infer R } ? R : never) : never = {}) {
  const google = createFakeGoogle().on("GET", "/ping", { json: { ok: true } }).on("POST", "/touch", { json: { done: true } });
  return makeToolHost({ accounts, google, products: allProbes(), runtime });
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string }) => e);

describe("#C1–#C5 account resolution (alias → unique email → ambiguous / not_found)", () => {
  it("#C1 an alias picks that account's token and no other", async () => {
    const h = host();
    await h.run("probe_calendar_read", { account: "work" });
    expect(h.google.tokens()).toEqual([h.tokenOf("s1")]);
  });

  it("#C2 an email (no alias) resolves to that account", async () => {
    const h = host();
    await h.run("probe_calendar_read", { account: "b@semmi.se" });
    expect(h.google.tokens()).toEqual([h.tokenOf("s2")]);
  });

  it("#C3 a shared alias, or one email in two cases, is `ambiguous`, lists the candidates, makes no HTTP call", async () => {
    for (const accounts of [
      [A, { ...B, alias: "work" }],
      [{ ...A, alias: undefined }, { ...B, email: "A@Blackbelt.hu" }],
    ] as HostAccount[][]) {
      const h = host(accounts);
      const e = await err(h.run("probe_calendar_read", { account: accounts[0]?.alias ?? "a@blackbelt.hu" }));
      expect(e?.code).toBe("ambiguous");
      expect(e?.message).toMatch(/a@blackbelt\.hu/i);
      expect(e?.message).toMatch(/b@semmi\.se|A@Blackbelt\.hu/i);
      expect(h.google.calls).toHaveLength(0);
      expect(h.leaseCalls()).toHaveLength(0);
    }
  });

  it("#C4 unknown → `not_found`; empty / omitted → an argument error (never a default account); 0 HTTP calls", async () => {
    const h = host();
    expect((await err(h.run("probe_calendar_read", { account: "nobody@x.com" })))?.code).toBe("not_found");
    for (const params of [{ account: "" }, {}, { account: "  " }]) {
      const e = await err(h.run("probe_calendar_read", params));
      expect(e?.code).toBe("invalid_params");
      expect(e?.message).toContain("a@blackbelt.hu");
    }
    expect(h.google.calls).toHaveLength(0);
    expect(h.leaseCalls()).toHaveLength(0);
  });

  it("#C5 an alias equal to another account's email wins (alias first) — documented order, no wrong pick", async () => {
    const h = host([A, { ...B, alias: "a@blackbelt.hu" }]);
    await h.run("probe_calendar_read", { account: "a@blackbelt.hu" });
    expect(h.google.tokens()).toEqual([h.tokenOf("s2")]);
  });

  it("leases `google/lease` with the tool's own product and level, by sub", async () => {
    const h = host();
    await h.run("probe_docs_read", { account: "work" });
    expect(h.leaseCalls().map((l) => l.payload)).toEqual([{ account: "s1", product: "docs", level: "read" }]);
  });
});

describe("#C6 confirm write", () => {
  const answers = [
    ["allow", () => uiCtx(true), 1],
    ["deny", () => uiCtx(false), 0],
    ["dismiss (confirm throws)", () => uiCtx("throw"), 0],
    ["timeout (never answers)", () => uiCtx("never"), 0],
  ] as const;

  for (const [name, make, writes] of answers) {
    it(`${name} × 7 write tools → ${writes} write request(s)`, async () => {
      const h = host([A, B], { confirmTimeoutMs: 30 });
      for (const p of PRODUCTS_7) {
        const { ctx } = make();
        const before = h.google.writes().length;
        const e = await err(h.run(`probe_${p}_write`, { account: "work" }, ctx));
        expect(h.google.writes().length - before).toBe(writes);
        if (writes) expect(e).toBeUndefined();
        else expect(e?.code).toBe("denied");
        if (name.startsWith("timeout")) expect(e?.message).toMatch(/timed out/);
      }
    });
  }

  it("asks BEFORE leasing: no lease and no request exist while the dialog is open", async () => {
    const h = host();
    const seen: number[] = [];
    const { ctx } = uiCtx(async () => {
      seen.push(h.leaseCalls().length, h.google.calls.length);
      return true;
    });
    await h.run("probe_sheets_write", { account: "work" }, ctx);
    expect(seen).toEqual([0, 0]);
    expect(h.leaseCalls()).toHaveLength(1);
  });
});

describe("#C7/#C8 headless", () => {
  it("#C7 no UI × 7 write tools → `blocked`, confirm never invoked, 0 requests", async () => {
    const h = host();
    for (const p of PRODUCTS_7) {
      for (const ctx of [NO_UI, undefined, { hasUI: true }]) {
        expect((await err(h.run(`probe_${p}_write`, { account: "work" }, ctx)))?.code).toBe("blocked");
      }
    }
    expect(h.google.calls).toHaveLength(0);
    const { ctx, confirm } = uiCtx(true);
    expect((await err(h.run("probe_tasks_write", { account: "work" }, { ...ctx, hasUI: false })))?.code).toBe("blocked");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("#C8 a read tool needs no UI", async () => {
    const h = host();
    const r = await h.run("probe_drive_read", { account: "work" }, NO_UI);
    expect(jsonOf(r)).toEqual({ ok: true });
  });
});

describe("#C9–#C11 confirm preview", () => {
  it("#C9 shows the account email and the product fields, never a token", async () => {
    const h = host();
    const { ctx, confirm } = uiCtx(true);
    await h.run("probe_slides_write", { account: "work" }, ctx);
    const [title, message] = confirm.mock.calls[0] as [string, string];
    expect(message).toContain("Account: a@blackbelt.hu");
    expect(message).toContain("Field: x");
    expect(title).toContain("Google Slides");
    expect(`${title}${message}`).not.toMatch(/ACCESS-|REFRESH-/);
  });

  it("#C10 a 100 000-char body is bounded in the dialog (marker + total) but sent whole", async () => {
    const h = host();
    const { ctx, confirm } = uiCtx(true);
    const text = "x".repeat(100_000);
    await h.run("probe_docs_write", { account: "work", text }, ctx);
    const message = (confirm.mock.calls[0] as [string, string])[1];
    expect(message.length).toBeLessThan(700);
    expect(message).toContain("(100000 chars)");
    expect((h.google.writes()[0]?.body as { text: string } | undefined)?.text).toHaveLength(100_000);
  });

  it("#C10 helpers: ≤ 20 targets then `+N more`, first 5 rows, whole summary bounded", () => {
    const many = Array.from({ length: 500 }, (_, i) => `u${i}@x.com`);
    const l = listed(many);
    expect(l).toContain("u19@x.com");
    expect(l).not.toContain("u20@x.com");
    expect(l).toContain("+480 more (500 total)");
    const rows = rowLines(Array.from({ length: 8 }, (_, i) => `row${i}`));
    expect(rows).toEqual(["- row0", "- row1", "- row2", "- row3", "- row4", "\u2026 +3 more rows (8 total)"]);
    const j = joinSummary(["y".repeat(5000)]);
    expect(j.length).toBeLessThan(2100);
    expect(j).toMatch(/\(5000 chars\)$/);
    expect(clip("short")).toBe("short");
  });

  it("#C11 newlines, ANSI escapes, RTL overrides and very long lines are neutralised; the dialog still opens", async () => {
    const h = host();
    const { ctx, confirm } = uiCtx(true);
    const text = `line1\nline2\r\n\u001b[31mred\u001b[0m \u202etxt\u2066 ${"w".repeat(2000)}`;
    await h.run("probe_docs_write", { account: "work", text }, ctx);
    const message = (confirm.mock.calls[0] as [string, string])[1];
    expect(message).not.toMatch(/[\u001b\r\u202e\u2066]/);
    expect(message.split("\n")).toEqual(["Account: a@blackbelt.hu", expect.stringMatching(/^Text: line1 line2 \[31mred \[0m txt w+\u2026 \(\d+ chars\)$/), "Field: x"]);
    expect(h.google.writes()).toHaveLength(1);
  });
});

describe("#C12 confirm ordering", () => {
  it("an allow that arrives after the account was disconnected makes no API call and fails with an account error", async () => {
    const h = host();
    const { ctx } = uiCtx(async () => {
      await h.disconnect("s1");
      return true;
    });
    const e = await err(h.run("probe_calendar_write", { account: "work" }, ctx));
    expect(e?.code).toBe("not_found");
    expect(h.google.calls).toHaveLength(0);
  });
});

describe("#C24 level / disabled gate (7 products × read / write tools)", () => {
  const states = [
    ["disabled", {}],
    ["read", ALL_READ],
    ["write", ALL_WRITE],
  ] as const;

  for (const p of PRODUCTS_7) {
    for (const [state, products] of states) {
      it(`${p} ${state}`, async () => {
        const h = host([{ sub: "s1", email: "a@x.com", alias: "work", products }]);
        const { ctx, confirm } = uiCtx(true);
        const read = await err(h.run(`probe_${p}_read`, { account: "work" }, ctx));
        const write = await err(h.run(`probe_${p}_write`, { account: "work" }, ctx));
        const calls = h.google.calls.length;
        if (state === "disabled") {
          for (const e of [read, write]) {
            expect(e?.code).toBe("product_disabled");
            expect(e?.message).toContain("Settings \u2192 Google");
            expect(e?.message).toContain("a@x.com");
          }
          expect(calls + confirm.mock.calls.length + h.leaseCalls().length).toBe(0);
        } else if (state === "read") {
          expect(read).toBeUndefined();
          expect(write?.code).toBe("level_insufficient");
          expect(write?.message).toContain("Settings \u2192 Google accounts");
          expect(confirm).not.toHaveBeenCalled();
          expect(h.google.writes()).toHaveLength(0);
          expect(calls).toBe(1);
        } else {
          expect(read).toBeUndefined();
          expect(write).toBeUndefined();
          expect(calls).toBe(2);
        }
      });
    }
  }

  it("a lowered level is refused on the very next call (no bridge cache)", async () => {
    const h = host();
    await h.run("probe_docs_read", { account: "work" });
    await h.store.setProduct("s1", "docs", undefined);
    expect((await err(h.run("probe_docs_read", { account: "work" })))?.code).toBe("product_disabled");
    expect(h.google.calls).toHaveLength(1);
  });
});

describe("#C25 tool registration", () => {
  it("registers only tools of known product prefixes; no delete/share/permanent tools for Drive or Contacts", () => {
    const { tools } = buildTools(createRuntime({ endpoints: { issuer: "http://127.0.0.1:9", authorize: "", token: "", revoke: "", overridden: true } }), PRODUCT_TOOLS);
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toMatch(/^g(cal|drive|docs|sheets|slides|tasks|contacts)_[a-z_]+$/);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names.filter((x) => /^g(drive|contacts)_/.test(x))) expect(n).not.toMatch(/delete|share|permanent|trash_empty/);
    expect(names).not.toContain("gdrive_delete");
    expect(names).not.toContain("gdrive_share");
    expect(names).not.toContain("gcontacts_delete");
  });

  it("activate registers every tool and declares reads `untrusted` / writes `selfConfirming` to the guard", () => {
    const registered: string[] = [];
    const g = globalThis as unknown as Record<symbol, unknown>;
    const before = g[GUARD_REGISTRY_SYMBOL];
    delete g[GUARD_REGISTRY_SYMBOL];
    try {
      activateWith({ registerTool: (t: { name: string }) => registered.push(t.name) }, { endpoints: { issuer: "http://127.0.0.1:9", authorize: "", token: "", revoke: "", overridden: true } });
      const reg = g[GUARD_REGISTRY_SYMBOL] as { declarations: Array<{ kind: string; names: string[] }> };
      const untrusted = reg.declarations.find((d) => d.kind === "untrusted")?.names ?? [];
      const self = reg.declarations.find((d) => d.kind === "selfConfirming")?.names ?? [];
      expect([...untrusted, ...self].sort()).toEqual([...registered].sort());
      expect(untrusted).toContain("gcal_events");
      expect(self).toContain("gcal_event_create");
      expect(self).not.toContain("gcal_events");
    } finally {
      if (before) g[GUARD_REGISTRY_SYMBOL] = before;
      else delete g[GUARD_REGISTRY_SYMBOL];
    }
  });

  it("is inert without a registerTool host", () => {
    expect(() => activateWith({}, {})).not.toThrow();
  });
});

describe("#C26 reads: compact JSON, paged", () => {
  it("results are compact JSON flagged untrusted, with the account", async () => {
    const h = host();
    const r = await h.run("probe_docs_read", { account: "work" });
    expect(textOf(r)).toBe('{"ok":true}');
    expect(r.details).toMatchObject({ untrusted: true, account: "a@blackbelt.hu" });
  });

  it("list pages hold ≤ 50 items; text pages 20 000 chars with a nextOffset until the end", () => {
    expect(pageSize(undefined)).toBe(LIST_PAGE_SIZE);
    expect(pageSize(500)).toBe(50);
    expect(pageSize(0)).toBe(1);
    expect(pageSize(7.9)).toBe(7);
    const text = "z".repeat(TEXT_PAGE_CHARS * 2 + 5);
    const p1 = pageText(text);
    expect(p1).toMatchObject({ offset: 0, nextOffset: TEXT_PAGE_CHARS, total: text.length });
    expect(p1.text).toHaveLength(TEXT_PAGE_CHARS);
    const p3 = pageText(text, TEXT_PAGE_CHARS * 2);
    expect(p3.text).toHaveLength(5);
    expect(p3.nextOffset).toBeUndefined();
    expect(pageText(text, -4).offset).toBe(0);
    expect(pageText("abc", 99).text).toBe("");
  });
});
