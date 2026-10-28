#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Build the Yuanbao Search contest video:
  - real Yuanbao workspace screens + dedicated SearchPro/architecture slides
  - natural zh-CN Edge TTS + per-scene SRT
  - 2560x1440 output; subtitles are burned by burn-yuanbao-subtitles.py
"""
import os
import re
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCREENS = ROOT / "docs" / "assets" / "video" / "yuanbao-screens"
OUT = ROOT / "docs" / "assets" / "video"
WORK = OUT / "work-yuanbao"
WORK.mkdir(parents=True, exist_ok=True)
PY = r"C:\Users\LENOVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
FF = r"C:\Users\LENOVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-16%"
PITCH = "-5Hz"
LEAD = 0.45
TAIL = 0.95
FPS = 30

SCENES = [
    ("00-title", "这次参加元宝搜索开发者征文大赛。我想解决一个很具体的问题：品牌在 AI 搜索里到底有没有出现？是谁在替它说话？"),
    ("00b-section-1", "用户问 AI 哪款产品好用，答案引用的可能不是官网，而是别人写的盘点。要回答这个问题，第一步不是让模型写结论，而是拿到真实网页结果。"),
    ("00c-yuanbao", "所以我选了元宝搜索 SearchPro。它返回的不是一段无法核对的话，而是标题、URL、摘要、站点和 RequestId。官方定位是大模型友好、毫秒级响应、分钟级更新，覆盖全网和腾讯内容生态。这次 10 个问题，单请求实测 165 到 385 毫秒，拿到 98 条结果、18 个品牌相关去重页面。"),
    ("00d-section-2", "接入元宝搜索，核心就是把 Query 变成 Pages 和 RequestId。平台负责鉴权、重试、超时、错误分类，以及把原始响应完整落库。"),
    ("01-settings", "设置页填 SearchPro 的 API Key。密钥在服务端用 AES-256-GCM 加密，前端只看得到掩码；测试连接会发一次真实的 Query-only 请求，这里显示 722 毫秒、RequestId 和成功状态。"),
    ("02-brands", "先把品牌和竞品定义清楚：元宝的官网、别名、产品名，豆包和 Kimi 作为竞品。后面判断一个页面算不算官网、有没有提到品牌，靠的就是这些配置。"),
    ("03-questions", "固定 10 个问题，不每次换题。问题集有版本，历史任务用当时的快照，后面复测才有可比性。"),
    ("04-search-lab", "创建真实任务：数据源选 YUANBAO，10 个问题就是 10 次请求。建任务本身不会调用接口，只有确认执行，才真的发请求。"),
    ("05-task-items", "这是第二轮真实复测：10 个问题全部成功。单请求 81 到 385 毫秒，每条都有 RequestId；失败、空结果、解析异常分开记录。"),
    ("11-task-results", "98 条真实网页结果，按页面类型、来源角色、品牌匹配落成页面级证据。不是把标题抄下来，而是保留 URL、摘要、位置和原始请求。"),
    ("06-evidence-detail", "点开一条证据，上面是元宝搜索原始返回的标题、URL、摘要和 RequestId；下面是规则分析出的页面类型、来源角色和品牌匹配依据。原始层不改，人工复核只改分析层。"),
    ("07-matrix", "矩阵里，元宝在 6 个问题里出现，品牌提及率 60%；官网覆盖率 0%；第三方页面覆盖率 60%；豆包和 Kimi 各 70%。这些数字都能回到具体 URL，不是模型编的。"),
    ("12-matrix-cell", "点开格子可以下钻到证据。就算本次未发现，也能看这个问题的原始搜索结果；失败不等于未发现。"),
    ("08-snapshots", "每轮真实任务会保存一份 COLLECTION 快照。用新规则重算会生成 RECOMPUTE 快照，和原快照并列保存，历史不会被覆盖。"),
    ("09-compare", "两轮真实复测，10 个共同问题，品牌状态 100% 一致；品牌提及率 60% 对 60%，官网 0% 对 0%，第三方 60% 对 60%，观测极差 0。两轮样本不能当成稳定分布，但至少说明这次没有明显漂移。"),
    ("13-compare-pages", "页面变化拆成新出现、未再出现和持续出现；按规范化 URL 去重，同域名不同路径不会被合并。"),
    ("14-compare-volatility", "波动分析只给观测到的最小值、最大值和极差，而且明确说这不是置信区间。两轮在同一天采集，可能存在时间相关性，平台不会过度承诺。"),
    ("10-report-top", "报告把任务、问题集版本、采集成功率、指标分子分母、代表性证据固定下来。这份真实报告是 10 个问题全部成功，品牌 60%、官网 0%、第三方 60%。"),
    ("15-report-matrix", "报告里的品牌问题矩阵和页面类型分布，都能回到证据；规则版本、数据版本也都标着。"),
    ("16-report-evidence", "代表性证据带 URL、页面类型、匹配依据和 RequestId。报告还支持 HTML、Markdown 和三类 CSV 导出。"),
    ("17-report-suggestions", "优化建议由规则生成，每一条关联证据和问题。它不会把未发现直接说成官网技术错误，也不会承诺一定提升。"),
    ("18-completeness", "平台完整性不是页面多，而是这条链完整：品牌配置、固定问题集、元宝真实采集、页面证据、人工复核、问题矩阵、不可变快照、两轮复测、比较、报告、定时采集。失败、空结果、未发现，始终分开。"),
    ("19-architecture", "整体架构里，元宝搜索是唯一真实检索入口。Search Execution 负责请求封装、重试、超时和取消；Evidence 负责 URL 规范化、页面分类和品牌匹配；矩阵、快照、比较、报告都从证据层出；所有数据按 workspaceId 隔离。"),
    ("20-data-layers", "数据分五层：元宝搜索结果、原始响应、规范化结果、页面证据、分析快照。原始层只追加不覆盖，分析层可以按规则版本重算，报告永远能回到证据。"),
    ("21-end", "元宝搜索负责查得到，平台负责说得清。这次参赛想展示的，不是一个漂亮页面，而是一条从真实搜索到可复核报告的完整闭环。"),
]



def run(cmd, cwd=None):
    result = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        print("CMD FAILED:", " ".join(cmd))
        print(result.stderr[-3000:])
        raise SystemExit(result.returncode)
    return result


def tts(scene_id, text):
    mp3 = WORK / f"{scene_id}.mp3"
    srt = WORK / f"{scene_id}.srt"
    for attempt in range(4):
        try:
            run([PY, "-m", "edge_tts", "--voice", VOICE, "--rate=" + RATE, "--pitch=" + PITCH,
                 "--text", text, "--write-media", str(mp3), "--write-subtitles", str(srt), "--no-progress"])
            if mp3.exists() and mp3.stat().st_size > 1000 and srt.exists():
                return mp3, srt
        except SystemExit:
            pass
        print(f"retry tts {scene_id} ({attempt + 1}/4)")
    raise RuntimeError(f"TTS failed: {scene_id}")


def to_wav(mp3):
    wav = mp3.with_suffix(".wav")
    run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", str(mp3), "-ar", "48000", "-ac", "2", str(wav)])
    with wave.open(str(wav), "rb") as w:
        return wav, w.getnframes() / float(w.getframerate())


def parse_srt(path):
    text = path.read_text(encoding="utf-8").strip()
    cues = []
    for block in re.split(r"\n\s*\n", text):
        lines = [line for line in block.splitlines() if line.strip()]
        if len(lines) < 3:
            continue
        m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", lines[1])
        if not m:
            continue
        start = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000
        end = int(m.group(5)) * 3600 + int(m.group(6)) * 60 + int(m.group(7)) + int(m.group(8)) / 1000
        cues.append((start, end, "\n".join(lines[2:]).strip()))
    return cues


def fmt_time(seconds):
    seconds = max(0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_scene(scene_id, image, duration, wav):
    out = WORK / f"{scene_id}.mp4"
    fade_out = max(0.01, duration - 0.35)
    vf = (
        "scale=2560:1440,setsar=1,format=yuv420p,"
        f"fade=t=in:st=0:d=0.35,fade=t=out:st={fade_out:.3f}:d=0.35"
    )
    af = f"adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad=pad_dur={TAIL}"
    run([FF, "-y", "-hide_banner", "-loglevel", "error",
         "-loop", "1", "-framerate", str(FPS), "-t", f"{duration:.3f}", "-i", str(image),
         "-i", str(wav),
         "-filter_complex", f"[0:v]{vf}[v];[1:a]{af}[a]",
         "-map", "[v]", "-map", "[a]", "-t", f"{duration:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
         "-movflags", "+faststart", str(out)])
    return out


def main():
    missing = [image for image, _ in SCENES if not (SCREENS / f"{image}.png").exists()]
    if missing:
        raise SystemExit("missing screenshots: " + ", ".join(missing))

    subtitles = []
    offset = 0.0
    concat_lines = []
    manifest = []
    for index, (scene_id, text) in enumerate(SCENES):
        print(f"[{index + 1}/{len(SCENES)}] {scene_id}")
        mp3, srt = tts(scene_id, text)
        wav, audio_duration = to_wav(mp3)
        duration = LEAD + audio_duration + TAIL
        scene_video = build_scene(scene_id, SCREENS / f"{scene_id}.png", duration, wav)
        concat_lines.append(f"file '{scene_video.as_posix()}'")
        for start, end, cue_text in parse_srt(srt):
            subtitles.append((offset + LEAD + start, min(offset + duration - 0.05, offset + LEAD + end), cue_text))
        manifest.append({"id": scene_id, "text": text, "duration": duration, "audio": audio_duration})
        offset += duration

    # global SRT
    srt_path = OUT / "georadar-yuanbao-tour.srt"
    with srt_path.open("w", encoding="utf-8") as f:
        for i, (start, end, text) in enumerate(subtitles, 1):
            f.write(f"{i}\n{fmt_time(start)} --> {fmt_time(end)}\n{text}\n\n")

    concat_file = WORK / "concat.txt"
    concat_file.write_text("\n".join(concat_lines), encoding="utf-8")
    base = WORK / "base.mp4"
    run([FF, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", str(concat_file), "-c", "copy", str(base)])

    # 字幕由独立脚本以 2560x1440 画布重新排版并烧录，避免 ASS 默认 288px 画布把字号放大。
    total = sum(m["duration"] for m in manifest)
    script = ["# GEO Radar × 元宝搜索 · 参赛视频脚本", "",
              f"- 总时长：约 {int(total // 60)} 分 {int(total % 60)} 秒",
              f"- 配音：Edge TTS `{VOICE}`（松弛版：rate `-16%`，pitch `-5Hz`）",
              "- 字幕：随音频自动生成，`docs/assets/video/georadar-yuanbao-tour.srt`", ""]
    for i, m in enumerate(manifest, 1):
        script.append(f"## {i:02d} {m['id']}（{m['duration']:.1f}s）")
        script.append("")
        script.append(m["text"])
        script.append("")
    (ROOT / "docs" / "video-script-yuanbao.md").write_text("\n".join(script), encoding="utf-8")

    print("BASE", base)
    print("DURATION", round(total, 1), "seconds")
    print("SRT", srt_path)


if __name__ == "__main__":
    main()
