#!/usr/bin/env python3
"""Quick-tier music analysis -> ``<stem>_map.json`` (schema ``music-map/1``) + ``<stem>_analysis.png``.

Needs only requirements-core.txt (librosa, numpy, scipy, soundfile, matplotlib).

    python analyze_music.py <audio> [--out-dir DIR] [--bpm-hint 120]

Contract rules (see SKILL.md):
  * bars are 1-based: bar n starts at cut_grid.downbeats[n-1];
  * tempo.bpm is the downbeat-grid mean over the stable span, using the grid meter;
  * every time is seconds rounded to 3 decimals; ``source`` is relative to the map.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "lib"))
import musiclib as ml  # noqa: E402

np = ml.require("numpy")

HOP = ml.HOP
N_FFT = ml.N_FFT
BANDS = {"sub": (20, 60), "bass": (60, 250), "low_mid": (250, 2000), "high_mid": (2000, 6000), "air": (6000, 20000)}
MIN_DOWNBEATS = 8


# ----------------------------------------------------------------- pure helpers

def stable_span(downbeats) -> tuple[int, int]:
    """Longest run of downbeat intervals within +-5 % of their median -> (start_bar, end_bar), 1-based."""
    d = np.diff(np.asarray(downbeats, dtype=float))
    med = float(np.median(d))
    ok = np.abs(d - med) <= 0.05 * med
    best, cur_start, best_span = 0, None, (0, 0)
    for i, good in enumerate(list(ok) + [False]):
        if good and cur_start is None:
            cur_start = i
        elif not good and cur_start is not None:
            if i - cur_start > best:
                best, best_span = i - cur_start, (cur_start, i - 1)
            cur_start = None
    if best == 0:
        return 1, len(downbeats)
    i, j = best_span
    return i + 1, j + 2  # interval i spans bars i+1 .. i+2


def grid_tempo(downbeats, meter: int, methods: dict | None = None) -> dict:
    """Authoritative tempo: 60*meter*(k-1)/(t_k-t_1) over the stable span."""
    a, b = stable_span(downbeats)
    t1, tk = float(downbeats[a - 1]), float(downbeats[b - 1])
    k = b - a + 1
    bpm = 60.0 * meter * (k - 1) / (tk - t1)
    return {"bpm": round(bpm, 2), "stable_span": {"start_bar": a, "end_bar": b},
            "methods": {k_: round(float(v), 2) for k_, v in (methods or {}).items()}}


def detect_meter(accent) -> tuple[int, int]:
    """Choose meter 3 or 4 and the downbeat phase from a per-beat accent curve."""
    acc = np.asarray(accent, dtype=float)
    best: dict[int, tuple[float, int]] = {}
    for m in (3, 4):
        scores = []
        for p in range(m):
            on = acc[p::m]
            off = np.delete(acc, np.arange(p, len(acc), m))
            scores.append(float(on.mean() - off.mean()) if len(on) and len(off) else -1.0)
        best[m] = (max(scores), int(np.argmax(scores)))
    if best[3][0] > 0.05 and best[3][0] > 1.25 * best[4][0]:
        return 3, best[3][1]
    return 4, best[4][1]


def drop_candidates(section_starts: list[int], bar_rms, bar_low, downbeats, drum_bar_db=None) -> list[dict]:
    """Section starts (1-based bars) with a positive RMS or low-band jump vs the preceding 2 bars.

    confidence = clip((sustained low-band gain over the next 2 bars [+ drum re-entry gain]) / 24, 0, 1);
    a start whose low-band gain is not sustained scores < 0.5.
    """
    out = []
    n = len(bar_rms)
    for b in section_starts:
        i = b - 1
        if i < 2 or i + 1 >= n:
            continue
        prev_rms = (bar_rms[i - 2] + bar_rms[i - 1]) / 2
        prev_low = (bar_low[i - 2] + bar_low[i - 1]) / 2
        if not (bar_rms[i] - prev_rms > 0 or bar_low[i] - prev_low > 0):
            continue
        gain = min(bar_low[i], bar_low[i + 1]) - prev_low
        if drum_bar_db:
            try:
                gain += max(0.0, min(drum_bar_db[i], drum_bar_db[i + 1]) - (drum_bar_db[i - 2] + drum_bar_db[i - 1]) / 2)
            except (IndexError, TypeError):
                pass
        conf = min(1.0, max(0.0, gain / 24.0))
        out.append({"time": ml.r3(downbeats[i]), "bar": b, "confidence": round(conf, 2)})
    out.sort(key=lambda d: (-d["confidence"], d["bar"]))
    return out


def build_sections(bounds: list[int], n_bars: int, spans, bar_rms, bar_low) -> list[dict]:
    """Sections from sorted 1-based start bars. ``end_bar`` is exclusive (next section's start_bar)."""
    secs = []
    for k, s in enumerate(bounds):
        e = bounds[k + 1] if k + 1 < len(bounds) else n_bars + 1
        idx = slice(s - 1, e - 1)
        secs.append({"start": ml.r3(spans[s - 1][0]), "end": ml.r3(spans[e - 2][1]),
                     "start_bar": s, "end_bar": e,
                     "rms_db": round(float(np.mean(bar_rms[idx])), 1),
                     "bass_db": round(float(np.mean(bar_low[idx])), 1),
                     "rise_db": round(float(bar_rms[e - 2] - bar_rms[s - 1]), 1)})
    return secs


def section_bounds(bar_rms, bar_low, feats, librosa) -> list[int]:
    """Energy-novelty boundaries (win) + agglomerative texture boundaries, >= 2 bars apart."""
    n = len(bar_rms)
    strength = {b + 1: max(abs(bar_rms[b] - bar_rms[b - 1]) / 4.0, abs(bar_low[b] - bar_low[b - 1]) / 8.0)
                for b in range(1, n)}
    energy = [b for b, s in sorted(strength.items(), key=lambda kv: -kv[1]) if s >= 1.0]
    k = int(np.clip(round(n / 16), 1, 12))
    texture = []
    if k > 1 and n > k:
        texture = [int(b) + 1 for b in librosa.segment.agglomerative(feats, k) if b > 0]
    chosen = [1]
    for b in energy:  # strongest first
        if all(abs(b - c) >= 2 for c in chosen):
            chosen.append(b)
    for b in sorted(set(texture) - set(energy)):
        if all(abs(b - c) >= 2 for c in chosen):
            chosen.append(b)
    return sorted(c for c in set(chosen) if 1 <= c <= n)



# -------------------------------------------------------------------- analysis

def analyze(audio: Path, out_dir: Path, bpm_hint: float = 120.0) -> tuple[dict, Path]:
    librosa = ml.require("librosa")
    y, sr = librosa.load(str(audio), sr=44100, mono=True)
    dur = len(y) / sr

    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP // 2)
    tempo_bt, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=HOP // 2,
                                                    start_bpm=bpm_hint, units="frames")
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP // 2)
    if len(beats) < 4:
        ml.die("too short or arrhythmic: fewer than 4 beats detected")

    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    band_pow = {k: S[(freqs >= lo) & (freqs < hi)].mean(axis=0) for k, (lo, hi) in BANDS.items()}
    low_pow = S[(freqs >= ml.LOW_BAND[0]) & (freqs < ml.LOW_BAND[1])].sum(axis=0)
    frame_t = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP)

    # meter + downbeat phase from a per-beat accent (onset + low band)
    beat_s = np.searchsorted(frame_t, beats).clip(0, S.shape[1] - 1)
    on_b = onset[beat_frames.clip(0, len(onset) - 1)]
    low_b = low_pow[beat_s]
    accent = on_b / (on_b.max() + 1e-9) + low_b / (low_b.max() + 1e-9)
    meter, phase = detect_meter(accent)
    downbeats = list(beats[phase::meter])
    bar_len = float(np.median(np.diff(downbeats))) if len(downbeats) > 1 else 0.0
    while bar_len and downbeats[0] - bar_len > -0.25 * bar_len / meter:
        downbeats.insert(0, max(0.0, downbeats[0] - bar_len))
    if len(downbeats) < MIN_DOWNBEATS:
        ml.die(f"too short or arrhythmic: {len(downbeats)} downbeats found, need >= {MIN_DOWNBEATS}")
    downbeats = [ml.r3(t) for t in downbeats]

    ibi = np.diff(beats)
    tempo = grid_tempo(downbeats, meter, {"librosa_beat_track": float(np.atleast_1d(tempo_bt)[0]),
                                          "median_ibi": 60.0 / float(np.median(ibi))})

    bar_rms, bar_low, feats = ml.bar_levels(librosa, y, sr, S, freqs, downbeats, dur)
    spans = ml.bar_spans(downbeats, dur)
    chroma = librosa.feature.chroma_stft(S=S, sr=sr, n_fft=N_FFT, hop_length=HOP)

    bounds = section_bounds(bar_rms, bar_low, feats, librosa)
    sections = build_sections(bounds, len(downbeats), spans, bar_rms, bar_low)
    drops = drop_candidates(bounds, bar_rms, bar_low, downbeats)
    ml.classify_sections(sections, drops)
    for s in sections:
        s.pop("rise_db", None)

    lvl = {k: float(np.mean(10 * np.log10(v + 1e-10))) for k, v in band_pow.items()}
    top = max(lvl.values())

    maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    mnr = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    cm = chroma.mean(axis=1)
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    key = max(((float(np.nan_to_num(np.corrcoef(np.roll(p, i), cm)[0, 1])), f"{names[i]} {q}")
               for p, q in ((maj, "major"), (mnr, "minor")) for i in range(12)))

    out_dir.mkdir(parents=True, exist_ok=True)
    map_path = out_dir / f"{audio.stem}_map.json"
    m = {
        "schema": "music-map/1",
        "source": ml.rel_to(map_path, audio),
        "duration": ml.r3(dur), "sr": int(sr),
        "tempo": tempo,
        "cut_grid": {"source": "librosa", "meter": meter, "downbeats": downbeats},
        "beats": [ml.r3(t) for t in beats],
        "key": {"label": key[1], "strength": round(key[0], 2)},
        "band_level_db_rel": {k: round(v - top, 1) for k, v in lvl.items()},
        "sections": sections,
        "drops": drops,
    }
    return m, map_path


