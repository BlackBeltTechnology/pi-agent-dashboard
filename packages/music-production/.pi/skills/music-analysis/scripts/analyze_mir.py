#!/usr/bin/env python3
"""Deep-tier music analysis — enriches (or creates) ``<stem>_map.json`` (``music-map/1``).

Run from the separate deep venv built from requirements-mir.txt:

    python analyze_mir.py <audio> [--map PATH] [--no-stems] [--no-tags] [--device auto|cpu|mps|cuda]

Adds / replaces:
  * cut_grid <- beat_this downbeats (``source: "beat_this"``); every bar-indexed
    field (sections[].start_bar/end_bar, drops[].bar, tempo.stable_span, per-bar
    stem arrays) is re-derived from its time value against the new grid;
  * tempo.methods += essentia RhythmExtractor2013 + beat_this median IBI;
  * key <- 3-profile vote (edma / bgate / temperley);
  * tags {genre, instrument, mood} from Discogs-EffNet heads (CC BY-NC-SA 4.0,
    fetched sha256-verified into the user cache; node names read from each model .json);
  * stems {dir (relative to the map), energy_share, bar_rms_db} via demucs htdemucs_6s,
    plus stem-aware section classes and drum re-entry in drop confidence.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3] / "lib"))
sys.path.insert(0, str(HERE))
import musiclib as ml  # noqa: E402

REQ = "requirements-mir.txt"
np = ml.require("numpy", REQ)
EMBEDDING = "discogs-effnet-bs64-1"
HEADS = {"genre": "genre_discogs400-discogs-effnet-1",
         "instrument": "mtg_jamendo_instrument-discogs-effnet-1",
         "mood": "mtg_jamendo_moodtheme-discogs-effnet-1"}


def pick_device(req: str) -> str:
    if req != "auto":
        return req
    torch = ml.require("torch", REQ)
    if torch.cuda.is_available():
        return "cuda"
    return "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"


def rhythm_and_key(path: Path) -> tuple[float, dict]:
    es = ml.require("essentia.standard", REQ)
    a = es.MonoLoader(filename=str(path), sampleRate=44100)()
    bpm, _beats, _conf, _, _ = es.RhythmExtractor2013(method="multifeature")(a)
    profiles = {}
    for prof in ("edma", "bgate", "temperley"):
        k, scale, strength = es.KeyExtractor(profileType=prof)(a)
        profiles[prof] = {"label": f"{k} {scale}", "strength": round(float(strength), 2)}
    votes = [v["label"] for v in profiles.values()]
    label = max(set(votes), key=votes.count)
    strength = max(v["strength"] for v in profiles.values() if v["label"] == label)
    return float(bpm), {"label": label, "strength": strength, "profiles": profiles}


def beat_this_grid(path: Path, device: str) -> tuple[list[float], list[float], int]:
    ml.require("beat_this", REQ)
    from beat_this.inference import File2Beats
    beats, downbeats = File2Beats(checkpoint_path="final0", device=device, dbn=False)(str(path))
    beats, downbeats = [float(t) for t in beats], [float(t) for t in downbeats]
    counts = [sum(1 for b in beats if s - 1e-3 <= b < e - 1e-3) for s, e in zip(downbeats, downbeats[1:])]
    meter = int(np.median(counts)) if counts else 4
    return beats, downbeats, meter if meter in (2, 3, 4, 5, 6, 7) else 4


def _schema_node(meta: dict, purpose: str) -> str:
    outs = meta["schema"]["outputs"]
    for o in outs:
        if o.get("output_purpose") == purpose:
            return o["name"]
    return outs[0]["name"]


def tags(path: Path, k: int = 6) -> dict:
    es = ml.require("essentia.standard", REQ)
    emb_pb = ml.fetch_model(f"{EMBEDDING}.pb")
    emb_meta = json.loads(ml.fetch_model(f"{EMBEDDING}.json").read_text())
    a = es.MonoLoader(filename=str(path), sampleRate=16000, resampleQuality=4)()
    emb = es.TensorflowPredictEffnetDiscogs(graphFilename=str(emb_pb), output=_schema_node(emb_meta, "embeddings"))(a)
    out = {}
    for key, name in HEADS.items():
        pb = ml.fetch_model(f"{name}.pb")
        meta = json.loads(ml.fetch_model(f"{name}.json").read_text())
        p = es.TensorflowPredict2D(graphFilename=str(pb), input=meta["schema"]["inputs"][0]["name"],
                                   output=_schema_node(meta, "predictions"))(emb).mean(0)
        idx = np.argsort(p)[::-1][:k]
        out[key] = [{"label": meta["classes"][j], "p": round(float(p[j]), 2)} for j in idx]
    return out


def stems(path: Path, device: str, stems_root: Path, downbeats: list[float], map_path: Path) -> dict:
    sf = ml.require("soundfile", REQ)
    ml.require("demucs", REQ)
    r = subprocess.run([sys.executable, "-m", "demucs", "-n", "htdemucs_6s", "-d", device, "-o", str(stems_root),
                        str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        ml.die(f"demucs failed: {r.stderr.strip()[-400:]}")
    d = stems_root / "htdemucs_6s" / path.stem
    energy, activity = {}, {}
    edges = list(downbeats) + [1e9]
    for w in sorted(d.glob("*.wav")):
        y, sr = sf.read(w, always_2d=True)
        y = y.mean(1)
        energy[w.stem] = float(np.sum(y ** 2))
        bars = []
        for s, e in zip(edges[:-1], edges[1:]):
            seg = y[int(s * sr):int(min(e, len(y) / sr) * sr)]
            bars.append(round(ml.db(float(np.sqrt(np.mean(seg ** 2)))), 1) if len(seg) else None)
        activity[w.stem] = bars
    tot = sum(energy.values()) or 1.0
    return {"dir": ml.rel_to(map_path, d),
            "energy_share": {k: round(v / tot, 3) for k, v in sorted(energy.items(), key=lambda x: -x[1])},
            "bar_rms_db": activity}


def rederive_bars(m: dict, downbeats: list[float]) -> None:
    """Re-derive every bar-indexed field from its (preserved) time value against ``downbeats``."""
    secs = sorted(m.get("sections", []), key=lambda s: s["start"])
    merged: list[dict] = []
    for s in secs:
        s["start_bar"] = ml.time_to_bar(downbeats, s["start"])
        if merged and s["start_bar"] <= merged[-1]["start_bar"]:
            merged[-1]["end"] = s["end"]  # two starts collapsed onto one bar
            continue
        merged.append(s)
    for i, s in enumerate(merged):
        s["end_bar"] = merged[i + 1]["start_bar"] if i + 1 < len(merged) else len(downbeats) + 1
    m["sections"] = merged
    for d in m.get("drops", []):
        d["bar"] = ml.time_to_bar(downbeats, d["time"])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("audio")
    ap.add_argument("--map", help="map to enrich (default: <stem>_map.json next to the audio)")
    ap.add_argument("--no-stems", action="store_true")
    ap.add_argument("--no-tags", action="store_true", help="skip the non-commercial tag models")
    ap.add_argument("--device", default="auto")
    a = ap.parse_args(argv)
    src = Path(a.audio).resolve()
    if not src.is_file():
        ml.die(f"audio not found: {a.audio}")
    map_path = Path(a.map).resolve() if a.map else src.with_name(f"{src.stem}_map.json")
    if map_path.exists():
        m = ml.load_contract_or_die(map_path, "music-map")
    else:
        import analyze_music
        m, _ = analyze_music.analyze(src, map_path.parent)
    device = pick_device(a.device)

    beats, downbeats, meter = beat_this_grid(src, device)
    if len(downbeats) < 8:
        ml.die(f"too short or arrhythmic: beat_this found {len(downbeats)} downbeats, need >= 8")
    downbeats = [ml.r3(t) for t in downbeats]
    ess_bpm, key = rhythm_and_key(src)
    ibi = np.diff(beats)
    methods = dict(m.get("tempo", {}).get("methods", {}))
    methods.update({"essentia_multifeature": ess_bpm, "beat_this_median_ibi": 60.0 / float(np.median(ibi))})

    import analyze_music
    m["cut_grid"] = {"source": "beat_this", "meter": meter, "downbeats": downbeats}
    m["beats"] = [ml.r3(t) for t in beats]
    m["tempo"] = analyze_music.grid_tempo(downbeats, meter, methods)
    m["key"] = key
    rederive_bars(m, downbeats)
    if not a.no_tags:
        m["tags"] = tags(src)
    if not a.no_stems:
        m["stems"] = stems(src, device, map_path.parent / "stems", downbeats, map_path)
    # Section levels, classes and (with stems) drop confidence follow the new grid.
    librosa = ml.require("librosa", REQ)
    y, sr = librosa.load(str(src), sr=44100, mono=True)
    S = np.abs(librosa.stft(y, n_fft=ml.N_FFT, hop_length=ml.HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=ml.N_FFT)
    bar_rms, bar_low, _ = ml.bar_levels(librosa, y, sr, S, freqs, downbeats, len(y) / sr)
    stem_bars = m["stems"]["bar_rms_db"] if "stems" in m else None
    if stem_bars:
        starts = [s["start_bar"] for s in m["sections"]]
        m["drops"] = analyze_music.drop_candidates(starts, bar_rms, bar_low, downbeats, stem_bars.get("drums"))
    for sec in m["sections"]:
        span = slice(sec["start_bar"] - 1, sec["end_bar"] - 1)
        sec["rms_db"] = round(float(np.mean(bar_rms[span])), 1)
        sec["bass_db"] = round(float(np.mean(bar_low[span])), 1)
        sec["rise_db"] = float(bar_rms[sec["end_bar"] - 2] - bar_rms[sec["start_bar"] - 1])
    ml.classify_sections(m["sections"], m["drops"], stem_bars)
    for sec in m["sections"]:
        sec.pop("rise_db", None)
    ml.write_json_atomic(map_path, m)
    print(f"{m['tempo']['bpm']} BPM  {meter}/4  {len(downbeats)} bars (beat_this)  key {key['label']}")
    for k_, v in m.get("tags", {}).items():
        print(f"{k_:10} " + ", ".join(f"{x['label']} {x['p']}" for x in v))
    if "stems" in m:
        print("stems energy share:", m["stems"]["energy_share"])
    print("->", map_path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ml.ModelError as e:
        ml.die(str(e))
