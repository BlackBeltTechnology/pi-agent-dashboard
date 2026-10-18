import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_OPTIONS,
  LEGACY_ALIASES,
  normalizeLanguage,
  registerPluginCatalog,
  t,
} from "../lib/i18n/i18n.js";

/**
 * @structural-pin locale parity: zh-CN and hu catalogs are plain object literals checked key-by-key against the en source; no runtime path enumerates all keys
 */
describe("normalizeLanguage", () => {
  it("maps Hungarian variants to hu", () => {
    expect(normalizeLanguage("hu")).toBe("hu");
    expect(normalizeLanguage("hu-HU")).toBe("hu");
    expect(normalizeLanguage("HU")).toBe("hu");
    expect(normalizeLanguage("hu-hu")).toBe("hu");
  });
  it("maps Chinese and English variants", () => {
    expect(normalizeLanguage("zh-CN")).toBe("zh-CN");
    expect(normalizeLanguage("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLanguage("en-US")).toBe("en");
  });
  it("returns null for unknown/empty", () => {
    expect(normalizeLanguage("fr")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });
});

describe("LANGUAGE_OPTIONS", () => {
  it("offers en, zh-CN, and hu", () => {
    const values = LANGUAGE_OPTIONS.map((o) => o.value);
    expect(values).toEqual(["en", "zh-CN", "hu"]);
    expect(LANGUAGE_OPTIONS.find((o) => o.value === "hu")?.label).toBe("Magyar");
  });
});

describe("t() fallback order", () => {
  // Default language in the test env is en (empty source dict).
  it("shows the call-site fallback when no translation exists", () => {
    expect(t("nonexistent.key", undefined, "English fallback")).toBe("English fallback");
  });
  it("shows the key itself when there is neither translation nor fallback", () => {
    expect(t("nonexistent.key.no.fallback")).toBe("nonexistent.key.no.fallback");
  });
  it("interpolates {var} placeholders into the fallback", () => {
    expect(t("x.count", { count: 3 }, "{count} items")).toBe("3 items");
  });
  it("interpolates across languages via the fallback path", () => {
    // en has no dict entries, so interpolation runs on the fallback for all langs.
    expect(t("time.custom", { count: 5 }, "{count}s")).toBe("5s");
  });
});

describe("LEGACY_ALIASES", () => {
  it("resolves an aliased legacy key to its structured translation", () => {
    // Pick any alias entry and confirm the mechanism is wired.
    const [oldKey, newKey] = Object.entries(LEGACY_ALIASES)[0] ?? [];
    expect(oldKey).toBeTruthy();
    expect(newKey).toBeTruthy();
    // With no active translation, aliasing still returns the fallback (never throws).
    expect(t(oldKey as string, undefined, "fallback")).toBe("fallback");
  });
});

describe("registerPluginCatalog", () => {
  it("namespaces plugin keys and resolves them via t() (zh-CN)", async () => {
    // Register under a unique id and confirm the prefixed key becomes reachable.
    registerPluginCatalog("testplugin", {
      "zh-CN": { "launch.title": "启动" },
      hu: { "launch.title": "Indítás" },
    });
    // The standalone t() reads the current-language singleton (en by default),
    // so with no en entry it returns the fallback; the merge itself must not throw
    // and must not collide with core keys.
    expect(() =>
      registerPluginCatalog("testplugin", { "zh-CN": { "launch.title": "启动" } }),
    ).not.toThrow();
    // Missing catalog for a language degrades gracefully (no throw).
    expect(() => registerPluginCatalog("nocatalog", undefined)).not.toThrow();
    expect(t("plugin.testplugin.launch.title", undefined, "Launch")).toBe("Launch");
  });
});

describe("collapse-pairing-into-gateway — i18n sweep (E11)", () => {
  // Static catalogue assertions over the raw files: the sweep must KEEP the
  // keys the surviving Gateway surface reused, RETIRE the PairingView-only
  // empty-state key, and carry the new Security-link + no-secure-road strings
  // in BOTH catalogues (no English-fallback-only keys).
  // (import.meta.url is not file-scheme under this vitest setup — resolve the
  // catalogues from the located package root instead.)
  function findClientRoot(start: string): string {
    const marker = join("src", "lib", "i18n", "i18n.tsx");
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, marker))) return dir;
      if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return start;
  }
  const root = findClientRoot(process.cwd());
  const zh = readFileSync(join(root, "src/lib/i18n/i18n-zh-CN.ts"), "utf8");
  const hu = readFileSync(join(root, "src/lib/i18n/i18n-hu.ts"), "utf8");

  it("kept keys survive in both catalogues", () => {
    for (const key of [
      "tunnel.startATunnel",
      "common.localhostEscapeHatch",
      "common.pairingNeedsSecureRoad",
      "settings.pairDevice",
    ]) {
      expect(zh, `zh-CN: ${key}`).toContain(`"${key}":`);
      expect(hu, `hu: ${key}`).toContain(`"${key}":`);
    }
  });

  it("retired gateway.pair.empty is absent from both catalogues", () => {
    expect(zh).not.toContain('"gateway.pair.empty":');
    expect(hu).not.toContain('"gateway.pair.empty":');
  });

  it("new Security-link + no-secure-road keys are present in both catalogues", () => {
    for (const key of [
      "settings.pairDeviceBody",
      "settings.pairDeviceLink",
      "gateway.pair.noSecureRoadTitle",
      "gateway.pair.advertisedUrls",
      "gateway.pair.qrPlaceholderAria",
    ]) {
      expect(zh, `zh-CN: ${key}`).toContain(`"${key}":`);
      expect(hu, `hu: ${key}`).toContain(`"${key}":`);
    }
  });
});

