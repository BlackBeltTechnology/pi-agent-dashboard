#!/usr/bin/env python3
"""Cut a music file to length on its 1-based downbeat grid -> ``<out>.wav`` + ``<out>_edit.json`` (``music-edit/1``).

    python edit_music.py <audio> <out> SEG [SEG ...] [--map PATH] [--no-xfade] [--preview]

SEG is ``start_bar:end`` where ``end`` is
  * a bar number (exclusive: the segment stops at that bar's downbeat), e.g. ``1:9`` = bars 1-8;
  * ``END`` (to the end of the file); or
  * seconds with a decimal point, e.g. ``17:61.250``.

Joins are 30 ms equal-power crossfades centred on the join (``--no-xfade``: hard
butt-join, diagnostic only). Every join is click-checked against the source at the
incoming bar's downbeat. A >= 1 s run below -50 dBFS after the last segment's final
downbeat is trimmed to 50 ms. ``--preview`` also writes ``<out>.m4a`` (AAC 256k) for
the listening loop. The map defaults to ``<audio stem>_map.json`` next to the audio.
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3] / "lib"))
sys.path.insert(0, str(HERE))
import musiclib as ml  # noqa: E402
import score_joins  # noqa: E402

np = ml.require("numpy")
XF = 0.030        # crossfade length, s
CLICK_WIN = 0.020  # +- window of the click check, s
CLICK_RATIO = 1.1
CLICK_FLOOR = 1e-4     # ~ -80 dBFS: a digitally silent source downbeat is not a reference
SILENCE_DB = -50.0
SILENCE_RUN = 1.0
TAIL_KEEP = 0.050


class SegmentError(ValueError):
    pass


def parse_segments(specs: list[str], downbeats: list[float], duration: float) -> list[dict]:
    """Validate ``start_bar:end`` specs against the grid. Raises SegmentError naming the segment."""
    n = len(downbeats)
    out = []
    for spec in specs:
        try:
            s_raw, e_raw = spec.split(":")
            a = int(s_raw)
        except ValueError:
            raise SegmentError(f"segment '{spec}': expected start_bar:end") from None
        if not 1 <= a <= n:
            raise SegmentError(f"segment '{spec}': start bar {a} outside the grid (1..{n})")
        t0 = float(downbeats[a - 1])
        seg = {"start_bar": a}
        if e_raw == "END":
            t1 = duration
            seg["end_s"] = ml.r3(duration)
        elif "." in e_raw:
            try:
                t1 = float(e_raw)
            except ValueError:
                raise SegmentError(f"segment '{spec}': bad seconds value '{e_raw}'") from None
            if not t0 < t1 <= duration:
                raise SegmentError(f"segment '{spec}': end {t1}s must be after {t0}s and within {duration}s")
            seg["end_s"] = ml.r3(t1)
        else:
            try:
                b = int(e_raw)
            except ValueError:
                raise SegmentError(f"segment '{spec}': end must be a bar, END or seconds") from None
            if b <= a:
                raise SegmentError(f"segment '{spec}': end bar {b} is not after start bar {a}")
            if b > n:
                raise SegmentError(f"segment '{spec}': end bar {b} exceeds the grid (last downbeat is bar {n})")
            t1 = float(downbeats[b - 1])
            seg["end_bar"] = b
        seg["music_from"], seg["music_to"] = ml.r3(t0), ml.r3(t1)
        seg["_t0"], seg["_t1"] = t0, t1
        out.append(seg)
    if not out:
        raise SegmentError("no segments given")
    return out


def render(y: np.ndarray, sr: int, segs: list[dict], xfade: bool = True) -> tuple[np.ndarray, list[int]]:
    """Concatenate segments; return (audio, sample position of each segment start)."""
    h = int(XF * sr) // 2
    lens = [int(round(s["_t1"] * sr)) - int(round(s["_t0"] * sr)) for s in segs]
    pos = [int(sum(lens[:k])) for k in range(len(segs))]
    out = np.zeros((sum(lens), y.shape[1]))
    last = len(segs) - 1
    for k, s in enumerate(segs):
        i0, i1 = int(round(s["_t0"] * sr)), int(round(s["_t1"] * sr))
        if not xfade:
            out[pos[k]:pos[k] + lens[k]] = y[i0:i1][: lens[k]]
            continue
        pre, post = (h if k else 0), (h if k < last else 0)
        chunk = np.zeros((lens[k] + pre + post, y.shape[1]))
        src_a, src_b = i0 - pre, i1 + post
        a_clip, b_clip = max(0, src_a), min(len(y), src_b)
        chunk[a_clip - src_a: a_clip - src_a + (b_clip - a_clip)] = y[a_clip:b_clip]
        if pre:
            chunk[: 2 * pre] *= np.sin(np.linspace(0, np.pi / 2, 2 * pre))[:, None]
        if post:
            chunk[-2 * post:] *= np.cos(np.linspace(0, np.pi / 2, 2 * post))[:, None]
        start = pos[k] - pre
        out[start:start + len(chunk)] += chunk
    return out, pos


def max_step(x: np.ndarray, center: int, w: int) -> float:
    a, b = max(0, center - w), min(len(x), center + w)
    return float(np.max(np.abs(np.diff(x[a:b])))) if b - a > 1 else 0.0


def trim_tail(out: np.ndarray, sr: int, after_s: float) -> np.ndarray:
    """Cut a >= 1 s sub -50 dBFS run after ``after_s`` to 50 ms; always fade the last 50 ms."""
    mono = out.mean(axis=1)
    hop = int(0.01 * sr)
    start = int(after_s * sr)
    need = int(SILENCE_RUN / 0.01)
    run_start, run = None, 0
    for i in range(start, len(mono) - hop + 1, hop):
        rms = float(np.sqrt(np.mean(mono[i:i + hop] ** 2)))
        if ml.db(rms) < SILENCE_DB:
            if run == 0:
                run_start = i
            run += 1
            if run >= need:
                break
        else:
            run = 0
    if run >= need and run_start is not None:
        out = out[: run_start + int(TAIL_KEEP * sr)]
    n = min(len(out), int(TAIL_KEEP * sr))
    out[-n:] *= np.linspace(1.0, 0.0, n)[:, None]
    return out


def build_edit(audio: Path, out_stem: Path, specs: list[str], map_path: Path, xfade: bool = True,
               preview: bool = False, runner=None) -> dict:
    sf = ml.require("soundfile")
    m = ml.load_contract_or_die(map_path, "music-map")
    db = [float(t) for t in m["cut_grid"]["downbeats"]]
    y, sr = sf.read(str(audio), always_2d=True)
    dur = len(y) / sr
    try:
        segs = parse_segments(specs, db, dur)
    except SegmentError as e:
        ml.die(str(e))

    out, pos = render(y, sr, segs, xfade)
    mono_out, mono_src = out.mean(axis=1), y.mean(axis=1)
    w = int(CLICK_WIN * sr)

    last = segs[-1]
    in_last = [d for d in db if last["_t0"] - 1e-3 <= d < last["_t1"] - 1e-3]
    last_db_video = pos[-1] / sr + ((in_last[-1] if in_last else last["_t0"]) - last["_t0"])
    out = trim_tail(out, sr, last_db_video)
    duration = len(out) / sr

    joins = []
    F = None
    for k in range(1, len(segs)):
        prev, cur = segs[k - 1], segs[k]
        edit_v = max_step(mono_out, pos[k], w)
        ref_v = max_step(mono_src, int(round(cur["_t0"] * sr)), w)
        a_bar = prev["end_bar"] - 1 if "end_bar" in prev else ml.bar_containing(db, prev["_t1"] - 1e-3)
        try:
            F = F or score_joins.BarFeatures(m, map_path, audio)
            score = score_joins.score_join(m, F, a_bar, cur["start_bar"])["score"]
        except ValueError:
            score = None
        joins.append({"video_at": ml.r3(pos[k] / sr), "source_bar": cur["start_bar"], "score": score,
                      "click_ok": bool(edit_v <= CLICK_RATIO * max(ref_v, CLICK_FLOOR))})

    grid = []
    for k, s in enumerate(segs):
        for d in db:
            if s["_t0"] - 1e-3 <= d < s["_t1"] - 1e-3:
                v = pos[k] / sr + (d - s["_t0"])
                if v < duration:
                    grid.append(ml.r3(v))

    wav = out_stem.with_name(out_stem.name + ".wav")
    edit_path = out_stem.with_name(out_stem.name + "_edit.json")
    wav.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".wav", dir=wav.parent, prefix=f".{wav.stem}.")
    os.close(fd)
    try:
        sf.write(tmp, out, sr, subtype="PCM_24", format="WAV")
        os.replace(tmp, wav)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise

    segments = []
    for k, s in enumerate(segs):
        row = {kk: v for kk, v in s.items() if not kk.startswith("_")}
        row["video_at"] = ml.r3(pos[k] / sr)
        segments.append(row)
    edit = {
        "schema": "music-edit/1",
        "source": ml.rel_to(edit_path, audio),
        "audio": ml.rel_to(edit_path, wav),
        "map": ml.rel_to(edit_path, map_path),
        "bpm": m["tempo"]["bpm"],
        "meter": m["cut_grid"].get("meter", 4),
        "duration": ml.r3(duration),
        "segments": segments,
        "joins": joins,
        "downbeats_video": grid,
    }
    ml.write_json_atomic(edit_path, edit)
    if preview:
        m4a = out_stem.with_name(out_stem.name + ".m4a")
        ml.run_ffmpeg(["-y", "-v", "error", "-i", str(wav), "-c:a", "aac", "-b:a", "256k", str(m4a)], runner)
    return edit


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("audio")
    ap.add_argument("out", help="output stem, e.g. music/track_edit90 -> track_edit90.wav + _edit.json")
    ap.add_argument("segments", nargs="+")
    ap.add_argument("--map")
    ap.add_argument("--no-xfade", action="store_true", help="hard butt-joins (diagnostic)")
    ap.add_argument("--preview", action="store_true", help="also write <out>.m4a")
    a = ap.parse_args(argv)
    audio = Path(a.audio).resolve()
    if not audio.is_file():
        ml.die(f"audio not found: {a.audio}")
    map_path = Path(a.map).resolve() if a.map else audio.with_name(f"{audio.stem}_map.json")
    out_stem = Path(a.out).resolve()
    if out_stem.suffix == ".wav":
        out_stem = out_stem.with_suffix("")
    try:
        edit = build_edit(audio, out_stem, a.segments, map_path, not a.no_xfade, a.preview)
    except RuntimeError as e:
        ml.die(str(e))
    print(f"{edit['duration']}s  {len(edit['downbeats_video'])} bars  {edit['bpm']} BPM")
    for s in edit["segments"]:
        print(f"  bar {s['start_bar']}:{s.get('end_bar', s.get('end_s'))}  {s['music_from']}-{s['music_to']}s -> video {s['video_at']}s")
    for j in edit["joins"]:
        print(f"  join @ {j['video_at']}s into bar {j['source_bar']}  score {j['score']}  click_ok {j['click_ok']}")
    bad = [j["video_at"] for j in edit["joins"] if not j["click_ok"]]
    if bad:
        print(f"WARNING: audible click likely at join(s) {bad}s - pick another join or keep the crossfade",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
