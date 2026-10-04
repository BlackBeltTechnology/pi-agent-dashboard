#!/usr/bin/env python3
"""build-catalog.py — render a model catalog (Markdown) from extraction JSONL.

Usage: build-catalog.py EXTRACT_DIR OUT_DIR [--source "Channel name"] [--channel-url URL]
  EXTRACT_DIR  dir holding *.jsonl records (schema: see SKILL.md "Extraction schema")
  OUT_DIR      e.g. docs/models — writes README.md, <category>.md, local-hardware.md, models.jsonl
Stdlib only. Deterministic: same input → same output.
"""
import argparse, glob, json, os, re
from collections import Counter, defaultdict

CATEGORIES = {
    "llm": "LLMs (general chat / reasoning)",
    "coding": "Coding models & agents",
    "multimodal-omni": "Multimodal / omni models",
    "image-gen": "Image generation",
    "image-edit": "Image editing",
    "video-gen": "Video generation",
    "video-edit": "Video editing",
    "music": "Music generation",
    "tts-voice": "Text-to-speech & voice cloning",
    "asr-speech": "Speech recognition",
    "realtime-voice": "Realtime voice assistants",
    "3d": "3D generation",
    "world-model": "World models & interactive worlds",
    "avatar-lipsync": "Avatars & lip-sync",
    "agent": "Agents & AI tools",
    "robotics": "Robotics",
    "science-medical": "Science & medical",
    "embedding-other": "Other",
}
# Tiers ordered small → large: (label, max memory GB, keyword regex for qualitative notes).
TIERS = [
    ("T0 · phone / CPU / laptop", 0,
     r"phone|iphone|android|\bcpu\b|no gpu|without a gpu|macbook|laptop|on[- ]device|edge device|raspberry|browser"),
    ("T1 · low-end GPU (≤ 8 GB)", 8,
     r"low[- ]end|low to mid|rtx ?30[56]0|rtx ?3070|rtx ?40[56]0"),
    ("T2 · mainstream GPU (≤ 16 GB)", 16,
     r"most consumer|consumer gpu|consumer device|consumer hardware|mid[- ]range|mid[- ]end|mid[- ]tier|\bmid\b|medium|rtx ?4070|rtx ?4080|rtx ?5070|rtx ?5080"),
    ("T3 · high-end GPU (≤ 32 GB, e.g. 4090/5090)", 32,
     r"high[- ]end|higher[- ]end|single gpu|rtx ?3090|rtx ?4090|rtx ?5090|decent gpu"),
    ("T4 · workstation (≤ 128 GB, e.g. RTX 6000 / DGX Spark / big Mac)", 128,
     r"rtx ?6000|dgx spark|very (?:large|high) vram|insane hardware|really high[- ]end"),
    ("T5 · multi-GPU / datacenter", 10**9,
     r"multiple|stacked|stack of|datacenter|data center|enterprise|h100|h200|a100|b200|\btpu|multi[- ]gpu|cluster|server"),
]
UNSPEC = "unspecified"
GB = re.compile(r"(\d+(?:\.\d+)?)\s*(?:gb|gigabytes?)\b", re.I)


def norm(s):
    return re.sub(r"[^a-z0-9.]", "", (s or "").lower())


def cell(v):
    if v is None or v == "" or v == []:
        return "—"
    if isinstance(v, bool):
        return "✅" if v else "❌"
    if isinstance(v, list):
        v = ", ".join(map(str, v))
    return str(v).replace("|", "\\|").replace("\n", " ").strip()


def ts_seconds(ts):
    try:
        parts = [int(p) for p in str(ts).split(":")]
    except ValueError:
        return 0
    s = 0
    for p in parts:
        s = s * 60 + p
    return s


def _tier_for_gb(gb):
    return next(label for label, cap, _ in TIERS[1:] if gb <= cap)


def tier(hw, size):
    """Smallest tier the video says the model (or a quant of it) runs on → (label, estimated).

    Order: explicit GB in the hardware note → qualitative keywords → checkpoint size as estimate.
    """
    if hw:
        nums = [float(n) for n in GB.findall(hw)]
        if nums:
            return _tier_for_gb(min(nums)), False
        # Per ";"-clause the strongest requirement wins ("two high-end GPUs stacked" → T5);
        # across clauses the cheapest wins ("full needs X; Q4 fits mid GPUs" → the Q4 tier).
        clause_tiers = []
        for clause in hw.split(";"):
            idx = [i for i, (_, _, rx) in enumerate(TIERS) if re.search(rx, clause, re.I)]
            if idx:
                clause_tiers.append(max(idx))
        if clause_tiers:
            return TIERS[min(clause_tiers)][0], False
    if size:
        nums = [float(n) for n in GB.findall(size)]
        if nums:
            return _tier_for_gb(min(nums)), True
        if re.search(r"\d\s*mb\b", size, re.I):
            return TIERS[1][0], True
    return UNSPEC, False