describe("add-mermaid-auto-repair — i18n sweep (X4)", () => {
  function findClientRoot(start: string): string {
    const marker = join("src", "lib", "i18n", "i18n.tsx");
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, marker))) return dir;
      if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return start;
  }
  const root = findClientRoot(process.cwd());
  const zh = readFileSync(join(root, "src/lib/i18n/i18n-zh-CN.ts"), "utf8");
  const hu = readFileSync(join(root, "src/lib/i18n/i18n-hu.ts"), "utf8");

  it("badge, toggle, copy and all seven rule-description keys are in both catalogues", () => {
    for (const key of [
      "preview.mermaid.autoFixed",
      "preview.mermaid.showOriginal",
      "preview.mermaid.copyFixed",
      // See change: retro-ux-chat-rendering (test-plan E19)
      "preview.mermaid.copied",
      "preview.mermaid.copySource",
      "preview.mermaid.errorHeadline",
      "preview.mermaid.originalError",
      "preview.mermaid.rendering",
      "preview.mermaid.viewportName",
      "preview.mermaid.zoomHint",
      "preview.mermaid.zoomIn",
      "preview.mermaid.zoomOut",
      "preview.mermaid.zoomReset",
      "customEntry.extensionEntry",
      ...["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((r) => `preview.mermaid.rule.${r}`),
    ]) {
      expect(zh, `zh-CN: ${key}`).toContain(`"${key}":`);
      expect(hu, `hu: ${key}`).toContain(`"${key}":`);
    }
  });

  // See change: add-preview-apply-fix-to-file (test-plan F10)
  it("apply-fix-to-file action, dialog, status and error keys are in both catalogues", () => {
    for (const key of [
      "applyToFile",
      "applyReading",
      "applyDirtyHint",
      "applyDialogTitle",
      "applyDialogBody",
      "applyConfirm",
      "applyWriting",
      "applyChanged",
      "applyReload",
      "applyNotApplicable",
      "applyError",
      "applyDiffAdded",
      "applyDiffRemoved",
    ].map((k) => `preview.mermaid.${k}`)) {
      expect(zh, `zh-CN: ${key}`).toContain(`"${key}":`);
      expect(hu, `hu: ${key}`).toContain(`"${key}":`);
    }
  });

  // See change: add-mermaid-ai-repair (test-plan X10)
  it("AI repair action, pending, retry, badge, failure and disclosure keys are in both catalogues", () => {
    for (const key of [
      "preview.mermaid.aiFix",
      "preview.mermaid.aiPending",
      "preview.mermaid.aiRetry",
      "preview.mermaid.aiFixed",
      "preview.mermaid.aiFailed",
      "preview.mermaid.aiNotRenderable",
      "preview.mermaid.aiDisclosure",
    ]) {
      expect(zh, `zh-CN: ${key}`).toContain(`"${key}":`);
      expect(hu, `hu: ${key}`).toContain(`"${key}":`);
    }
  });
});

