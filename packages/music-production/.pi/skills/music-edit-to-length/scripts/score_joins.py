#!/usr/bin/env python3
"""Score candidate music joins (outgoing bar A -> incoming bar B) on a ``music-map/1`` grid.

    python score_joins.py <map> --from-bar A --to-bar B [--json]
    python score_joins.py <map> --candidates auto --target-duration T --anchor-bar D [--top 10] [--json]

The audio is the map's ``source`` (resolved relative to the map). Bars are 1-based.
A join plays through the END of bar A and continues at the START of bar B.

Per-factor output:
  chroma, timbre   cosine similarity (chroma / MFCC 1-13) of the outgoing context
                   (bars A-1..A) against B's run-up in the source (bars B-2..B-1):
                   when they match, the join lands where B "expects" to be and is
                   inaudible. With no run-up (B <= 2) the incoming bars B..B+1 are used.
  jump_db          level of that reference against the outgoing 2 bars
  section_boundary B starts a map section
  class_change     {from, to} section classes when they differ
  score            0.4*chroma + 0.4*timbre - 0.02*|jump_db|
                   - 0.5*[class change across {groove,drop} <-> {breakdown,build}]
                   + 0.1*[section_boundary]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "lib"))
import musiclib as ml  # noqa: E402

np = ml.require("numpy")
ENERGY = {"groove", "drop"}
LIFT = {"breakdown", "build"}


def composite(chroma: float, timbre: float, jump_db: float, section_boundary: bool,
              from_cls: str | None, to_cls: str | None) -> float:
    cross = bool(from_cls and to_cls and ((from_cls in ENERGY and to_cls in LIFT) or
                                         (from_cls in LIFT and to_cls in ENERGY)))
    return 0.4 * chroma + 0.4 * timbre - 0.02 * abs(jump_db) - 0.5 * cross + 0.1 * section_boundary


def section_of(m: dict, bar: int) -> dict | None:
    for s in m.get("sections", []):
        if s["start_bar"] <= bar < s["end_bar"]:
            return s
    return None


class BarFeatures:
    """Per-bar chroma (12), MFCC 1-13 and RMS dB of the map's source audio."""

    def __init__(self, m: dict, map_path: Path, audio: Path | None = None):
        librosa = ml.require("librosa")
        audio = audio or ml.resolve_rel(map_path, m["source"])
        if not audio.is_file():
            ml.die(f"map source not found: {audio}")
        y, sr = librosa.load(str(audio), sr=44100, mono=True)
        S = np.abs(librosa.stft(y, n_fft=ml.N_FFT, hop_length=ml.HOP)) ** 2
        freqs = librosa.fft_frequencies(sr=sr, n_fft=ml.N_FFT)
        self.rms, _low, feats = ml.bar_levels(librosa, y, sr, S, freqs, m["cut_grid"]["downbeats"], len(y) / sr)
        self.chroma, self.mfcc = feats[:12].T, feats[12:].T
        self.n = len(self.rms)

    def window(self, bars: list[int]):
        idx = [b - 1 for b in bars if 1 <= b <= self.n]
        return (self.chroma[idx].mean(0), self.mfcc[idx].mean(0),
                10 * np.log10(np.mean(10 ** (self.rms[idx] / 10)) + 1e-12))


def _cos(a, b) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return float(np.dot(a, b) / (na * nb)) if na > 0 and nb > 0 else 0.0


def score_join(m: dict, F: BarFeatures, a: int, b: int) -> dict:
    n = F.n
    if not (1 <= a <= n and 1 <= b <= n):
        raise ValueError(f"join {a}->{b} outside the grid (bars 1..{n})")
    c_ref, t_ref, l_ref = F.window([a - 1, a])
    # Run-up measure (calibrated on the session track: ranks every approved join above
    # the rejected ones, where outgoing-vs-incoming did not). See PR / design follow-up.
    c_in, t_in, l_in = F.window([b - 2, b - 1] if b > 2 else [b, b + 1])
    sa, sb = section_of(m, a), section_of(m, b)
    fc, tc = (sa or {}).get("class"), (sb or {}).get("class")
    boundary = any(s["start_bar"] == b for s in m.get("sections", []))
    chroma, timbre, jump = _cos(c_ref, c_in), _cos(t_ref, t_in), float(l_in - l_ref)
    return {"from_bar": a, "to_bar": b, "chroma": round(chroma, 3), "timbre": round(timbre, 3),
            "jump_db": round(jump, 1), "section_boundary": boundary,
            "class_change": {"from": fc, "to": tc} if fc != tc else None,
            "score": round(composite(chroma, timbre, jump, boundary, fc, tc), 3)}


def auto_candidates(m: dict, F: BarFeatures, target: float, anchor: int, top: int) -> list[dict]:
    """Single-join edits ``1..A`` + ``B..END`` whose length is within half a bar of ``target``."""
    db = m["cut_grid"]["downbeats"]
    dur = float(m["duration"])
    half = float(np.median(np.diff(db))) / 2
    out = []
    for a in range(1, F.n):
        for b in range(1, F.n + 1):
            if b == a + 1:
                continue  # no join
            length = dur - (db[b - 1] - db[a])
            keeps_anchor = anchor <= a or anchor >= b
            if keeps_anchor and abs(length - target) <= half:
                row = score_join(m, F, a, b)
                row["duration"] = round(length, 3)
                out.append(row)
    out.sort(key=lambda r: -r["score"])
    return out[:top]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("map")
    ap.add_argument("--from-bar", type=int)
    ap.add_argument("--to-bar", type=int)
    ap.add_argument("--candidates", choices=["auto"])
    ap.add_argument("--target-duration", type=float)
    ap.add_argument("--anchor-bar", type=int, help="bar that must survive the cut (the drop)")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    map_path = Path(a.map).resolve()
    m = ml.load_contract_or_die(map_path, "music-map")
    if a.candidates == "auto":
        if a.target_duration is None or a.anchor_bar is None:
            ml.die("--candidates auto needs --target-duration and --anchor-bar")
        rows = auto_candidates(m, BarFeatures(m, map_path), a.target_duration, a.anchor_bar, a.top)
    elif a.from_bar is not None and a.to_bar is not None:
        try:
            rows = [score_join(m, BarFeatures(m, map_path), a.from_bar, a.to_bar)]
        except ValueError as e:
            ml.die(str(e))
    else:
        ml.die("give --from-bar A --to-bar B, or --candidates auto --target-duration T --anchor-bar D")
    if a.json:
        print(json.dumps(rows, indent=1))
        return 0
    print(f"{'join':>9} {'score':>6} {'chroma':>6} {'timbre':>6} {'jump':>6} {'bound':>5}  class change")
    for r in rows:
        cc = r["class_change"]
        change = f"{cc['from']}->{cc['to']}" if cc else "-"
        extra = f"  {r['duration']}s" if "duration" in r else ""
        print(f"{r['from_bar']:>4}->{r['to_bar']:<4} {r['score']:6.3f} {r['chroma']:6.3f} {r['timbre']:6.3f} "
              f"{r['jump_db']:6.1f} {'yes' if r['section_boundary'] else '-':>5}  "
              f"{change}{extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
