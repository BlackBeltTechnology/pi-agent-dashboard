#!/usr/bin/env python3
"""Bake redaction into a footage clip from a declarative JSON spec (stdlib + ffmpeg/ffprobe only).

    python redact.py <in> <out> --spec redact.json [--crf 16] [--dry-run] [--strict]

Spec (every box in SOURCE-frame pixels, before crop/scale; every time on the
UNTRIMMED source timeline — the script shifts windows by ``trim.from``):

    {
      "trim":  {"from": 12.0, "to": 20.0},        # optional; cut the clip in the same pass
      "speed": 1.0,                                # optional (> 0); 2 = twice as fast
      "fps":   30,                                 # optional output fps (default 30)
      "crop":  {"top": 125, "bottom": 90, "left": 0, "right": 0},
      "delogo": [{"x": 750, "y": 410, "w": 640, "h": 110, "from": 0, "to": 46.9}],
      "blur_when": [{"x": 836, "y": 338, "w": 180, "h": 56, "pad_s": 0.25,
                     "detect": {"x": 820, "y": 300, "w": 220, "h": 30,
                                "rgb": [20, 40, 90], "tol": 30, "min_ratio": 0.6}}]
    }

Filter order: trim -> delogo -> blur -> crop -> speed (setpts) -> fps -> encode.
A ``blur_when`` detect box is sampled every 0.25 s; it is active when the share of
pixels within ``tol`` of ``rgb`` (every channel) is >= ``min_ratio``. Active samples
merge into windows padded by ``pad_s``; the blur is enabled only inside them.

ffmpeg always runs from an argument vector (never a shell). Output goes to
``<out>.partial`` and is renamed on success; on failure nothing is left at ``<out>``.
``--dry-run`` prints the windows and the filter graph and writes nothing.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from typing import Callable, Sequence

SAMPLE_FPS = 4
STEP = 1.0 / SAMPLE_FPS
DEFAULT_FPS = 30

Runner = Callable[[Sequence[str]], "subprocess.CompletedProcess"]


class SpecError(ValueError):
    def __init__(self, field: str, msg: str):
        super().__init__(f"{field}: {msg}")
        self.field = field


TIMEOUT_S = 3600  # one clip; a hung ffmpeg/ffprobe must not stall a batch


def default_runner(argv: Sequence[str]):
    try:
        return subprocess.run(list(argv), capture_output=True, timeout=TIMEOUT_S)  # argv list, never through a shell
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"{argv[0]} timed out after {e.timeout:g}s") from e


# ------------------------------------------------------------------ validation

def _num(v, field: str, *, positive: bool = False) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise SpecError(field, f"must be a finite number, got {v!r}")
    if v < 0 or (positive and v == 0):
        raise SpecError(field, f"must be {'> 0' if positive else '>= 0'}, got {v!r}")
    return float(v)


def _box(obj: dict, field: str, W: int, H: int) -> None:
    x, y = _num(obj.get("x"), f"{field}.x"), _num(obj.get("y"), f"{field}.y")
    w, h = _num(obj.get("w"), f"{field}.w", positive=True), _num(obj.get("h"), f"{field}.h", positive=True)
    if x + w > W or y + h > H:
        raise SpecError(field, f"box x={x:g} y={y:g} w={w:g} h={h:g} lies outside the {W}x{H} source frame")


def _window(obj: dict, field: str) -> None:
    a, b = _num(obj.get("from"), f"{field}.from"), _num(obj.get("to"), f"{field}.to")
    if not a < b:
        raise SpecError(field, f"'from' ({a:g}) must be less than 'to' ({b:g})")


def _obj(v, field: str) -> dict:
    if not isinstance(v, dict):
        raise SpecError(field, f"must be an object, got {type(v).__name__}")
    return v


def _list(v, field: str) -> list:
    if not isinstance(v, list):
        raise SpecError(field, f"must be a list, got {type(v).__name__}")
    return v


def validate(spec: dict, W: int, H: int) -> None:
    """Raise SpecError naming the first invalid field (e.g. ``blur_when[0].detect.min_ratio``)."""
    _obj(spec, "spec")
    for key in ("trim", "crop"):
        if key in spec:
            _obj(spec[key], key)
    for key in ("delogo", "blur_when"):
        for i, entry in enumerate(_list(spec.get(key, []), key)):
            _obj(entry, f"{key}[{i}]")
    if "trim" in spec:
        _window(spec["trim"], "trim")
    if "speed" in spec:
        _num(spec["speed"], "speed", positive=True)
    if "fps" in spec:
        _num(spec["fps"], "fps", positive=True)
    crop = spec.get("crop") or {}
    for k in ("top", "bottom", "left", "right"):
        if k in crop:
            _num(crop[k], f"crop.{k}")
    if H - crop.get("top", 0) - crop.get("bottom", 0) < 2 or W - crop.get("left", 0) - crop.get("right", 0) < 2:
        raise SpecError("crop", f"must leave at least 2x2 px of the {W}x{H} frame")
    for i, d in enumerate(spec.get("delogo", [])):
        _box(d, f"delogo[{i}]", W, H)
        _window(d, f"delogo[{i}]")
    for i, b in enumerate(spec.get("blur_when", [])):
        f = f"blur_when[{i}]"
        _box(b, f, W, H)
        _num(b.get("pad_s", 0.25), f"{f}.pad_s")
        det = b.get("detect")
        if not isinstance(det, dict):
            raise SpecError(f"{f}.detect", "is required")
        _box(det, f"{f}.detect", W, H)
        rgb = det.get("rgb")
        if (not isinstance(rgb, list) or len(rgb) != 3
                or any(isinstance(c, bool) or not isinstance(c, int) or not 0 <= c <= 255 for c in rgb)):
            raise SpecError(f"{f}.detect.rgb", f"must be three integers 0-255, got {rgb!r}")
        tol = _num(det.get("tol"), f"{f}.detect.tol")
        if tol > 255:
            raise SpecError(f"{f}.detect.tol", f"must be in [0, 255], got {tol:g}")
        ratio = _num(det.get("min_ratio"), f"{f}.detect.min_ratio")
        if not 0 < ratio <= 1:
            raise SpecError(f"{f}.detect.min_ratio", f"must be in (0, 1], got {ratio:g}")


# ------------------------------------------------------------------- detection

def probe_size(path: Path, runner: Runner) -> tuple[int, int]:
    r = runner(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                "-of", "json", str(path)])
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {path}")
    s = json.loads(r.stdout)["streams"][0]
    return int(s["width"]), int(s["height"])


def ratios(raw: bytes, w: int, h: int, rgb: Sequence[int], tol: float) -> list[float]:
    """Per-frame share of pixels within ``tol`` of ``rgb`` from a packed rgb24 stream."""
    size = w * h * 3
    r0, g0, b0 = rgb
    out = []
    for off in range(0, len(raw) - size + 1, size):
        frame = raw[off:off + size]
        hit = 0
        for i in range(0, size, 3):
            if abs(frame[i] - r0) <= tol and abs(frame[i + 1] - g0) <= tol and abs(frame[i + 2] - b0) <= tol:
                hit += 1
        out.append(hit / (w * h))
    return out


def detect_samples(path: Path, det: dict, t0: float, t1: float | None, runner: Runner) -> list[tuple[float, float]]:
    """(source time, match ratio) every 0.25 s over [t0, t1) from one ffmpeg rawvideo pass."""
    w, h, x, y = int(det["w"]), int(det["h"]), int(det["x"]), int(det["y"])
    argv = ["ffmpeg", "-v", "error", "-ss", f"{t0:g}"]
    if t1 is not None:
        argv += ["-to", f"{t1:g}"]
    argv += ["-i", str(path), "-vf", f"fps={SAMPLE_FPS},crop={w}:{h}:{x}:{y}", "-f", "rawvideo",
             "-pix_fmt", "rgb24", "-"]
    r = runner(argv)
    if r.returncode != 0:
        raise RuntimeError(f"detection pass failed: {(r.stderr or b'').decode(errors='replace')[-300:]}")
    return [(round(t0 + i * STEP, 3), v) for i, v in enumerate(ratios(r.stdout, w, h, det["rgb"], det["tol"]))]


def resolve_windows(samples: Sequence[tuple[float, float]], min_ratio: float, pad_s: float) -> list[tuple[float, float]]:
    """Active samples -> merged [first - pad, last + pad] windows (source time, clamped at 0)."""
    wins: list[list[float]] = []
    for t, v in samples:
        if v < min_ratio:
            continue
        a, b = max(0.0, t - pad_s), t + pad_s
        if wins and a <= wins[-1][1] + STEP:
            wins[-1][1] = b
        else:
            wins.append([a, b])
    return [(round(a, 3), round(b, 3)) for a, b in wins]


# ----------------------------------------------------------------------- graph

def _enable(windows: Sequence[tuple[float, float]], shift: float, length: float | None) -> str:
    parts = []
    for a, b in windows:
        a2, b2 = max(0.0, a - shift), b - shift
        if length is not None:
            b2 = min(b2, length)
        if b2 > a2:
            parts.append(f"between(t,{a2:g},{b2:g})")
    return "+".join(parts)


def build_graph(spec: dict, windows: Sequence[Sequence[tuple[float, float]]], W: int, H: int) -> str:
    """filter_complex string ending in ``[out]``. Order: trim, delogo, blur, crop, setpts, fps."""
    trim = spec.get("trim")
    shift = float(trim["from"]) if trim else 0.0
    length = float(trim["to"]) - shift if trim else None
    base = []
    if trim:
        base += [f"trim=start={trim['from']:g}:end={trim['to']:g}", "setpts=PTS-STARTPTS"]
    for d in spec.get("delogo", []):
        en = _enable([(d["from"], d["to"])], shift, length)
        if en:
            x, y, w, h = int(d["x"]), int(d["y"]), int(d["w"]), int(d["h"])
            base.append(f"delogo=x={x}:y={y}:w={w}:h={h}:enable='{en}'")
    graph = [f"[0:v]{','.join(base) or 'null'}[v0]"]
    cur = "[v0]"
    for i, (b, wins) in enumerate(zip(spec.get("blur_when", []), windows)):
        en = _enable(wins, shift, length)
        if not en:
            continue
        x, y, w, h = int(b["x"]), int(b["y"]), int(b["w"]), int(b["h"])
        r = max(1, min(20, min(w, h) // 4))
        graph.append(f"{cur}split[m{i}][s{i}];[s{i}]crop={w}:{h}:{x}:{y},boxblur={r}:3[k{i}];"
                     f"[m{i}][k{i}]overlay={x}:{y}:enable='{en}'[b{i}]")
        cur = f"[b{i}]"
    tail = []
    c = spec.get("crop") or {}
    top, bottom, left, right = (int(c.get(k, 0)) for k in ("top", "bottom", "left", "right"))
    if top or bottom or left or right:
        cw, ch = W - left - right, H - top - bottom
        tail.append(f"crop={cw - cw % 2}:{ch - ch % 2}:{left}:{top}")
    tail += [f"setpts=PTS/{float(spec.get('speed', 1)):g}", f"fps={spec.get('fps', DEFAULT_FPS):g}", "format=yuv420p"]
    graph.append(f"{cur}{','.join(tail)}[out]")
    return ";".join(graph)


# ------------------------------------------------------------------------ main

def redact(src: Path, out: Path, spec: dict, *, crf: int = 16, dry_run: bool = False, strict: bool = False,
           runner: Runner = default_runner) -> int:
    W, H = probe_size(src, runner)
    try:
        validate(spec, W, H)
    except SpecError as e:
        print(f"invalid spec: {e}", file=sys.stderr)
        return 2
    trim = spec.get("trim")
    t0, t1 = (float(trim["from"]), float(trim["to"])) if trim else (0.0, None)
    windows = []
    for i, b in enumerate(spec.get("blur_when", [])):
        det = b["detect"]
        wins = resolve_windows(detect_samples(src, det, t0, t1, runner), det["min_ratio"], b.get("pad_s", 0.25))
        if not wins:
            msg = f"blur_when[{i}]: detector never active (rgb {det['rgb']}, min_ratio {det['min_ratio']})"
            if strict:
                print(f"error: {msg}", file=sys.stderr)
                return 3
            print(f"warning: {msg}; nothing blurred for this entry", file=sys.stderr)
        windows.append(wins)
    graph = build_graph(spec, windows, W, H)
    if dry_run:
        print(json.dumps({"windows": {f"blur_when[{i}]": w for i, w in enumerate(windows)}, "graph": graph}, indent=1))
        return 0
    partial = out.with_name(out.name + ".partial")
    fmt = "mov" if out.suffix.lower() == ".mov" else "mp4"
    argv = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex", graph, "-map", "[out]", "-an",
            "-c:v", "libx264", "-crf", str(crf), "-preset", "medium", "-movflags", "+faststart",
            "-f", fmt, str(partial)]
    try:
        r = runner(argv)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or b"").decode(errors="replace")[-400:])
        os.replace(partial, out)
    except BaseException as e:
        partial.unlink(missing_ok=True)
        if isinstance(e, RuntimeError):
            print(f"error: ffmpeg failed: {e}", file=sys.stderr)
            return 1
        raise
    print(f"-> {out}")
    return 0


def main(argv: list[str] | None = None, runner: Runner = default_runner) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--spec", required=True)
    ap.add_argument("--crf", type=int, default=16)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--strict", action="store_true", help="fail when a blur_when detector never fires")
    a = ap.parse_args(argv)
    src = Path(a.input)
    if not src.is_file():
        print(f"error: input not found: {src}", file=sys.stderr)
        return 1
    try:
        spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: cannot read spec {a.spec}: {e}", file=sys.stderr)
        return 2
    try:
        return redact(src, Path(a.output), spec, crf=a.crf, dry_run=a.dry_run, strict=a.strict, runner=runner)
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
