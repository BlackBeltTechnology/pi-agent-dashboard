#!/usr/bin/env python3
"""Pick irregular camera-punch hits for a music edit -> ``<stem>_hits.json`` (``music-hits/1``).

    python pick_hits.py <x_edit.json> [--out x_hits.json] [--min-gap 1.5] [--hook-db -30] [--density 7]

Reads the ``music-edit/1`` file, the edited audio it references (``audio``) and the
source map it references (``map``). All output times are VIDEO time.

  1. structural candidates: edited-audio downbeats with the largest 30-150 Hz jump
     over the previous bar (>= 3 dB);
  2. big hits: a structural candidate within +-1 downbeat of a mapped ``drops[]`` entry
     with confidence >= 0.5 becomes ``big``, snapped to the downbeat nearest the drop;
     the rest stay ``mid``;
  3. hook candidates (vocals stem only): bars where the vocals bar-RMS crosses
     ``--hook-db`` from below;
  4. merge by priority manual > big > hook > structural-mid under ``--min-gap`` bars,
     about one hit per ``--density`` seconds;
  5. de-regularize: while > 70 % of the inter-hit intervals equal the modal interval
     (differ by less than one downbeat) and a non-manual hit sits on that grid, drop the
     lowest-priority one (ties: smallest low-band jump). Skipped with < 3 hits.

``manual`` hits already in the output file are kept verbatim and never thinned.
Source times (drops, stem bars) map to video time through the edit ``segments``;
anything cut out of the edit is ignored.
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "lib"))
import musiclib as ml  # noqa: E402

np = ml.require("numpy")

RECIPE = {
    "big": {"scale": 1.12, "y": -48, "x": 36, "rot": 0.8, "settle": 0.6, "ease": "expo.out"},
    "mid": {"scale": 1.07, "y": -28, "x": 18, "rot": 0.4, "settle": 0.45, "ease": "expo.out"},
}
PRIORITY = {"manual": 0, "big": 1, "hook": 2, "mid": 3}
MIN_JUMP_DB = 3.0
REGULAR_SHARE = 0.70


def _prio(h: dict) -> int:
    if h["source"] == "manual":
        return PRIORITY["manual"]
    if h["tier"] == "big":
        return PRIORITY["big"]
    return PRIORITY["hook"] if h["source"] == "hook" else PRIORITY["mid"]


def structural_candidates(dv: list[float], low_db, drops_video: list[tuple[float, float]]) -> list[dict]:
    """Downbeats with a >= 3 dB low-band jump; big when within +-1 downbeat of a confirmed drop."""
    out: dict[float, dict] = {}
    for i in range(1, len(dv)):
        jump = float(low_db[i] - low_db[i - 1])
        if jump < MIN_JUMP_DB:
            continue
        hit = {"t": ml.r3(dv[i]), "tier": "mid", "source": "structural",
               "why": f"low-band +{jump:.1f} dB at video bar {i + 1}", "_jump": jump}
        for v, conf in drops_video:
            j = int(np.argmin([abs(d - v) for d in dv]))
            if abs(i - j) <= 1:
                hit.update(t=ml.r3(dv[j]), tier="big", why=hit["why"] + f"; drop conf {conf:.2f}")
                break
        prev = out.get(hit["t"])
        if prev is None or (_prio(hit), -hit["_jump"]) < (_prio(prev), -prev["_jump"]):
            out[hit["t"]] = hit
    return list(out.values())


def hook_candidates(m: dict, segments: list[dict], dv: list[float], hook_db: float) -> list[dict] | None:
    vocals = ((m.get("stems") or {}).get("bar_rms_db") or {}).get("vocals")
    if not vocals:
        return None
    mdb = m["cut_grid"]["downbeats"]
    bar = float(np.median(np.diff(dv))) if len(dv) > 1 else 1.0
    out = []
    for i in range(1, min(len(vocals), len(mdb))):
        a, b = vocals[i - 1], vocals[i]
        if a is None or b is None or not (a < hook_db <= b):
            continue
        v = ml.source_to_video(segments, float(mdb[i]))
        if v is None:
            continue
        j = int(np.argmin([abs(d - v) for d in dv]))
        if abs(dv[j] - v) > bar / 2:
            continue
        out.append({"t": ml.r3(dv[j]), "tier": "mid", "source": "hook",
                    "why": f"vocals cross {hook_db:g} dB at source bar {i + 1}", "_jump": float(b - a)})
    return out


def merge(manual: list[dict], cands: list[dict], gap_s: float, budget: int) -> list[dict]:
    hits = [dict(h) for h in manual]
    taken = [float(h["t"]) for h in manual]
    n = 0
    for c in sorted(cands, key=lambda h: (_prio(h), -h.get("_jump", 0.0), h["t"])):
        if n >= budget:
            break
        if all(abs(c["t"] - t) >= gap_s for t in taken):
            hits.append(c)
            taken.append(c["t"])
            n += 1
    return sorted(hits, key=lambda h: float(h["t"]))


def regularity(hits: list[dict], bar: float) -> tuple[float, int]:
    ts = [float(h["t"]) for h in hits]
    iv = [(b - a) / bar for a, b in zip(ts, ts[1:])]
    if not iv:
        return 0.0, 0
    modal = Counter(round(x) for x in iv).most_common(1)[0][0]
    return sum(abs(x - modal) < 1 for x in iv) / len(iv), modal


def deregularize(hits: list[dict], bar: float) -> list[dict]:
    """Thin a mechanical every-N-bars grid; terminates after at most one step per non-manual hit."""
    hits = list(hits)
    while len(hits) >= 3:
        share, modal = regularity(hits, bar)
        if share <= REGULAR_SHARE:
            break
        ts = [float(h["t"]) for h in hits]
        on_grid = set()
        for k in range(1, len(ts)):
            if abs((ts[k] - ts[k - 1]) / bar - modal) < 1:
                on_grid.update((k - 1, k))
        removable = [k for k in on_grid if hits[k]["source"] != "manual"]
        if not removable:
            break
        # Prefer a removal that actually breaks the grid (an interior hit); dropping an
        # edge hit leaves every remaining interval modal and would thin to nothing.
        breaking = [k for k in removable if regularity(hits[:k] + hits[k + 1:], bar)[0] < share]
        worst = max(breaking or removable, key=lambda k: (_prio(hits[k]), -hits[k].get("_jump", 0.0), -k))
        hits.pop(worst)
    return hits


def default_out(edit_path: Path) -> Path:
    name = edit_path.name
    return edit_path.with_name(name[: -len("_edit.json")] + "_hits.json" if name.endswith("_edit.json")
                               else edit_path.stem + "_hits.json")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("edit")
    ap.add_argument("--out")
    ap.add_argument("--min-gap", type=float, default=1.5, help="minimum gap between hits, in bars")
    ap.add_argument("--hook-db", type=float, default=-30.0)
    ap.add_argument("--density", type=float, default=7.0, help="about one hit per N seconds")
    a = ap.parse_args(argv)
    edit_path = Path(a.edit).resolve()
    edit = ml.load_contract_or_die(edit_path, "music-edit")
    m = ml.load_contract_or_die(ml.resolve_rel(edit_path, edit["map"]), "music-map")
    audio = ml.resolve_rel(edit_path, edit["audio"])
    if not audio.is_file():
        ml.die(f"edited audio not found: {audio}")
    out = Path(a.out).resolve() if a.out else default_out(edit_path)
    manual = []
    if out.exists():
        manual = [h for h in ml.load_contract_or_die(out, "music-hits").get("hits", []) if h.get("source") == "manual"]

    dv = [float(t) for t in edit["downbeats_video"]]
    if len(dv) < 2:
        ml.die("edit has fewer than 2 downbeats; nothing to sync")
    bar = float(np.median(np.diff(dv)))
    librosa = ml.require("librosa")
    y, sr = librosa.load(str(audio), sr=44100, mono=True)
    S = np.abs(librosa.stft(y, n_fft=ml.N_FFT, hop_length=ml.HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=ml.N_FFT)
    _rms, low, _ = ml.bar_levels(librosa, y, sr, S, freqs, dv, len(y) / sr)

    drops_video = []
    for d in m.get("drops", []):
        if d.get("confidence", 0) >= 0.5:
            v = ml.source_to_video(edit["segments"], float(d["time"]))
            if v is not None:
                drops_video.append((v, float(d["confidence"])))
    cands = structural_candidates(dv, low, drops_video)
    hooks = hook_candidates(m, edit["segments"], dv, a.hook_db)
    if hooks is None:
        print("note: hook detection skipped (map has no stems.bar_rms_db.vocals)", file=sys.stderr)
    else:
        cands += hooks

    budget = max(1, round(float(edit["duration"]) / a.density))
    hits = deregularize(merge(manual, cands, a.min_gap * bar, budget), bar)
    for h in hits:
        h.pop("_jump", None)
    ml.write_json_atomic(out, {"schema": "music-hits/1", "edit": ml.rel_to(out, edit_path),
                               "hits": hits, "recipe": RECIPE})
    share, modal = regularity(hits, bar)
    print(f"{len(hits)} hits ({sum(h['tier'] == 'big' for h in hits)} big), "
          f"modal interval {modal} bars = {share:.0%} of intervals -> {out}")
    for h in hits:
        print(f"  {float(h['t']):8.3f}s  {h['tier']:3}  {h['source']:10}  {h.get('why', '')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
