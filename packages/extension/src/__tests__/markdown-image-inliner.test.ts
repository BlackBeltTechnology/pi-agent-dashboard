/**
 * Tests for the bridge's markdown image inliner.
 * See change: chat-markdown-local-images-and-math.
 */
import { describe, it, expect } from "vitest";
import {
  inlineMessageText,
  inlineLocalImagePath,
  parseImageTokens,
  isLocalSrc,
  mimeFromExtension,
  hashBytes,
  resolveLocalPath,
  type AssetToEmit,
  type ReadFileError,
  type ReadFileOutcome,
} from "../markdown-image-inliner.js";

/** Build a fake `readFile` from an in-memory map. Missing keys → ENOENT. */
function fakeReader(files: Record<string, Buffer | "EACCES" | "EISDIR" | "EOTHER">) {
  return (absolutePath: string): ReadFileOutcome => {
    const v = files[absolutePath];
    if (v === undefined) return { ok: false, kind: "ENOENT" };
    if (v === "EACCES") return { ok: false, kind: "EACCES" };
    if (v === "EISDIR") return { ok: false, kind: "EISDIR" };
    if (v === "EOTHER") return { ok: false, kind: "EOTHER" };
    return { ok: true, bytes: v };
  };
}

const PNG = Buffer.from("png-bytes");
const PNG_2 = Buffer.from("different-png-bytes");
const SVG = Buffer.from("<svg/>");

describe("parseImageTokens", () => {
  it("matches a single image token", () => {
    const tokens = parseImageTokens("Hello ![pic](/abs/path.png) world");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].alt).toBe("pic");
    expect(tokens[0].src).toBe("/abs/path.png");
    expect(tokens[0].token).toBe("![pic](/abs/path.png)");
  });

  it("matches multiple image tokens", () => {
    const tokens = parseImageTokens("![a](/x.png) and ![b](/y.png)");
    expect(tokens.map((t) => t.src)).toEqual(["/x.png", "/y.png"]);
  });

  it("does not match partial token without closing paren", () => {
    const tokens = parseImageTokens("Hello ![pic](/abs/path");
    expect(tokens).toHaveLength(0);
  });

  it("does not match non-image link with single bracket", () => {
    const tokens = parseImageTokens("[click](/x.png)");
    expect(tokens).toHaveLength(0);
  });
});

describe("isLocalSrc", () => {
  it("treats data: / blob: / http(s): / pi-asset: / # as non-local", () => {
    expect(isLocalSrc("data:image/png;base64,XXX")).toBe(false);
    expect(isLocalSrc("blob:abc-123")).toBe(false);
    expect(isLocalSrc("http://x/y.png")).toBe(false);
    expect(isLocalSrc("https://x/y.png")).toBe(false);
    expect(isLocalSrc("pi-asset:abc1234567890123")).toBe(false);
    expect(isLocalSrc("#anchor")).toBe(false);
  });

  it("treats absolute and relative paths as local", () => {
    expect(isLocalSrc("/abs/x.png")).toBe(true);
    expect(isLocalSrc("./rel.png")).toBe(true);
    expect(isLocalSrc("../up.png")).toBe(true);
    expect(isLocalSrc("file:///a/b.png")).toBe(true);
  });
});

describe("mimeFromExtension", () => {
  it("matches case-insensitively", () => {
    expect(mimeFromExtension("/x/y.PNG")).toBe("image/png");
    expect(mimeFromExtension("/x/y.JpEg")).toBe("image/jpeg");
  });

  it("returns null for non-image extensions", () => {
    expect(mimeFromExtension("/x/y.txt")).toBe(null);
    expect(mimeFromExtension("/x/y")).toBe(null);
  });

  it("recognizes svg", () => {
    expect(mimeFromExtension("/x/y.svg")).toBe("image/svg+xml");
  });
});

describe("hashBytes", () => {
  it("produces 16 hex chars", () => {
    const h = hashBytes(Buffer.from("hello"));
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic", () => {
    expect(hashBytes(Buffer.from("hello"))).toBe(hashBytes(Buffer.from("hello")));
  });

  it("differs for different bytes", () => {
    expect(hashBytes(Buffer.from("a"))).not.toBe(hashBytes(Buffer.from("b")));
  });
});

describe("resolveLocalPath", () => {
  it("strips file:// prefix", () => {
    expect(resolveLocalPath("file:///abs/x.png", "/cwd")).toBe("/abs/x.png");
  });

  it("returns absolute paths as-is", () => {
    expect(resolveLocalPath("/abs/x.png", "/cwd")).toBe("/abs/x.png");
  });

  it("resolves relative paths against cwd", () => {
    expect(resolveLocalPath("./x.png", "/cwd")).toBe("/cwd/x.png");
  });
});