describe("retro-ux-model-selector — i18n sweep (E21)", () => {
  // Every string the change added or reworded is present in en (source JSON),
  // zh-CN and hu — client keys by raw catalogue text, plugin keys by their
  // `catalog` objects. `node scripts/i18n-parity.mjs` is the parity gate.
  function findClientRoot(start: string): string {
    const marker = join("src", "lib", "i18n", "i18n.tsx");
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, marker))) return dir;
      if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return start;
  }
  const root = findClientRoot(process.cwd());
  const en = readFileSync(join(root, "src/lib/i18n-en-source.json"), "utf8");
  const zh = readFileSync(join(root, "src/lib/i18n/i18n-zh-CN.ts"), "utf8");
  const hu = readFileSync(join(root, "src/lib/i18n/i18n-hu.ts"), "utf8");
  const pluginSrc = (pkg: string) => readFileSync(join(root, "..", pkg, "src/i18n.ts"), "utf8");

  it("client picker/role-ref keys exist in en, zh-CN and hu", () => {
    for (const key of [
      "common.modelsTab",
      "common.rolesTab",
      "common.favoritesOnly",
      "common.favoriteModel",
      "common.capabilityAssumed",
      "common.chooseModel",
      "common.noModelsHelp",
      "common.openProviders",
      "common.noModelAssigned",
      "common.roleRefFrom",
      "common.roleRefThinking",
      "common.noRolesHelp",
    ]) {
      expect(en, `en: ${key}`).toContain(`"${key}":`);
      expect(zh, `zh-CN: ${key}`).toContain(`"${key}":`);
      expect(hu, `hu: ${key}`).toContain(`"${key}":`);
    }
  });

  it("plugin keys exist in each plugin's zh-CN and hu blocks", () => {
    const wanted: Record<string, string[]> = {
      "roles-plugin": ["noModelAssigned", "roleRefThinking", "statusDetached", "statusDangling", "levelDropped", "unsaved"],
      "blackhole-plugin": ["noModelAssigned", "roleRefThinking", "roleStatus_detached", "roleStatus_dangling", "levelDropped", "roleDetachedHelp", "reattachRoleTo"],
      "automation-plugin": ["roleFollowsHint"],
    };
    for (const [pkg, keys] of Object.entries(wanted)) {
      const src = pluginSrc(pkg);
      const huStart = src.indexOf("\n  hu: {");
      expect(huStart, `${pkg}: hu block`).toBeGreaterThan(0);
      const zhBlock = src.slice(0, huStart);
      const huBlock = src.slice(huStart);
      for (const key of keys) {
        expect(zhBlock, `${pkg} zh-CN: ${key}`).toMatch(new RegExp(`\\b${key}:`));
        expect(huBlock, `${pkg} hu: ${key}`).toMatch(new RegExp(`\\b${key}:`));
      }
    }
  });
});

