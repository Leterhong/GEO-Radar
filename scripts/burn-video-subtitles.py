#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Re-burn subtitles from the generated SRT into an ASS style with a fixed 1920x1080 canvas."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIDEO_DIR = ROOT / "docs" / "assets" / "video"
SRT = VIDEO_DIR / "georadar-feature-tour.srt"
BASE = VIDEO_DIR / "work" / "base.mp4"
FINAL = VIDEO_DIR / "GEO-Radar-功能全景与使用演示-1440p.mp4"
ASS = VIDEO_DIR / "work" / "tour.ass"
FF = r"C:\Users\LENOVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"


def parse_srt(path):
    cues = []
    for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip()):
        lines = [line for line in block.splitlines() if line.strip()]
        if len(lines) < 3:
            continue
        m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", lines[1])
        if not m:
            continue
        start = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000
        end = int(m.group(5)) * 3600 + int(m.group(6)) * 60 + int(m.group(7)) + int(m.group(8)) / 1000
        text = "".join(lines[2:]).strip()
        cues.append([start, end, text])
    return cues


def split_at(text, limit=44):
    """Split one long cue into two cues near a punctuation/space midpoint."""
    if len(text) <= limit:
        return [text]
    mid = len(text) // 2
    candidates = [i for i, ch in enumerate(text) if ch in "，。；：、,.!?！？ "]
    if candidates:
        cut = min(candidates, key=lambda i: abs(i - mid))
        left, right = text[: cut + 1].strip(), text[cut + 1 :].strip()
        if left and right:
            return [left, right]
    return [text[:mid].strip(), text[mid:].strip()]


def wrap(text, width=22):
    lines = []
    while len(text) > width:
        # prefer punctuation near width
        cut = -1
        for ch in "，。；：、,.!?！？ ":
            idx = text.rfind(ch, 0, width + 1)
            if idx > cut:
                cut = idx
        if cut < width // 2:
            cut = width
        lines.append(text[: cut + 1].strip())
        text = text[cut + 1 :].strip()
    if text:
        lines.append(text)
    return r"\N".join(lines[:3])


def ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs == 100:
        s += 1
        cs = 0
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


cues = parse_srt(SRT)
normalized = []
for start, end, text in cues:
    pieces = split_at(text)
    total = sum(len(p) for p in pieces) or 1
    cursor = start
    for piece in pieces:
        span = (end - start) * len(piece) / total
        normalized.append((cursor, min(end, cursor + span), piece))
        cursor += span

header = """[Script Info]
ScriptType: v4.00+
PlayResX: 2560
PlayResY: 1440
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,40,&H00FFFFFF,&H000000FF,&H00000000,&H99000000,0,0,0,0,100,100,0,0,4,0,0,2,200,200,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
lines = [header]
for start, end, text in normalized:
    text = text.replace("{", "（").replace("}", "）").replace("\\", "＼")
    lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{wrap(text)}")
ASS.write_text("\n".join(lines), encoding="utf-8")

subprocess.run(
    [FF, "-y", "-hide_banner", "-loglevel", "error", "-i", str(BASE),
     "-vf", f"subtitles={ASS.name}",
     "-c:v", "libx264", "-preset", "medium", "-crf", "18",
     "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
     "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
     "-movflags", "+faststart", str(FINAL)],
    cwd=str(ASS.parent),
    check=True,
)
print("FINAL", FINAL)
print("CUES", len(normalized))
