#!/usr/bin/env python3
"""
voiceid.py — Speaker enrollment based post-hoc relabeling for diarized SRT files.

Approach (A) from the target-speaker research: run existing diarization, then
match each anonymous cluster ([1], [Speaker 2], ...) against a library of
enrolled voiceprints using cosine similarity of speaker embeddings.

This fixes the main failure mode of clustering diarization on LONG recordings:
speaker drift, where one person is split across several clusters. Enrollment
anchors re-merge them, and many clusters may map to one name.

Model: 3D-Speaker CAM++ zh_en "advanced" (ONNX, 28 MB, 192-dim) via sherpa-onnx.
Fully local, CPU-only, no network.

Two measured lessons drive the defaults (see BENCHMARK.md):
  * Multilingual / large-vocabulary models beat English VoxCeleb-only ones on
    Hungarian meeting audio, and BIGGER IS NOT BETTER: wespeaker resnet293_LM
    (114 MB) scored WORSE than campplus zh_en advanced (28 MB).
  * Raw cosine saturates on single-channel meeting audio (distinct speakers
    still score 0.93+) because one shared channel/session direction dominates
    every embedding. Subtracting a multi-speaker mean ("centering") restores a
    usable dynamic range; it is applied to both sides of every comparison.

Subcommands:
  enroll   build/refresh a voiceprint from audio (optionally driven by an SRT label)
  list     show the voiceprint library
  analyze  cluster-drift report for one SRT (no enrollment needed)
  label    rewrite an SRT, replacing anonymous labels with enrolled names
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000

MODEL_DIR = Path.home() / "Documents/.pi/models/speaker"
# ranked by measured accuracy on Hungarian meeting audio (see BENCHMARK.md)
MODEL_PREFERENCE = [
    "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",  # 70.5%, 28 MB, fast
    "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx",         # 71.0%, 71 MB, 5x slower
    "nemo_en_titanet_large.onnx",                                   # 72.0%, 101 MB
]
DEFAULT_STORE = Path.home() / "Documents/.pi/voiceprints/voiceprints.json"

MEDIA_EXTS = ["mp3", "m4a", "wav", "mp4", "mkv", "mov", "aac", "flac", "webm"]

# minimum cohort size before the library-wide mean is trusted for centering
MIN_COHORT = 40


def default_model() -> Path:
    for name in MODEL_PREFERENCE:
        p = MODEL_DIR / name
        if p.exists():
            return p
    found = sorted(MODEL_DIR.glob("*.onnx"))
    return found[0] if found else MODEL_DIR / MODEL_PREFERENCE[0]


# ---------------------------------------------------------------- audio

def find_media(srt_path: Path) -> Path | None:
    """Locate the audio/video file that shares the SRT's base name."""
    stem = srt_path.name
    for suffix in (".diarize.srt", ".named.srt", ".srt"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    for ext in MEDIA_EXTS:
        cand = srt_path.parent / f"{stem}.{ext}"
        if cand.exists():
            return cand
    return None


def load_audio(path: Path) -> np.ndarray:
    """Decode any media file to mono 16 kHz float32 via ffmpeg (memory-mapped)."""
    tmp = tempfile.NamedTemporaryFile(suffix=".f32", delete=False)
    tmp.close()
    subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(path),
         "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1",
         "-ar", str(SAMPLE_RATE), tmp.name],
        check=True,
    )
    if os.path.getsize(tmp.name) == 0:
        raise RuntimeError(f"ffmpeg produced no audio for {path}")
    load_audio._tmpfiles.append(tmp.name)
    return np.memmap(tmp.name, dtype=np.float32, mode="r")


load_audio._tmpfiles = []


def cleanup_tmp() -> None:
    for p in load_audio._tmpfiles:
        try:
            os.unlink(p)
        except OSError:
            pass


def media_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


# ---------------------------------------------------------------- SRT

