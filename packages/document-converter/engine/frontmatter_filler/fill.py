#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "ruamel.yaml>=0.18",
# ]
# ///
"""Fill or refresh YAML frontmatter metadata across a markdown tree.

See `../SKILL.md` for the full contract, layering model, and examples.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

yaml = YAML(typ="rt")
yaml.indent(mapping=2, sequence=4, offset=2)
yaml.preserve_quotes = True
yaml.width = 4096   # don't wrap long strings

# ---------------------------------------------------------------------------
# Built-in language pack
# ---------------------------------------------------------------------------

BUILTIN_LANGUAGES: dict[str, dict[str, str]] = {
    "en": {"toc_heading": "Table of Contents", "document_type": "TECHNICAL SPECIFICATION"},
    "hu": {"toc_heading": "Tartalomjegyzék",    "document_type": "MŰSZAKI SPECIFIKÁCIÓ"},
    "de": {"toc_heading": "Inhaltsverzeichnis", "document_type": "TECHNISCHE SPEZIFIKATION"},
    "fr": {"toc_heading": "Table des matières", "document_type": "SPÉCIFICATION TECHNIQUE"},
    "es": {"toc_heading": "Índice",             "document_type": "ESPECIFICACIÓN TÉCNICA"},
    "it": {"toc_heading": "Sommario",           "document_type": "SPECIFICA TECNICA"},
}

CANONICAL_ORDER: list[str] = [
    "template",
    "enable_cover_page",
    "enable_toc",
    "toc_heading",
    "project_name",
    "project_description",
    "logos",
    "document_type",
    "client_name",
    "version",
    "company_info",
    "document_id",
    "contact_info",
    "author",
    "language",
    "diagram_format",
    "diagram_width",
    "diagram_scale",
    "table_profiles",
]


# ---------------------------------------------------------------------------
# Frontmatter splitting
# ---------------------------------------------------------------------------

FM_DELIM = re.compile(r"^---\s*$")


def split_frontmatter(text: str) -> tuple[str | None, str]:
    """Return (frontmatter_body, body). `None` if no frontmatter."""
    lines = text.splitlines(keepends=True)
    if not lines or not FM_DELIM.match(lines[0].rstrip()):
        return None, text
    for i in range(1, len(lines)):
        if FM_DELIM.match(lines[i].rstrip()):
            return "".join(lines[1:i]), "".join(lines[i + 1:])
    return None, text


def load_yaml(text: str) -> CommentedMap:
    if not text.strip():
        return CommentedMap()
    data = yaml.load(text)
    if data is None:
        return CommentedMap()
    if not isinstance(data, CommentedMap):
        # Wrap into CommentedMap for consistent manipulation
        cm = CommentedMap()
        for k, v in data.items():
            cm[k] = v
        return cm
    return data


def dump_yaml(data: CommentedMap) -> str:
    import io
    buf = io.StringIO()
    yaml.dump(data, buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Auto-derivation
# ---------------------------------------------------------------------------

H1_RE = re.compile(r"^\s*#\s+(.+?)\s*$")


def first_h1(body: str) -> str | None:
    in_fence = False
    for line in body.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = H1_RE.match(line)
        if m:
            # Strip markdown emphasis around the title
            title = m.group(1)
            title = re.sub(r"\*\*(.+?)\*\*", r"\1", title)
            title = re.sub(r"\*(.+?)\*", r"\1", title)
            title = re.sub(r"`(.+?)`", r"\1", title)
            return title.strip()
    return None


def detect_language_from_path(path: Path, default: str = "en") -> str:
    stem = path.stem
    # e.g. DAPP-model-spec-v0.1.hu → "hu"
    if stem.endswith(".hu"):
        return "hu"
    if stem.endswith(".en"):
        return "en"
    if stem.endswith(".de"):
        return "de"
    if stem.endswith(".fr"):
        return "fr"
    if stem.endswith(".es"):
        return "es"
    if stem.endswith(".it"):
        return "it"
    return default


# ---------------------------------------------------------------------------
# Config loading and walking
# ---------------------------------------------------------------------------


def find_config(start: Path, explicit: Path | None) -> Path | None:
    if explicit:
        return explicit.expanduser().resolve()
    anchor = start.resolve()
    if anchor.is_file():
        anchor = anchor.parent
    for parent in [anchor, *anchor.parents]:
        for name in (".doc-meta.yaml", ".doc-meta.yml", ".agents/doc-meta.yaml", ".agents/doc-meta.yml"):
            cand = parent / name
            if cand.is_file():
                return cand
    return None


def load_config(path: Path) -> dict[str, Any]:
    data = yaml.load(path.read_text(encoding="utf-8"))
    if data is None:
        return {}
    return dict(data)


# ---------------------------------------------------------------------------
# Merge helpers
# ---------------------------------------------------------------------------


def deep_merge(base: dict, overlay: dict) -> dict:
    """Return a new dict merging overlay over base; nested dicts are merged."""
    if not isinstance(overlay, dict):
        return overlay  # type: ignore[return-value]
    result: dict = {}
    for k, v in base.items():
        result[k] = v
    for k, v in overlay.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def apply_dotted(mapping: dict, dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    cur = mapping
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def parse_set_overrides(pairs: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for p in pairs:
        if "=" not in p:
            raise SystemExit(f"--set expects key=value, got: {p!r}")
        k, v = p.split("=", 1)
        # Very small type coercion: booleans and integers
        if v.lower() in ("true", "false"):
            val: Any = (v.lower() == "true")
        elif v.lstrip("-").isdigit():
            val = int(v)
        else:
            val = v
        apply_dotted(out, k.strip(), val)
    return out


# ---------------------------------------------------------------------------
# File-level override resolution
# ---------------------------------------------------------------------------


def resolve_file_overrides(cfg: dict[str, Any], config_dir: Path, file_path: Path) -> dict:
    files_cfg = cfg.get("files") or {}
    if not files_cfg:
        return {}
    try:
        rel = str(file_path.resolve().relative_to(config_dir.resolve()))
    except ValueError:
        rel = str(file_path)
    matched: list[dict] = []
    for pattern, rules in files_cfg.items():
        if fnmatch.fnmatch(rel, pattern):
            if isinstance(rules, dict):
                matched.append(rules)
    if not matched:
        return {}
    merged: dict = {}
    for m in matched:
        merged = deep_merge(merged, m)
    return merged


def resolve_logo_path(logo_rel_from_config: str, config_dir: Path, file_path: Path) -> str:
    """Convert `images/foo.png` (relative to config dir) into a path relative to the file."""
    abs_logo = (config_dir / logo_rel_from_config).resolve()
    file_dir = file_path.resolve().parent
    try:
        rel = os.path.relpath(abs_logo, file_dir)
    except ValueError:
        rel = str(abs_logo)
    # Normalise on POSIX for consistency inside YAML
    return rel.replace(os.sep, "/")


# ---------------------------------------------------------------------------
# Canonical ordering
# ---------------------------------------------------------------------------


def reorder(data: CommentedMap) -> CommentedMap:
    out = CommentedMap()
    # 1. declared canonical keys in order
    for key in CANONICAL_ORDER:
        if key in data:
            out[key] = data[key]
    # 2. any remaining keys preserving their original order
    for key, value in data.items():
        if key not in out:
            out[key] = value
    return out


# ---------------------------------------------------------------------------
# Core merge
# ---------------------------------------------------------------------------


def compose_frontmatter(
    path: Path,
    cfg: dict[str, Any],
    config_dir: Path,
    existing: CommentedMap,
    mode: str,
    cli_overrides: dict[str, Any],
    forced_language: str | None,
    allow_derive: bool,
) -> CommentedMap:
    # Layer 1: auto-derived
    lang = forced_language or detect_language_from_path(
        path, default=(cfg.get("defaults", {}).get("language") or "en"),
    )
    derived: dict[str, Any] = {"language": lang}
    if allow_derive:
        lang_pack = BUILTIN_LANGUAGES.get(lang, {})
        if "toc_heading" in lang_pack:
            derived["toc_heading"] = lang_pack["toc_heading"]
        if "document_type" in lang_pack:
            derived["document_type"] = lang_pack["document_type"]
        h1 = first_h1(path.read_text(encoding="utf-8"))
        if h1:
            derived["project_name"] = h1

    # Layer 2: config defaults
    defaults = dict(cfg.get("defaults") or {})

    # Layer 3: config language pack
    langs = cfg.get("languages") or {}
    lang_overrides = dict(langs.get(lang) or {})

    # Layer 4: config per-file overrides (globs)
    file_overrides = resolve_file_overrides(cfg, config_dir, path)

    # Layer 4b: handle special `document_type_override: {en: ..., hu: ...}`
    if isinstance(file_overrides.get("document_type_override"), dict):
        override_map = file_overrides.pop("document_type_override")
        if lang in override_map:
            file_overrides["document_type"] = override_map[lang]

    # Compose layers 1→4 without touching the file yet
    merged: dict[str, Any] = {}
    for overlay in (derived, defaults, lang_overrides, file_overrides):
        merged = deep_merge(merged, overlay)

    # Resolve logos.company → path relative to the file
    logos = merged.get("logos")
    if isinstance(logos, dict) and logos.get("company"):
        merged["logos"] = {
            **logos,
            "company": resolve_logo_path(str(logos["company"]), config_dir, path),
        }

    # Layer 5: existing frontmatter (only in `fill` mode — existing wins)
    # Layer 4 precedes existing in `update` mode.
    # In `replace` mode, we skip existing entirely.
    if mode == "fill":
        result = deep_merge(merged, dict(existing))
    elif mode == "update":
        result = deep_merge(dict(existing), merged)
    elif mode == "replace":
        result = merged
    else:
        raise SystemExit(f"Unknown --mode: {mode!r}")

    # Layer 6: CLI overrides (highest)
    result = deep_merge(result, cli_overrides)

    # Convert nested plain dicts back into CommentedMap to preserve round-trip
    def to_cm(x: Any) -> Any:
        if isinstance(x, dict):
            cm = CommentedMap()
            for k, v in x.items():
                cm[k] = to_cm(v)
            return cm
        return x

    return to_cm(result)


# ---------------------------------------------------------------------------
# File processing
# ---------------------------------------------------------------------------


def process_file(
    path: Path,
    cfg: dict[str, Any],
    config_dir: Path,
    mode: str,
    cli_overrides: dict[str, Any],
    forced_language: str | None,
    allow_derive: bool,
    order: str,
    apply: bool,
    verbose: bool,
) -> bool:
    text = path.read_text(encoding="utf-8")
    fm_text, body = split_frontmatter(text)
    if fm_text is None and mode != "replace":
        if verbose:
            print(f"  [skip] {path}: no frontmatter (use --mode replace to create one)", file=sys.stderr)
        return False

    existing = load_yaml(fm_text) if fm_text is not None else CommentedMap()
    composed = compose_frontmatter(
        path=path,
        cfg=cfg,
        config_dir=config_dir,
        existing=existing,
        mode=mode,
        cli_overrides=cli_overrides,
        forced_language=forced_language,
        allow_derive=allow_derive,
    )

    if order == "canonical":
        composed = reorder(composed)

    new_fm_text = dump_yaml(composed)
    new_text = "---\n" + new_fm_text
    if not new_text.endswith("\n"):
        new_text += "\n"
    new_text += "---\n" + body

    changed = new_text != text
    if verbose:
        # Summarise diff in keys
        old_keys = set(existing.keys())
        new_keys = set(composed.keys())
        added = new_keys - old_keys
        removed = old_keys - new_keys
        changed_vals = {k for k in new_keys & old_keys if existing[k] != composed[k]}
        if added or removed or changed_vals:
            print(f"  [{mode}] {path}")
            for k in sorted(added):
                print(f"      + {k}: {composed[k]!r}")
            for k in sorted(changed_vals):
                print(f"      ~ {k}: {existing[k]!r} -> {composed[k]!r}")
            for k in sorted(removed):
                print(f"      - {k}: (was {existing[k]!r})")
        else:
            print(f"  [{mode}] {path}  (no changes)")

    if apply and changed:
        # Atomic write
        fd, tmp_path = tempfile.mkstemp(prefix=".fm.", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(new_text)
            shutil.move(tmp_path, path)
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise
    return changed


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def iter_markdown(paths: list[Path]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out.extend(sorted([f for f in p.rglob("*.md") if f.is_file()]))
        elif p.is_file() and p.suffix == ".md":
            out.append(p)
    return out


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Fill markdown YAML frontmatter from project-wide config.")
    p.add_argument("paths", nargs="+", type=Path)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--mode", choices=["fill", "update", "replace"], default="fill")
    p.add_argument("--config", type=Path, default=None)
    p.add_argument("--set", action="append", default=[])
    p.add_argument("--language", default=None)
    p.add_argument("--no-derive", action="store_true")
    p.add_argument("--order", choices=["canonical", "asis"], default="canonical")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    files = iter_markdown(args.paths)
    if not files:
        print("No markdown files found.", file=sys.stderr)
        return 2

    # Resolve the config relative to the first file
    cfg_path = find_config(files[0], args.config)
    if cfg_path is None:
        print("[warn] no config found; relying solely on CLI --set and auto-derivation", file=sys.stderr)
        cfg = {}
        config_dir = Path.cwd()
    else:
        cfg = load_config(cfg_path)
        config_dir = cfg_path.parent
        if args.verbose:
            print(f"[config] {cfg_path}")

    cli_overrides = parse_set_overrides(args.set)

    total = 0
    changed = 0
    for f in files:
        if process_file(
            path=f,
            cfg=cfg,
            config_dir=config_dir,
            mode=args.mode,
            cli_overrides=cli_overrides,
            forced_language=args.language,
            allow_derive=not args.no_derive,
            order=args.order,
            apply=args.apply,
            verbose=args.verbose,
        ):
            changed += 1
        total += 1

    print(f"\nProcessed {total} file(s); {changed} would change" + (" (written)" if args.apply else "") + ".")
    if not args.apply and changed:
        print("Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