def plot(m: dict, png: Path, audio: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 1, figsize=(16, 4))
    for s in m["sections"]:
        ax.axvspan(s["start"], s["end"], alpha=0.15, color={"groove": "g", "drop": "r", "breakdown": "b",
                                                              "build": "y", "intro": "0.6", "outro": "0.6"}[s["class"]])
        ax.text(s["start"], 0.95, f"{s['start_bar']} {s['class']}", fontsize=7, va="top")
    for d in m["cut_grid"]["downbeats"]:
        ax.axvline(d, color="0.8", lw=0.4)
    for d in m["drops"]:
        ax.axvline(d["time"], color="r", lw=1 + 2 * d["confidence"])
    ax.set_xlim(0, m["duration"]); ax.set_ylim(0, 1); ax.set_yticks([])
    ax.set_title(f"{audio.name} - {m['tempo']['bpm']} BPM, {m['cut_grid']['meter']}/4, {m['key']['label']}")
    fig.tight_layout(); fig.savefig(png, dpi=90); plt.close(fig)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("audio")
    ap.add_argument("--out-dir", help="write the map and png here (default: next to the audio)")
    ap.add_argument("--bpm-hint", type=float, default=120.0)
    a = ap.parse_args(argv)
    audio = Path(a.audio).resolve()
    if not audio.is_file():
        ml.die(f"audio not found: {a.audio}")
    out_dir = Path(a.out_dir).resolve() if a.out_dir else audio.parent
    m, map_path = analyze(audio, out_dir, a.bpm_hint)
    ml.write_json_atomic(map_path, m)
    plot(m, out_dir / f"{audio.stem}_analysis.png", audio)
    print(f"{m['tempo']['bpm']} BPM  {m['cut_grid']['meter']}/4  {len(m['cut_grid']['downbeats'])} bars  key {m['key']['label']}")
    for s in m["sections"]:
        print(f"  bar {s['start_bar']:>4}-{s['end_bar']:<4} {s['start']:8.3f}s  {s['class']:9} rms {s['rms_db']} low {s['bass_db']}")
    for d in m["drops"]:
        print(f"  drop? bar {d['bar']} @ {d['time']}s  confidence {d['confidence']}")
    print("->", map_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