TIME_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"
)
LABEL_RE = re.compile(r"^\s*\[([^\]]{1,40})\]\s*")


@dataclass
class Cue:
    index: str
    start: float
    end: float
    label: str | None
    text: str

    @property
    def duration(self) -> float:
        return self.end - self.start


def _to_sec(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def parse_srt(path: Path) -> list[Cue]:
    """Parse an SRT whose text lines may be prefixed with a [speaker] tag."""
    blocks = re.split(r"\n\s*\n", path.read_text(encoding="utf-8-sig").strip())
    cues: list[Cue] = []
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if len(lines) < 2:
            continue
        tm = tm_idx = None
        for i, ln in enumerate(lines[:3]):
            m = TIME_RE.search(ln)
            if m:
                tm, tm_idx = m, i
                break
        if tm is None:
            continue
        index = lines[0].strip() if tm_idx > 0 else str(len(cues) + 1)
        text = " ".join(lines[tm_idx + 1:]).strip()
        lm = LABEL_RE.match(text)
        cues.append(Cue(
            index=index,
            start=_to_sec(*tm.group(1, 2, 3, 4)),
            end=_to_sec(*tm.group(5, 6, 7, 8)),
            label=lm.group(1).strip() if lm else None,
            text=text[lm.end():] if lm else text,
        ))
    return cues


def fmt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ---------------------------------------------------------------- vectors

def l2(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def centroid(vs) -> np.ndarray:
    return l2(np.mean(np.stack(vs), axis=0))


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def center(v: np.ndarray, mean: np.ndarray | None) -> np.ndarray:
    """Remove the dominant shared channel/session direction.

    Without this, cosine scores on single-channel meeting audio saturate near
    1.0 for everyone. The mean MUST come from a multi-speaker pool — centering
    by a single speaker's own mean would cancel the very signal we want.
    """
    return l2(v) if mean is None else l2(v - mean)


class Embedder:
    def __init__(self, model: Path, threads: int = 4):
        import sherpa_onnx

        if not model.exists():
            raise SystemExit(
                f"embedding model not found: {model}\n"
                f"download one into {MODEL_DIR} — see BENCHMARK.md"
            )
        cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(model), num_threads=threads, debug=False, provider="cpu"
        )
        self.ex = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)
        self.dim = self.ex.dim
        self.model_name = model.name

    def embed(self, audio: np.ndarray, start: float, end: float) -> np.ndarray | None:
        a = int(start * SAMPLE_RATE)
        b = min(int(end * SAMPLE_RATE), len(audio))
        if b - a < int(0.5 * SAMPLE_RATE):
            return None
        chunk = np.asarray(audio[a:b], dtype=np.float32)
        if not np.any(chunk):
            return None
        st = self.ex.create_stream()
        st.accept_waveform(SAMPLE_RATE, chunk)
        st.input_finished()
        if not self.ex.is_ready(st):
            return None
        return l2(np.asarray(self.ex.compute(st), dtype=np.float32))


# ---------------------------------------------------------------- profiling

def pick_segments(cues, min_dur: float, max_n: int, max_total: float) -> list[Cue]:
    """Sample segments spread ACROSS the timeline, not just the longest ones.

    Drift is a temporal phenomenon: a profile built only from the first minutes
    misrepresents the rest of a long recording.
    """
    usable = [c for c in cues if c.duration >= min_dur]
    if not usable:
        usable = sorted(cues, key=lambda c: -c.duration)[:max_n]
    if len(usable) > max_n:
        idx = np.linspace(0, len(usable) - 1, max_n).round().astype(int)
        usable = [usable[i] for i in sorted(set(idx.tolist()))]
    out, total = [], 0.0
    for c in usable:
        out.append(c)
        total += min(c.duration, 10.0)
        if total >= max_total:
            break
    return out


