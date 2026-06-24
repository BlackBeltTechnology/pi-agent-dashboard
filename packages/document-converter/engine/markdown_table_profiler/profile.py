#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Auto-size markdown table columns and write `table_profiles:` frontmatter.

See `../SKILL.md` for the full description. Language-agnostic, heuristic,
re-runnable.

Usage:
    profile.py PATH [PATH ...] [--apply] [--dry-run]
                               [--percentile N] [--min-ratio R]
                               [--max-ratio R] [--language CODE]
                               [--profile-prefix STR] [--verbose]
"""
from __future__ import annotations

import argparse
import hashlib
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

# ---------------------------------------------------------------------------
# Markdown table parsing
# ---------------------------------------------------------------------------

ROW_RE = re.compile(r"^\s*\|(.+)\|\s*$")
SEP_RE = re.compile(r"^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$")
FENCE_RE = re.compile(r"^```")
FM_DELIM_RE = re.compile(r"^---\s*$")

EMPHASIS_RE = re.compile(r"(\*\*|__|\*|_)(.+?)\1")
STRIP_TOKENS_RE = re.compile(r"<[^>]+>")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
CODE_SPAN_RE = re.compile(r"`([^`]+)`")
HTML_BR_RE = re.compile(r"<br\s*/?>", flags=re.I)
SENTINEL_CELLS = {"", "—", "-", "–", "n/a", "na", "tbd", "todo", "—.", "— "}


def split_cells(line: str) -> list[str]:
    m = ROW_RE.match(line)
    if not m:
        return []
    return [c.strip() for c in m.group(1).split("|")]


def strip_fm(text: str) -> tuple[str | None, str | None, str]:
    """Return (opening_line, frontmatter_body, body) or (None, None, whole).

    Keeps the original newline conventions intact.
    """
    lines = text.splitlines(keepends=True)
    if not lines or not FM_DELIM_RE.match(lines[0].rstrip()):
        return None, None, text
    for i in range(1, len(lines)):
        if FM_DELIM_RE.match(lines[i].rstrip()):
            return lines[0], "".join(lines[1:i]), "".join(lines[i + 1:])
    return None, None, text


@dataclass
class Table:
    headers: list[str]
    rows: list[list[str]]
    line_no: int  # 0-based header line

    @property
    def n_cols(self) -> int:
        return len(self.headers)


def find_tables(body_text: str) -> list[Table]:
    """Locate every pipe table in body text, ignoring fenced code blocks."""
    lines = body_text.splitlines()
    out: list[Table] = []
    in_fence = False
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        # Toggle code fence state on `^```` lines (track to skip tables inside code blocks)
        if FENCE_RE.match(line):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence:
            i += 1
            continue
        header_cells = split_cells(line)
        if len(header_cells) >= 2 and i + 1 < n and SEP_RE.match(lines[i + 1]):
            headers = [c for c in header_cells]  # keep original; blanks become empty
            # Drop leading/trailing empty cells introduced by leading/trailing pipes
            if headers and headers[0] == "":
                headers = headers[1:]
            if headers and headers[-1] == "":
                headers = headers[:-1]
            n_cols = len(headers)
            if n_cols < 2:
                i += 1
                continue
            rows: list[list[str]] = []
            j = i + 2
            while j < n:
                ln = lines[j]
                if not ROW_RE.match(ln):
                    break
                cells = split_cells(ln)
                # same leading/trailing trim
                if cells and cells[0] == "":
                    cells = cells[1:]
                if cells and cells[-1] == "":
                    cells = cells[:-1]
                if len(cells) != n_cols:
                    # forgiving: pad or truncate
                    if len(cells) < n_cols:
                        cells = cells + [""] * (n_cols - len(cells))
                    else:
                        cells = cells[:n_cols]
                rows.append(cells)
                j += 1
            out.append(Table(headers=headers, rows=rows, line_no=i))
            i = j
        else:
            i += 1
    return out


# ---------------------------------------------------------------------------
# Width measurement
# ---------------------------------------------------------------------------


def normalise_text(cell: str) -> str:
    """Strip markdown syntax that doesn't contribute to visual width."""
    text = HTML_BR_RE.sub("\n", cell)
    # links → keep anchor text, URL handled separately as unbreakable token
    text = LINK_RE.sub(lambda m: m.group(1), text)
    # emphasis
    for _ in range(3):
        new = EMPHASIS_RE.sub(lambda m: m.group(2), text)
        if new == text:
            break
        text = new
    # raw HTML tags
    text = STRIP_TOKENS_RE.sub("", text)
    return text