def merge(records):
    groups = defaultdict(list)
    for r in records:
        groups[norm(r.get("model"))].append(r)
    models = []
    for recs in groups.values():
        recs.sort(key=lambda r: (r.get("video_date") or "", r.get("timestamp") or ""))
        m = {}
        for r in recs:  # later mentions win, but never overwrite with null
            for k, v in r.items():
                if v not in (None, "", []):
                    m[k] = v
        m["category"] = Counter(r.get("category") for r in recs).most_common(1)[0][0]
        m["functions"] = sorted({f for r in recs for f in (r.get("functions") or [])})
        m["first_seen"] = recs[0].get("video_date")
        m["mentions"] = [
            {"video_id": r.get("video_id"), "date": r.get("video_date"), "t": r.get("timestamp")}
            for r in recs
        ]
        for k in ("video_id", "video_date", "timestamp"):
            m.pop(k, None)
        if m.get("local_runnable"):
            m["vram_tier"], m["vram_tier_estimated"] = tier(m.get("hardware"), m.get("size_gb"))
        models.append(m)
    models.sort(key=lambda m: (m["category"], norm(m.get("family")), m.get("first_seen") or "", norm(m["model"])))
    return models


def src_links(m, titles):
    out = []
    for x in m["mentions"]:
        url = f"https://www.youtube.com/watch?v={x['video_id']}&t={ts_seconds(x['t'])}s"
        title = cell(titles.get(x["video_id"], x["video_id"]))[:40]
        out.append(f"[{x['date']}]({url} \"{title}\")")
    return " ".join(out)


def size_cell(m):
    parts = [p for p in (m.get("params"), m.get("size_gb")) if p]
    return cell(" · ".join(parts)) if parts else "—"