def embed_cues(emb: Embedder, audio, cues, args) -> list[np.ndarray]:
    segs = pick_segments(cues, args.min_seg, args.max_segments, args.max_audio)
    out = []
    for c in segs:
        # a 10 s window is plenty for a stable embedding
        v = emb.embed(audio, c.start, min(c.end, c.start + 10.0))
        if v is not None:
            out.append(v)
    return out


def cluster_cues(cues) -> dict[str, list[Cue]]:
    groups: dict[str, list[Cue]] = {}
    for c in cues:
        if c.label:
            groups.setdefault(c.label, []).append(c)
    return groups


def profile_srt(args, cues) -> tuple[Embedder, dict[str, tuple], np.ndarray | None]:
    """Embed every cluster of an SRT and return (embedder, profiles, recording mean)."""
    emb = Embedder(Path(args.model), args.threads)
    srt = Path(args.srt)
    media = Path(args.media) if getattr(args, "media", None) else find_media(srt)
    if not media:
        raise SystemExit(f"no media file found next to {srt}")
    print(f"audio: {media.name}   model: {emb.model_name}")
    audio = load_audio(media)
    profiles = {}
    for label, group in cluster_cues(cues).items():
        vecs = embed_cues(emb, audio, group, args)
        if vecs:
            profiles[label] = (centroid(vecs), vecs, group)
    # a multi-speaker mean is only meaningful with >= 2 clusters
    rec_mean = None
    if len(profiles) >= 2:
        rec_mean = np.mean(np.concatenate([np.stack(p[1]) for p in profiles.values()]), axis=0)
    return emb, profiles, rec_mean


# ---------------------------------------------------------------- store

def load_store(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {"version": 2, "cohort": {"sum": None, "count": 0}, "voiceprints": {}}


def save_store(path: Path, store: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, ensure_ascii=False, indent=2))


def cohort_mean(store: dict) -> np.ndarray | None:
    """Library-wide mean embedding — the shared reference used for centering.

    One common mean keeps both sides of a cross-recording comparison in the
    same space (mixing two different means would not be sound).
    """
    c = store.get("cohort") or {}
    if not c.get("sum") or c.get("count", 0) < MIN_COHORT:
        return None
    return np.asarray(c["sum"], dtype=np.float32) / c["count"]


def cohort_add(store: dict, vecs) -> None:
    c = store.setdefault("cohort", {"sum": None, "count": 0})
    s = np.asarray(c["sum"], dtype=np.float32) if c["sum"] else np.zeros(len(vecs[0]), np.float32)
    if s.shape != vecs[0].shape:  # model changed -> reset the cohort
        s, c["count"] = np.zeros(len(vecs[0]), np.float32), 0
    s = s + np.sum(np.stack(vecs), axis=0)
    c["sum"] = [round(float(x), 6) for x in s]
    c["count"] = c["count"] + len(vecs)


# ---------------------------------------------------------------- commands

def slice_windows(c: Cue, win: float) -> list[Cue]:
    out, t = [], c.start
    while t + 2.0 < c.end:
        out.append(Cue(c.index, t, min(t + win, c.end), None, ""))
        t += win
    return out or [c]