def unbreakable_tokens(cell: str) -> Iterable[str]:
    """Yield tokens that will not word-wrap — code spans, long unbroken words, URLs."""
    for m in CODE_SPAN_RE.finditer(cell):
        yield m.group(1)
    for m in LINK_RE.finditer(cell):
        yield m.group(2)  # the URL itself is unbreakable
    cleaned = normalise_text(cell)
    for token in re.split(r"\s+", cleaned):
        if not token:
            continue
        # Split on whitespace for "word" boundaries. Hyphens are soft breaks
        # in PDF renderers, so we DO split on them here (matches LibreOffice
        # behaviour) — otherwise Q-NEW-1 looks unbreakable when in practice
        # it wraps at dashes.
        for sub in re.split(r"[-–—]", token):
            if sub:
                yield sub


def percentile(values: Sequence[int], p: float) -> float:
    if not values:
        return 0.0
    vs = sorted(values)
    if len(vs) == 1:
        return vs[0]
    k = (len(vs) - 1) * (p / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return float(vs[lo])
    return vs[lo] + (vs[hi] - vs[lo]) * (k - lo)


def col_natural_width(header: str, cells: Sequence[str], percentile_p: int) -> dict:
    """Compute a natural-width score for a single column."""
    header_text = normalise_text(header)
    header_len = max(len(header_text), 3)  # no column shorter than ~3 chars
    cell_lens: list[int] = []
    max_token = 0
    for c in cells:
        if not c:
            continue
        if c.strip().lower() in SENTINEL_CELLS:
            continue
        cleaned = normalise_text(c)
        # split multi-line cells on explicit breaks, take the longest
        parts = [p for p in cleaned.split("\n") if p.strip()]
        line_len = max((len(p) for p in parts), default=0)
        cell_lens.append(line_len)
        for tok in unbreakable_tokens(c):
            if len(tok) > max_token:
                max_token = len(tok)

    p_len = percentile(cell_lens, percentile_p) if cell_lens else header_len
    max_cell = max(cell_lens) if cell_lens else header_len
    # natural width = max of:
    #   - header length
    #   - p-percentile of cell lengths
    #   - longest unbreakable token (cells with code/URL stay readable)
    natural = max(header_len, p_len, max_token)
    return {
        "header": header,
        "header_len": header_len,
        "max": max_cell,
        "p": p_len,
        "tok": max_token,
        "natural": natural,
    }


# ---------------------------------------------------------------------------
# Profile computation
# ---------------------------------------------------------------------------


def compute_widths(
    naturals: list[float],
    min_ratio: float,
    max_ratio: float,
    smoothing: str,
) -> list[float]:
    """Map natural widths to relative multipliers.

    Smoothing modes:
    - linear: raw widths (strongest differentiation, extremes dominate)
    - sqrt:   square-root smoothing (balanced, default)
    - log:    log1p smoothing (gentle, columns stay close to 1.0)
    """
    if smoothing == "linear":
        smoothed = [max(float(v), 1.0) for v in naturals]
    elif smoothing == "log":
        smoothed = [math.log1p(v) for v in naturals]
    else:  # sqrt (default)
        smoothed = [math.sqrt(max(float(v), 1.0)) for v in naturals]

    mean = sum(smoothed) / len(smoothed)
    if mean <= 0:
        return [1.0] * len(naturals)
    raw = [s / mean for s in smoothed]
    clamped = [min(max(r, min_ratio), max_ratio) for r in raw]
    return [round(r, 2) for r in clamped]


def profile_id(prefix: str, headers: Sequence[str], language: str | None) -> str:
    key = "\x1f".join(h.strip() for h in headers).encode("utf-8")
    digest = hashlib.blake2b(key, digest_size=4).hexdigest()  # 8 hex chars
    parts = [prefix, digest]
    if language:
        parts.append(language)
    return "_".join(parts)


def format_profiles_block(profiles: dict[str, tuple[list[str], list[float]]]) -> str:
    lines = ["table_profiles:"]
    for pid, (cols, widths) in profiles.items():
        lines.append(f"  {pid}:")
        lines.append(f"    columns: {list(cols)!r}")
        lines.append(f"    widths: {widths!r}")
    return "\n".join(lines)


def strip_existing_profiles_block(fm_body: str) -> str:
    """Remove any existing `table_profiles:` block from frontmatter body."""
    out: list[str] = []
    skipping = False
    for line in fm_body.splitlines():
        if skipping:
            if line.startswith(" ") or line.strip() == "":
                continue
            skipping = False
        if line.startswith("table_profiles:"):
            skipping = True
            continue
        out.append(line)
    # trim trailing empties
    while out and out[-1].strip() == "":
        out.pop()
    return "\n".join(out) + "\n"


def detect_language_hint(path: Path) -> str | None:
    stem = path.stem
    if stem.endswith(".hu"):
        return "hu"
    if stem.endswith(".en"):
        return "en"
    return None


# ---------------------------------------------------------------------------
# Per-file processing
# ---------------------------------------------------------------------------


@dataclass
class FileReport:
    path: Path
    tables: list[tuple[Table, str, list[float], list[dict]]]  # (table, pid, widths, col_stats)
    wrote: bool
    skipped_reason: str | None = None


def process_file(
    path: Path,
    percentile_p: int,
    min_ratio: float,
    max_ratio: float,
    smoothing: str,
    profile_prefix: str,
    language_override: str | None,
    apply: bool,
) -> FileReport:
    text = path.read_text(encoding="utf-8")
    fm_open, fm_body, body = strip_fm(text)
    if fm_body is None:
        return FileReport(path=path, tables=[], wrote=False, skipped_reason="no frontmatter")

    tables = find_tables(body)
    if not tables:
        return FileReport(path=path, tables=[], wrote=False, skipped_reason="no tables")

    lang = language_override or detect_language_hint(path)

    profiles: dict[str, tuple[list[str], list[float]]] = {}
    report_tables: list[tuple[Table, str, list[float], list[dict]]] = []
    for t in tables:
        col_stats = [
            col_natural_width(h, [r[i] for r in t.rows], percentile_p)
            for i, h in enumerate(t.headers)
        ]
        widths = compute_widths(
            [cs["natural"] for cs in col_stats],
            min_ratio,
            max_ratio,
            smoothing,
        )
        pid = profile_id(profile_prefix, t.headers, lang)
        profiles[pid] = (list(t.headers), widths)
        report_tables.append((t, pid, widths, col_stats))

    if apply:
        new_fm = strip_existing_profiles_block(fm_body)
        new_fm = new_fm.rstrip() + "\n\n" + format_profiles_block(profiles) + "\n"
        path.write_text(fm_open + new_fm + "---\n" + body, encoding="utf-8")
        return FileReport(path=path, tables=report_tables, wrote=True)

    return FileReport(path=path, tables=report_tables, wrote=False)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def iter_markdown_files(arg: Path) -> Iterable[Path]:
    if arg.is_dir():
        yield from (p for p in arg.rglob("*.md") if p.is_file())
    elif arg.is_file():
        yield arg


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Auto-size markdown table columns.")
    p.add_argument("paths", nargs="+", type=Path, help="markdown files or directories")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="default; no changes")
    p.add_argument("--percentile", type=int, default=75,
                   help="cell-length percentile used as column's natural width (default 75)")
    p.add_argument("--smoothing", choices=["linear", "sqrt", "log"], default="sqrt",
                   help="width-normalisation curve (default sqrt)")
    p.add_argument("--min-ratio", type=float, default=0.3)
    p.add_argument("--max-ratio", type=float, default=3.5)
    p.add_argument("--page-chars", type=int, default=95, help="unused currently, kept for compat")
    p.add_argument("--language", default=None, help="override language suffix")
    p.add_argument("--profile-prefix", default="tbl")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    files: list[Path] = []
    for arg in args.paths:
        files.extend(iter_markdown_files(arg))

    total_files = 0
    total_tables = 0
    total_wrote = 0

    for f in sorted(files):
        rep = process_file(
            f,
            percentile_p=args.percentile,
            min_ratio=args.min_ratio,
            max_ratio=args.max_ratio,
            smoothing=args.smoothing,
            profile_prefix=args.profile_prefix,
            language_override=args.language,
            apply=args.apply,
        )
        if rep.skipped_reason:
            if args.verbose:
                print(f"[skip] {f}: {rep.skipped_reason}", file=sys.stderr)
            continue
        total_files += 1
        total_tables += len(rep.tables)
        if rep.wrote:
            total_wrote += 1
        mark = "write" if rep.wrote else "dry-run"
        print(f"[{mark}] {f}  ({len(rep.tables)} table(s))")
        for t, pid, widths, stats in rep.tables:
            print(f"  • {pid}  cols={t.n_cols}  widths={widths}")
            if args.verbose:
                for cs, w in zip(stats, widths):
                    print(
                        f"      {cs['header']!r:<30} "
                        f"hdr={cs['header_len']:3d}  max={cs['max']:3d}  "
                        f"p{args.percentile}={int(cs['p']):3d}  "
                        f"tok={cs['tok']:3d}  →  {w:.2f}"
                    )

    print(
        f"\nProcessed {total_files} file(s), {total_tables} table(s), "
        f"wrote {total_wrote} file(s)."
    )
    if not args.apply:
        print("Re-run with --apply to write the frontmatter.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
