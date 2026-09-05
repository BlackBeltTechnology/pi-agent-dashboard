# 06-electron-offline-bundle.sh — index

Validate offline-packages bundle inside packaged Electron app Resources. Arg `<app-resources-dir>`. Checks `offline-packages/{manifest.json,npm-cache.tar.gz}` exist; node parses manifest (`sha256`, `packages[]`, `targetPlatform`); `shasum -a 256`/`sha256sum` verifies tarball hash against manifest. Exit 0 (warn-skip) if no checksum utility.