def cmd_enroll(args) -> int:
    emb = Embedder(Path(args.model), args.threads)
    store = load_store(Path(args.store))

    if args.srt:
        srt = Path(args.srt)
        all_cues = parse_srt(srt)
        cues = all_cues
        if args.label:
            wanted = args.label.strip().strip("[]")
            cues = [c for c in all_cues if c.label and c.label.strip() == wanted]
            if not cues:
                labels = sorted({c.label for c in all_cues if c.label})
                print(f"label '{args.label}' not in {srt.name}; available: {labels}")
                return 1
        media = Path(args.audio) if args.audio else find_media(srt)
        if not media:
            print(f"no media file found next to {srt}")
            return 1
    else:
        media = Path(args.audio)
        all_cues = None
        end = float(args.end) if args.end else media_duration(media)
        cues = slice_windows(Cue("1", float(args.start or 0), end, None, ""), 6.0)

    print(f"enrolling '{args.name}' from {media.name} ({len(cues)} candidate segments)")
    audio = load_audio(media)
    vecs = embed_cues(emb, audio, cues, args)
    if not vecs:
        print("no usable audio for enrollment")
        return 1
    vec = centroid(vecs)
    total = sum(min(c.duration, 10.0)
                for c in pick_segments(cues, args.min_seg, args.max_segments, args.max_audio))
    coh = float(np.median([cosine(v, vec) for v in vecs]))

    # feed the cohort with EVERY speaker in the source recording, so the
    # library mean stays a genuine multi-speaker reference
    cohort_src = vecs
    if all_cues is not None and args.label:
        others = [c for c in all_cues if c.label and c.label.strip() != args.label.strip().strip("[]")]
        if others:
            cohort_src = vecs + embed_cues(emb, audio, others, args)
    cohort_add(store, cohort_src)

    vps = store["voiceprints"]
    prev = vps.get(args.name)
    if prev and not args.replace and prev.get("dim") == emb.dim:
        old = l2(np.asarray(prev["vector"], dtype=np.float32))
        w_old, w_new = prev.get("n_segments", 1), len(vecs)
        vec = l2((old * w_old + vec * w_new) / (w_old + w_new))
        n_total, sources = w_old + w_new, prev.get("sources", []) + [media.name]
        print(f"  merged with existing voiceprint ({w_old} + {w_new} segments)")
    else:
        n_total, sources = len(vecs), [media.name]

    vps[args.name] = {
        "vector": [round(float(x), 6) for x in vec],
        "dim": emb.dim,
        "model": emb.model_name,
        "n_segments": n_total,
        "enroll_seconds": round(total, 1),
        "coherence": round(coh, 3),
        "sources": sources,
    }
    save_store(Path(args.store), store)
    print(f"  segments={len(vecs)} audio={total:.1f}s coherence={coh:.3f}")
    print(f"  cohort now {store['cohort']['count']} embeddings "
          f"({'ready' if store['cohort']['count'] >= MIN_COHORT else f'need {MIN_COHORT} to enable centering'})")
    print(f"  saved to {args.store}")
    if total < 20:
        print("  WARNING: <20 s of enrollment audio — matching will be unreliable")
    if coh < 0.55:
        print("  WARNING: low coherence — this label may cover more than one speaker")
    return 0


def cmd_list(args) -> int:
    store = load_store(Path(args.store))
    vps = store["voiceprints"]
    if not vps:
        print(f"no voiceprints yet in {args.store}")
        return 0
    mean = cohort_mean(store)
    print(f"{len(vps)} voiceprint(s) in {args.store}")
    print(f"cohort: {store.get('cohort', {}).get('count', 0)} embeddings, "
          f"centering {'ACTIVE' if mean is not None else 'inactive'}\n")
    print(f"{'name':<26} {'segs':>5} {'sec':>7} {'coh':>6}  model / sources")
    print("-" * 100)
    for name, vp in sorted(vps.items()):
        print(f"{name:<26} {vp['n_segments']:>5} {vp['enroll_seconds']:>7.1f} "
              f"{vp.get('coherence', 0):>6.3f}  {vp['model'][:28]} | {', '.join(vp['sources'][:3])}")
    names = sorted(vps)
    if len(names) > 1:
        vecs = {n: center(np.asarray(vps[n]["vector"], np.float32), mean) for n in names}
        print("\ncross-similarity between enrolled voices (lower = better separated):")
        print("        " + " ".join(f"{n[:8]:>8}" for n in names))
        for a in names:
            print(f"{a[:7]:<8}" + " ".join(f"{cosine(vecs[a], vecs[b]):>8.3f}" for b in names))
    return 0


