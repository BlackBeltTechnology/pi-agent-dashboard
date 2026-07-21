# folder-encoding.ts — index

Base64url encode/decode for cwd paths in URL routes. Exports `encodeFolderPath(cwd)` (UTF-8 safe, URL-safe chars, strips padding) and `decodeFolderPath(encoded)` (returns `string | null`). For `/folder/:encodedCwd/*` routes.
