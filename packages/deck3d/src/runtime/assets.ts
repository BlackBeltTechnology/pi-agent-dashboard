/**
 * Runtime deck-asset registry (design D3, spec deck3d-slide-layers "Assets
 * are ready before the first frame"). Every embedded asset is decoded BEFORE
 * slides are built: images to a decoded `HTMLImageElement` (SVG included),
 * JSON parsed, text decoded, fonts registered as a `FontFace` whose family
 * name `get` returns. `get` is synchronous and throws for an unknown id.
 */

export interface EmbeddedAsset {
  id: string;
  mime: string;
  data: string;
}

/** The read-only accessor effects receive as `ctx.assets`. */
export interface AssetAccessor {
  get(id: string): unknown;
  has(id: string): boolean;
  ids(): string[];
}

function base64Bytes(dataUri: string): Uint8Array {
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decodeOne(a: EmbeddedAsset): Promise<unknown> {
  if (a.mime.startsWith("image/")) {
    const img = new Image();
    img.decoding = "sync";
    img.src = a.data;
    await img.decode();
    return img;
  }
  if (a.mime === "font/ttf" || a.mime === "font/otf") {
    const family = `deck3d-${a.id}`;
    const face = new FontFace(family, base64Bytes(a.data).buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    return family;
  }
  const text = new TextDecoder().decode(base64Bytes(a.data));
  return a.mime === "application/json" ? JSON.parse(text) : text;
}

export function makeAccessor(values: Map<string, unknown>): AssetAccessor {
  return Object.freeze({
    get(id: string): unknown {
      if (!values.has(id)) throw new Error(`unknown asset '${id}'`);
      return values.get(id);
    },
    has: (id: string) => values.has(id),
    ids: () => [...values.keys()],
  });
}

/** Decode every embedded asset; a failing asset is reported and left out. */
export async function loadDeckAssets(embedded: EmbeddedAsset[] | undefined): Promise<{ accessor: AssetAccessor; failed: string[] }> {
  const values = new Map<string, unknown>();
  const failed: string[] = [];
  await Promise.all(
    (embedded ?? []).map(async (a) => {
      try {
        values.set(a.id, await decodeOne(a));
      } catch (err) {
        failed.push(a.id);
        console.error(`deck asset ${a.id} failed to decode:`, err);
      }
    }),
  );
  return { accessor: makeAccessor(values), failed: failed.sort() };
}