def cmd_analyze(args) -> int:
    cues = parse_srt(Path(args.srt))
    if not cluster_cues(cues):
        print("no [speaker] labels found in this SRT")
        return 1
    print(f"{Path(args.srt).name}: {len(cues)} cues, {len(cluster_cues(cues))} clusters")
    _, profiles, mean = profile_srt(args, cues)
    if mean is None:
        print("only one cluster — nothing to compare")
        return 0

    print(f"\n{'cluster':<14} {'cues':>5} {'speech':>9} {'coherence':>10}")
    print("-" * 45)
    cen = {}
    for label, (_, vecs, group) in profiles.items():
        cen[label] = centroid([center(v, mean) for v in vecs])
        coh = float(np.median([cosine(center(v, mean), cen[label]) for v in vecs]))
        print(f"{label:<14} {len(group):>5} {sum(c.duration for c in group):>8.1f}s {coh:>10.3f}")

    labels = list(profiles)
    print(f"\ncluster-to-cluster cosine, channel-centered "
          f"(>= {args.merge:.2f} = likely the SAME person -> drift):")
    print("        " + " ".join(f"{l[:9]:>9}" for l in labels))
    for a in labels:
        print(f"{a[:7]:<8}" + " ".join(f"{cosine(cen[a], cen[b]):>9.3f}" for b in labels))
    merges = [(a, b, cosine(cen[a], cen[b]))
              for i, a in enumerate(labels) for b in labels[i + 1:]
              if cosine(cen[a], cen[b]) >= args.merge]
    print()
    for a, b, s in sorted(merges, key=lambda x: -x[2]):
        print(f"  DRIFT: '{a}' and '{b}' look like the same speaker (cos={s:.3f})")
    if not merges:
        print("  no drift detected — clusters look like distinct speakers")
    return 0


def cmd_label(args) -> int:
    store = load_store(Path(args.store))
    vps = store["voiceprints"]
    if not vps:
        print(f"no voiceprints enrolled yet ({args.store}) — run `enroll` first")
        return 1

    srt = Path(args.srt)
    cues = parse_srt(srt)
    if not cluster_cues(cues):
        print("no [speaker] labels found in this SRT")
        return 1
    print(f"{srt.name}: {len(cues)} cues, {len(cluster_cues(cues))} clusters, "
          f"{len(vps)} voiceprints")
    emb, profiles, rec_mean = profile_srt(args, cues)

    bad = [n for n, v in vps.items() if v.get("dim") != emb.dim]
    if bad:
        print(f"ERROR: voiceprints {bad} were built with a different model "
              f"(dim mismatch) — re-enroll them with --model {emb.model_name}")
        return 1

    mean = cohort_mean(store)
    if mean is None:
        mean = rec_mean
        print(f"note: cohort < {MIN_COHORT} embeddings — centering on this recording's mean "
              "(enroll more voices for a stable library-wide reference)")
    refs = {n: center(np.asarray(v["vector"], np.float32), mean) for n, v in vps.items()}

    mapping: dict[str, str] = {}
    print(f"\n{'cluster':<14} {'speech':>9}  {'best match':<22} {'cos':>7} {'2nd':>7} "
          f"{'margin':>7} {'vote':>6}  decision")
    print("-" * 108)
    for label, (_, vecs, group) in profiles.items():
        cvecs = [center(v, mean) for v in vecs]
        cen = centroid(cvecs)
        scored = sorted(((cosine(cen, r), n) for n, r in refs.items()), reverse=True)
        best_s, best_n = scored[0]
        second_s = scored[1][0] if len(scored) > 1 else -1.0
        margin = best_s - second_s
        # per-segment vote: how much of the cluster agrees with the centroid's pick
        votes = sum(max(((cosine(v, r), n) for n, r in refs.items()))[1] == best_n
                    for v in cvecs) / len(cvecs)
        secs = sum(c.duration for c in group)
        if best_s >= args.threshold and margin >= args.margin and votes >= args.min_vote:
            mapping[label] = best_n
            decision = f"-> {best_n}"
        elif best_s < args.threshold:
            decision = f"UNKNOWN (cos < {args.threshold}) — kept"
        elif margin < args.margin:
            decision = f"AMBIGUOUS (margin < {args.margin}) — kept"
        else:
            decision = f"WEAK VOTE ({votes:.0%} < {args.min_vote:.0%}) — kept"
        print(f"{label:<14} {secs:>8.1f}s  {best_n[:22]:<22} {best_s:>7.3f} "
              f"{second_s:>7.3f} {margin:>7.3f} {votes:>6.0%}  {decision}")

    if not mapping:
        print("\nno cluster passed the thresholds — nothing to rewrite")
        return 1

    merged: dict[str, list[str]] = {}
    for lab, name in mapping.items():
        merged.setdefault(name, []).append(lab)
    for name, labs in merged.items():
        if len(labs) > 1:
            print(f"\n  re-merged into '{name}': {', '.join(labs)}  <- drift repaired")

    out = Path(args.out) if args.out else srt.with_suffix(".named.srt")
    if args.dry_run:
        print(f"\n[dry-run] would write {out}")
        return 0
    if out.resolve() == srt.resolve():
        print("refusing to overwrite the source SRT")
        return 1

    lines = []
    for i, c in enumerate(cues, 1):
        name = mapping.get(c.label or "")
        tag = f"[{name}] " if name else (f"[{c.label}] " if c.label else "")
        lines.append(f"{i}\n{fmt_time(c.start)} --> {fmt_time(c.end)}\n{tag}{c.text}\n")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nwrote {out}  ({len(cues)} cues, source untouched)")
    return 0