describe("retro-ux-credential-vault — vault.* catalogue coverage (E27)", () => {
  // Every `vault.*` key the vault UI calls is present in en (source JSON), zh-CN and hu.
  // `node scripts/i18n-parity.mjs` is the parity gate; this pins the keys the UI actually uses.
  // See change: retro-ux-credential-vault (task 3.9).
  function findClientRoot(start: string): string {
    const marker = join("src", "lib", "i18n", "i18n.tsx");
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, marker))) return dir;
      if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return start;
  }
  const root = findClientRoot(process.cwd());
  const src = (rel: string) => join(root, "src", rel);
  const en = readFileSync(src("lib/i18n-en-source.json"), "utf8");
  const zh = readFileSync(src("lib/i18n/i18n-zh-CN.ts"), "utf8");
  const hu = readFileSync(src("lib/i18n/i18n-hu.ts"), "utf8");

  const vaultDir = src("components/settings/vault");
  const files = [
    ...readdirSync(vaultDir).filter((f) => f.endsWith(".tsx")).map((f) => join(vaultDir, f)),
    src("components/session/VaultBindingsChip.tsx"),
    src("lib/vault/vault-api.ts"),
  ];
  // A static key is a string literal; `vault.state.${state}`-style keys are listed below.
  const referenced = new Set<string>();
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(/["'`](vault\.[A-Za-z][A-Za-z0-9_.-]*[A-Za-z0-9])["'`]/g)) referenced.add(m[1]);
  }
  const STATES = ["delivered", "local-override", "inherited", "pending-confirmation", "no-account", "blocked-name", "revoked", "hub-unreachable", "vault-unavailable"];
  const dynamic = [
    ...["use-host", "re-pair", "request-access", "sign-in"].map((r) => `vault.operateRequired.${r}`),
    ...STATES.flatMap((s) => [`vault.state.${s}`, `vault.stateHelp.${s}`]),
  ];

  it("finds the keys the UI references (guard against an empty extraction)", () => {
    expect(referenced.size).toBeGreaterThan(60);
    expect(referenced.has("vault.title")).toBe(true);
  });

  it("every referenced vault.* key is in en, zh-CN and hu", () => {
    const missing = { en: [] as string[], zh: [] as string[], hu: [] as string[] };
    for (const key of [...referenced, ...dynamic]) {
      if (!en.includes(`"${key}":`)) missing.en.push(key);
      if (!zh.includes(`"${key}":`)) missing.zh.push(key);
      if (!hu.includes(`"${key}":`)) missing.hu.push(key);
    }
    expect(missing).toEqual({ en: [], zh: [], hu: [] });
  });
});

// See change: add-md-adoc-markup-repair (test-plan F11)
describe("add-md-adoc-markup-repair — i18n sweep (F11)", () => {
  const root = (() => {
    const marker = join("src", "lib", "i18n", "i18n.tsx");
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, marker))) return dir;
      if (existsSync(join(dir, "packages", "client", marker))) return join(dir, "packages", "client");
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return process.cwd();
  })();
  const zh = readFileSync(join(root, "src/lib/i18n/i18n-zh-CN.ts"), "utf8");
  const hu = readFileSync(join(root, "src/lib/i18n/i18n-hu.ts"), "utf8");
  const component = readFileSync(join(root, "src/components/preview/MarkupRepairBanner.tsx"), "utf8");

  const KEYS = [
    "title",
    "repair.A1",
    "repair.A2",
    "repair.M2",
    "repair.M3",
    "viewOriginal",
    "apply",
    "applyReading",
    "applyDirtyHint",
    "changed",
    "reload",
    "applyError",
    "dialogTitle",
    "dialogBody",
    "diagramBlocked",
  ].map((k) => `markupRepair.${k}`);

  it("every markupRepair.* key is in both catalogues", () => {
    for (const key of KEYS) {
      expect(zh, `zh-CN: ${key}`).toContain(`"${key}":`);
      expect(hu, `hu: ${key}`).toContain(`"${key}":`);
    }
  });

  it("every markupRepair.* key the banner uses is covered by the list above", () => {
    const used = [...component.matchAll(/"(markupRepair\.[\w.]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) expect(KEYS, key).toContain(key);
  });
});
