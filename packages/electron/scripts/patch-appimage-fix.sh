#!/bin/bash
# Patched version of @pengx17/electron-forge-maker-appimage's patch-apprun.sh
# Fixes: uses unsquashfs fallback when --appimage-extract fails (CI runners)
# Adds: ELECTRON_OZONE_PLATFORM_HINT=auto for Wayland support

set -euo pipefail

INPUT_APPIMAGE=$1
SYSTEM_ARCH="$(uname -m)"
APPIMAGETOOL_URL="https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-$SYSTEM_ARCH.AppImage"

TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

cd "$TMP_DIR"
cp "$INPUT_APPIMAGE" .

APP_IMAGE_TMP=$(basename -- "$INPUT_APPIMAGE")
chmod +x "$APP_IMAGE_TMP"

# Extract AppImage — try self-extract first, fall back to unsquashfs
if ! "./$APP_IMAGE_TMP" --appimage-extract 2>/dev/null; then
  echo "patch-apprun: self-extract failed, trying unsquashfs..."
  # AppImage = ELF header + squashfs. Find squashfs offset and extract.
  OFFSET=$(grep -aobP '\x68\x73\x71\x73' "$APP_IMAGE_TMP" | head -1 | cut -d: -f1)
  if [ -n "$OFFSET" ] && command -v unsquashfs &>/dev/null; then
    dd if="$APP_IMAGE_TMP" bs=1 skip="$OFFSET" of=appimage.squashfs 2>/dev/null
    unsquashfs -d squashfs-root appimage.squashfs
  else
    echo "patch-apprun: cannot extract AppImage, skipping Wayland patch"
    exit 0
  fi
fi

if [ ! -f "squashfs-root/AppRun" ]; then
  echo "patch-apprun: AppRun not found after extraction, skipping patch"
  exit 0
fi

# Patch AppRun to add ELECTRON_OZONE_PLATFORM_HINT=auto
file="squashfs-root/AppRun"
awk '
BEGIN { OFS=FS="\n" }
/export/ { lastExport=NR }
{ lines[NR]=$0 }
END {
    for (i=1; i<=NR; i++) {
        print lines[i]
        if (i == lastExport) {
            print "export ELECTRON_OZONE_PLATFORM_HINT=auto"
        }
    }
}' "$file" > tmpfile && mv tmpfile "$file"
chmod +x "$file"

# Download appimagetool and repack
wget -q -c "$APPIMAGETOOL_URL" -O appimagetool
chmod +x appimagetool

# appimagetool may need --appimage-extract-and-run on systems without FUSE.
# Newer appimagetool builds also require ARCH=<uname-m> explicitly — they no
# longer infer it from the AppDir contents and exit 1 with usage otherwise.
APPIMAGE_EXTRACT_AND_RUN=1 ARCH="$SYSTEM_ARCH" ./appimagetool ./squashfs-root/ "$INPUT_APPIMAGE"

echo "patch-apprun: Done."