# ---------------------------------------------------------------- cli

def main() -> int:
    p = argparse.ArgumentParser(prog="voiceid", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", default=str(default_model()), help="speaker embedding ONNX model")
    p.add_argument("--store", default=str(DEFAULT_STORE), help="voiceprint library JSON")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--min-seg", type=float, default=1.2, help="ignore segments shorter than this (s)")
    p.add_argument("--max-segments", type=int, default=60, help="segments sampled per cluster")
    p.add_argument("--max-audio", type=float, default=120.0, help="max speech seconds per profile")
    sub = p.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("enroll", help="build a voiceprint")
    e.add_argument("--name", required=True)
    e.add_argument("--audio", help="media file (clip or full recording)")
    e.add_argument("--srt", help="SRT to take segments from")
    e.add_argument("--label", help="which SRT label is this person, e.g. '[Speaker 1]'")
    e.add_argument("--start", type=float, help="clip start (s), --audio only")
    e.add_argument("--end", type=float, help="clip end (s), --audio only")
    e.add_argument("--replace", action="store_true", help="overwrite instead of merging")
    e.set_defaults(func=cmd_enroll)

    sub.add_parser("list", help="show the voiceprint library").set_defaults(func=cmd_list)

    a = sub.add_parser("analyze", help="cluster drift report for an SRT")
    a.add_argument("--srt", required=True)
    a.add_argument("--media")
    a.add_argument("--merge", type=float, default=0.55, help="drift threshold")
    a.set_defaults(func=cmd_analyze)

    b = sub.add_parser("label", help="rewrite an SRT with enrolled names")
    b.add_argument("--srt", required=True)
    b.add_argument("--media")
    b.add_argument("--out")
    b.add_argument("--threshold", type=float, default=0.35, help="min cosine to accept a name")
    b.add_argument("--margin", type=float, default=0.10, help="min gap to the runner-up")
    b.add_argument("--min-vote", type=float, default=0.45, help="min share of segments agreeing")
    b.add_argument("--dry-run", action="store_true")
    b.set_defaults(func=cmd_label)

    args = p.parse_args()
    if args.cmd == "enroll" and not args.audio and not args.srt:
        p.error("enroll needs --audio and/or --srt")
    try:
        return args.func(args)
    finally:
        cleanup_tmp()


if __name__ == "__main__":
    sys.exit(main())