describe("inlineMessageText — pass-through cases", () => {
  it("external https URL passes through unchanged", () => {
    const r = inlineMessageText("![logo](https://example.com/logo.png)", {
      readFile: fakeReader({}),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe("![logo](https://example.com/logo.png)");
    expect(r.assetsToEmit).toEqual([]);
  });

  it("data: URL passes through unchanged", () => {
    const r = inlineMessageText("![](data:image/png;base64,XXX)", {
      readFile: fakeReader({}),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe("![](data:image/png;base64,XXX)");
    expect(r.assetsToEmit).toEqual([]);
  });

  it("blob: URL passes through unchanged", () => {
    const r = inlineMessageText("![](blob:abc-123)", {
      readFile: fakeReader({}),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe("![](blob:abc-123)");
    expect(r.assetsToEmit).toEqual([]);
  });

  it("partially-formed token (no closing paren) passes through unchanged", () => {
    const text = "streaming chunk ![pic](/home/me/shot.p";
    const r = inlineMessageText(text, {
      readFile: fakeReader({ "/home/me/shot.png": PNG }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe(text);
    expect(r.assetsToEmit).toEqual([]);
  });

  it("idempotent on text containing pi-asset tokens", () => {
    const text = "Here is ![pic](pi-asset:abc1234567890123)";
    const alreadyEmitted = new Set<string>(["abc1234567890123"]);
    const r1 = inlineMessageText(text, {
      readFile: fakeReader({}),
      cwd: "/c",
      alreadyEmitted,
    });
    const r2 = inlineMessageText(r1.rewritten, {
      readFile: fakeReader({}),
      cwd: "/c",
      alreadyEmitted,
    });
    expect(r1.rewritten).toBe(text);
    expect(r2.rewritten).toBe(text);
    expect(r1.assetsToEmit).toEqual([]);
    expect(r2.assetsToEmit).toEqual([]);
  });
});

describe("inlineMessageText — happy path", () => {
  it("inlines a single absolute-path local image", () => {
    const r = inlineMessageText("Here is ![pic](/home/me/shot.png) end", {
      readFile: fakeReader({ "/home/me/shot.png": PNG }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    const expectedHash = hashBytes(PNG);
    expect(r.rewritten).toBe(`Here is ![pic](pi-asset:${expectedHash}) end`);
    expect(r.assetsToEmit).toEqual([
      { hash: expectedHash, mimeType: "image/png", data: PNG.toString("base64") },
    ]);
  });

  it("inlines a relative-path image resolved against cwd", () => {
    const r = inlineMessageText("![pic](./shot.png)", {
      readFile: fakeReader({ "/work/shot.png": PNG }),
      cwd: "/work",
      alreadyEmitted: new Set(),
    });
    const expectedHash = hashBytes(PNG);
    expect(r.rewritten).toBe(`![pic](pi-asset:${expectedHash})`);
    expect(r.assetsToEmit).toHaveLength(1);
  });

  it("inlines an SVG as image/svg+xml", () => {
    const r = inlineMessageText("![diagram](/d.svg)", {
      readFile: fakeReader({ "/d.svg": SVG }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.assetsToEmit[0].mimeType).toBe("image/svg+xml");
    expect(r.rewritten).toContain("pi-asset:");
  });

  it("matches extension case-insensitively", () => {
    const r = inlineMessageText("![pic](/x/SHOT.PNG)", {
      readFile: fakeReader({ "/x/SHOT.PNG": PNG }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.assetsToEmit).toHaveLength(1);
    expect(r.assetsToEmit[0].mimeType).toBe("image/png");
  });
});

describe("inlineMessageText — dedup", () => {
  it("emits one asset for two refs to the same file in one message", () => {
    const r = inlineMessageText("![a](/same.png) and ![b](/same.png)", {
      readFile: fakeReader({ "/same.png": PNG }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.assetsToEmit).toHaveLength(1);
    const hash = hashBytes(PNG);
    expect(r.rewritten).toBe(`![a](pi-asset:${hash}) and ![b](pi-asset:${hash})`);
  });

  it("emits zero assets for refs to a hash already in alreadyEmitted", () => {
    const hash = hashBytes(PNG);
    const set = new Set<string>([hash]);
    const r = inlineMessageText("![pic](/same.png)", {
      readFile: fakeReader({ "/same.png": PNG }),
      cwd: "/c",
      alreadyEmitted: set,
    });
    expect(r.assetsToEmit).toEqual([]);
    expect(r.rewritten).toBe(`![pic](pi-asset:${hash})`);
  });

  it("dedup carries across multiple inliner invocations sharing the same Set", () => {
    const set = new Set<string>();
    const r1 = inlineMessageText("![a](/x.png)", {
      readFile: fakeReader({ "/x.png": PNG }),
      cwd: "/c",
      alreadyEmitted: set,
    });
    expect(r1.assetsToEmit).toHaveLength(1);
    const r2 = inlineMessageText("![b](/x.png)", {
      readFile: fakeReader({ "/x.png": PNG }),
      cwd: "/c",
      alreadyEmitted: set,
    });
    expect(r2.assetsToEmit).toEqual([]);
    expect(r2.rewritten).toBe(r1.rewritten.replace("![a]", "![b]"));
  });
});

describe("inlineMessageText — placeholder branches", () => {
  it("non-image extension yields [unsupported image type: ...]", () => {
    const r = inlineMessageText("![doc](/notes.txt)", {
      readFile: fakeReader({ "/notes.txt": Buffer.from("hi") }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe("[unsupported image type: /notes.txt]");
    expect(r.assetsToEmit).toEqual([]);
  });

  it("ENOENT yields [image not found: ...]", () => {
    const r = inlineMessageText("![x](/no/such.png)", {
      readFile: fakeReader({}),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe("[image not found: /no/such.png]");
  });

  it("EACCES is folded into [image not found: ...] (no permission leak)", () => {
    const r = inlineMessageText("![x](/root/private.png)", {
      readFile: fakeReader({ "/root/private.png": "EACCES" }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe("[image not found: /root/private.png]");
  });

  it("EISDIR yields [image read failed: ...]", () => {
    const r = inlineMessageText("![x](/home/me)", {
      readFile: fakeReader({ "/home/me": "EISDIR" }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toBe("[image read failed: /home/me]");
  });

  it("oversized image yields [image too large: ...]", () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0xab);
    const r = inlineMessageText("![pic](/big.png)", {
      readFile: fakeReader({ "/big.png": big }),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.rewritten).toMatch(/^\[image too large: \/big\.png \(6\.0 MB\)\]$/);
    expect(r.assetsToEmit).toEqual([]);
  });

  it("per-message budget exhausted after caps reached", () => {
    // Five distinct 4.5 MB images. First four fit (18 MB ≤ 20 MB cap), fifth
    // pushes total to 22.5 MB and is rejected.
    const make = (i: number) => Buffer.alloc(4.5 * 1024 * 1024, i);
    const files: Record<string, Buffer> = {};
    let text = "";
    for (let i = 0; i < 5; i++) {
      const p = `/img${i}.png`;
      files[p] = make(i);
      text += `![p${i}](${p}) `;
    }
    const r = inlineMessageText(text, {
      readFile: fakeReader(files),
      cwd: "/c",
      alreadyEmitted: new Set(),
    });
    expect(r.assetsToEmit).toHaveLength(4);
    expect(r.rewritten).toContain("[message asset budget exhausted: /img4.png]");
  });

  it("already-registered asset does not count against budget", () => {
    // 4 MB new + 18 MB already-registered → cumulative new bytes = 4 MB
    const newImg = Buffer.alloc(4 * 1024 * 1024, 1);
    const oldImg = Buffer.alloc(18 * 1024 * 1024, 2);
    const oldHash = hashBytes(oldImg);
    const r = inlineMessageText("![n](/new.png) ![o](/old.png)", {
      readFile: fakeReader({ "/new.png": newImg, "/old.png": oldImg }),
      cwd: "/c",
      alreadyEmitted: new Set([oldHash]),
    });
    expect(r.assetsToEmit).toHaveLength(1);
    expect(r.assetsToEmit[0].hash).toBe(hashBytes(newImg));
    expect(r.rewritten).toContain(`pi-asset:${hashBytes(newImg)}`);
    expect(r.rewritten).toContain(`pi-asset:${oldHash}`);
  });
});

describe("inlineLocalImagePath", () => {
  it("existing image path → AssetToEmit", () => {
    const r = inlineLocalImagePath("/abs/shot.png", {
      readFile: fakeReader({ "/abs/shot.png": PNG }),
    });
    expect("ok" in r).toBe(false);
    const asset = r as AssetToEmit;
    expect(asset.mimeType).toBe("image/png");
    expect(asset.hash).toBe(hashBytes(PNG));
    expect(asset.data).toBe(PNG.toString("base64"));
  });

  it("missing file → ENOENT error", () => {
    const r = inlineLocalImagePath("/no/such.png", { readFile: fakeReader({}) });
    expect(r).toEqual({ ok: false, kind: "ENOENT" } satisfies ReadFileError);
  });

  it("over MAX_PER_IMAGE_BYTES → TOO_LARGE error", () => {
    const big = Buffer.alloc(11);
    const r = inlineLocalImagePath("/big.png", {
      readFile: fakeReader({ "/big.png": big }),
      maxPerImageBytes: 10,
    });
    expect(r).toEqual({ ok: false, kind: "TOO_LARGE" } satisfies ReadFileError);
  });

  it("non-image extension → NOT_IMAGE error (skipped)", () => {
    const r = inlineLocalImagePath("/notes.txt", {
      readFile: fakeReader({ "/notes.txt": Buffer.from("hi") }),
    });
    expect(r).toEqual({ ok: false, kind: "NOT_IMAGE" } satisfies ReadFileError);
  });
});