def render_category(cat, models, titles, meta):
    lines = [
        f"# {CATEGORIES.get(cat, cat)}",
        "",
        f"Generated by `build-catalog.py` from {meta['source']} transcripts ({meta['span']}). "
        "Facts = as stated in the video; `—` = not stated. Verify before relying on numbers.",
        "",
        f"{len(models)} models. Columns: Open = open weights · Local = runnable locally per video.",
        "",
        "| Model | Vendor | Open | Local | Params / size | Hardware | Run with | Access | Good for | Weak spots | Sources |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for m in models:
        lines.append("| " + " | ".join([
            f"**{cell(m['model'])}**", cell(m.get("vendor")), cell(m.get("open_weights")),
            cell(m.get("local_runnable")), size_cell(m), cell(m.get("hardware")), cell(m.get("tooling")),
            cell(m.get("access")), cell(m.get("strengths")), cell(m.get("weaknesses")), src_links(m, titles),
        ]) + " |")
    return "\n".join(lines) + "\n"


def render_local(models, meta):
    local = [m for m in models if m.get("local_runnable")]
    by_tier = defaultdict(list)
    for m in local:
        by_tier[m["vram_tier"]].append(m)
    lines = [
        "# Local-runnable models by hardware tier",
        "",
        f"Generated by `build-catalog.py` from {meta['source']} transcripts ({meta['span']}). "
        "Tier = smallest hardware class the video says the model (or a quantized variant) runs on: "
        "explicit GB figure first, else the presenter's wording (\"fits most consumer GPUs\" → T2), "
        "else *est.* from checkpoint size (≈ memory needed). GB = VRAM, or unified RAM on Apple Silicon. "
        "`unspecified` = local per video, no hardware hint.",
        "",
        f"{len(local)} local-runnable models.",
        "",
        "| Tier | Count |",
        "|---|---|",
    ]
    labels = [t[0] for t in TIERS] + [UNSPEC]
    for label in labels:
        if by_tier.get(label):
            anchor = re.sub(r"[^a-z0-9 -]", "", label.lower()).strip().replace(" ", "-")
            lines.append(f"| [{label}](#{anchor}) | {len(by_tier[label])} |")
    for label in labels:
        ms = by_tier.get(label)
        if not ms:
            continue
        lines += ["", f"## {label}", "", "| Model | Category | Params / size | Hardware (as stated) | Run with | License |", "|---|---|---|---|---|---|"]
        for m in sorted(ms, key=lambda m: (m["category"], norm(m["model"]))):
            hw = cell(m.get("hardware")) + (" *(est. from size)*" if m.get("vram_tier_estimated") else "")
            lines.append("| " + " | ".join([
                f"**{cell(m['model'])}**", f"[{m['category']}]({m['category']}.md)", size_cell(m),
                hw, cell(m.get("tooling")), cell(m.get("license")),
            ]) + " |")
    return "\n".join(lines) + "\n"


def render_readme(models, by_cat, meta, n_videos):
    local = sum(1 for m in models if m.get("local_runnable"))
    opened = sum(1 for m in models if m.get("open_weights"))
    lines = [
        "# AI model catalog",
        "",
        f"Source: [{meta['source']}]({meta['channel_url']}) weekly AI-news videos, {meta['span']}, {n_videos} videos.",
        "Built by the `youtube-srt` skill (`packages/video-transcription/.pi/skills/youtube-srt/`): "
        "auto-captions → per-video LLM extraction → `build-catalog.py`.",
        "",
        f"{len(models)} models · {opened} open-weights · {local} local-runnable.",
        "",
        "Caveats: auto-caption ASR → names may be misheard; specs = as claimed in the video, unverified; "
        "a model seen in several videos keeps its latest stated facts.",
        "",
        "**Start here:** [picks.md](picks.md) \u2014 curated best-for-task / best-per-hardware shortlist.",
        "",
        "## By function",
        "",
        "| Category | Models | Open | Local |",
        "|---|---|---|---|",
    ]
    for cat in CATEGORIES:
        ms = by_cat.get(cat)
        if ms:
            lines.append(f"| [{CATEGORIES[cat]}]({cat}.md) | {len(ms)} | "
                         f"{sum(1 for m in ms if m.get('open_weights'))} | {sum(1 for m in ms if m.get('local_runnable'))} |")
    lines += [
        "",
        "## By hardware",
        "",
        "[Local-runnable models by VRAM tier](local-hardware.md)",
        "",
        "## Data",
        "",
        "`models.jsonl` — merged records, one model per line (`mentions[]` = video id, date, timestamp).",
        "",
        "## Regenerate",
        "",
        "```bash",
        "S=packages/video-transcription/.pi/skills/youtube-srt/scripts",
        f"$S/yt-srt.sh -s now-6months \"{meta['channel_url']}\"   # fetch new transcripts",
        "# run extraction subagents (see SKILL.md) → <out>/extract/*.jsonl",
        f"python3 $S/build-catalog.py ~/Documents/Media/youtube/theAIsearch/extract docs/models",
        "```",
    ]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("extract_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--source", default="AI Search")
    ap.add_argument("--channel-url", default="https://www.youtube.com/@theAIsearch")
    a = ap.parse_args()

    records = []
    for f in sorted(glob.glob(os.path.join(a.extract_dir, "*.jsonl"))):
        with open(f, encoding="utf-8") as fh:
            records += [json.loads(l) for l in fh if l.strip()]
    titles = {}
    index = os.path.join(os.path.dirname(os.path.abspath(a.extract_dir)), "index.tsv")
    if os.path.exists(index):
        for l in open(index, encoding="utf-8"):
            p = l.rstrip("\n").split("\t")
            if len(p) >= 5:
                titles[p[0]] = p[4]

    models = merge(records)
    dates = sorted(r.get("video_date") for r in records if r.get("video_date"))
    meta = {"source": a.source, "channel_url": a.channel_url, "span": f"{dates[0]} → {dates[-1]}" if dates else "n/a"}
    by_cat = defaultdict(list)
    for m in models:
        by_cat[m["category"]].append(m)

    os.makedirs(a.out_dir, exist_ok=True)
    for cat, ms in by_cat.items():
        with open(os.path.join(a.out_dir, f"{cat}.md"), "w", encoding="utf-8") as fh:
            fh.write(render_category(cat, ms, titles, meta))
    with open(os.path.join(a.out_dir, "local-hardware.md"), "w", encoding="utf-8") as fh:
        fh.write(render_local(models, meta))
    with open(os.path.join(a.out_dir, "README.md"), "w", encoding="utf-8") as fh:
        fh.write(render_readme(models, by_cat, meta, len({r.get("video_id") for r in records})))
    with open(os.path.join(a.out_dir, "models.jsonl"), "w", encoding="utf-8") as fh:
        for m in models:
            fh.write(json.dumps(m, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"{len(records)} records → {len(models)} models, {len(by_cat)} categories → {a.out_dir}")


if __name__ == "__main__":
    main()
