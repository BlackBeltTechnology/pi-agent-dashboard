#!/usr/bin/env python3
"""Merge the arm64 + x64 `latest-mac.yml` legs into one update-metadata file.

The two macOS matrix legs each emit their own `latest-mac.yml` listing a single
DMG in `files[]`. softprops dedups release assets by basename, so without a
merge one arch's metadata silently overwrites the other's.

Usage:  merge-latest-mac.py <latest-mac.yml> [<latest-mac.yml> ...]

The FIRST path is rewritten with the merged document; the remaining ones are
deleted, so only the merged file uploads. Called with a single path it is a
no-op (nothing to merge).

Extracted from an inline heredoc in `publish.yml` so the merge semantics — in
particular the `minimumSystemVersion` handling below, which gates the update
stream on the macOS floor — are reachable from a test.

See change: upgrade-electron-runtime (extraction) and
fix-electron-auto-update-pipeline (original merge).
"""

import os
import sys

import yaml


def merge(paths):
    """Return (merged_document, error_message). One of the two is None."""
    merged, seen, files = None, set(), []
    min_os = set()

    for p in paths:
        with open(p) as fh:
            d = yaml.safe_load(fh)
        if merged is None:
            merged = dict(d)
        for fe in d.get("files", []):
            if fe["url"] not in seen:
                seen.add(fe["url"])
                files.append(fe)
        min_os.add(d.get("minimumSystemVersion"))

    if not files:
        return None, "no files[] entries across the given latest-mac.yml legs"

    merged["files"] = files
    # path/sha512 mirror the first file for single-file legacy readers.
    merged["path"] = files[0]["url"]
    merged["sha512"] = files[0]["sha512"]

    # minimumSystemVersion gates the update stream on the OS floor. The merge
    # seeds root keys from whichever file the caller's glob yields FIRST, so if
    # only one arch leg injected the field the outcome would depend on glob
    # order rather than on intent. Require every leg to agree instead of
    # inheriting silently.
    if min_os != {None}:
        if len(min_os) != 1:
            return None, (
                "latest-mac.yml legs disagree on minimumSystemVersion: "
                + str(sorted(str(v) for v in min_os))
                + ". Every darwin leg must inject the same value, or the merged "
                "gate depends on glob order."
            )
        merged["minimumSystemVersion"] = next(iter(min_os))

    return merged, None


def main(argv):
    paths = argv[1:]
    if not paths:
        print("::error::merge-latest-mac.py: no latest-mac.yml paths given")
        return 1
    if len(paths) == 1:
        print(f"1 latest-mac.yml given — no merge needed ({paths[0]})")
        return 0

    merged, error = merge(paths)
    if error:
        print(f"::error::{error}")
        return 1

    with open(paths[0], "w") as fh:
        yaml.safe_dump(merged, fh, sort_keys=False)
    for extra in paths[1:]:
        os.remove(extra)
    print(
        f"Merged {len(merged['files'])} macOS file(s) into {paths[0]} "
        f"(minimumSystemVersion={merged.get('minimumSystemVersion')})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
