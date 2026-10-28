#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Build the GEO Radar feature tour video:
  - per-scene Edge TTS (natural zh-CN voice) + SRT
  - Ken-burns-free still scenes with soft fades
  - concat + global subtitles burn-in
"""
import os
import re
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCREENS = ROOT / "docs" / "assets" / "video" / "screens"
OUT = ROOT / "docs" / "assets" / "video"
WORK = OUT / "work"
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
    ("00-title", "嗯，你好，这里是 GEO Radar。接下来，我想用一套完整的数据，带你看一遍，从搜索采集，到证据、矩阵、复测、比较和报告，整个流程是怎么跑起来的。"),
    ("00b-section-1", "我们先从配置开始。GEO Radar 不靠猜，第一步，是把品牌和要问的问题，定义清楚。"),
    ("01-dashboard", "这是总览页。它只统计真实搜索任务。演示环境用的是模拟数据，所以这里的指标是空的。你别以为这是加载失败啊，这是平台故意把模拟数据挡在真实统计之外。"),
    ("02-brands", "品牌管理里，除了正式名称，还能填别名、官网、官方子域和产品名。后面页面算不算你的，文本有没有提到你，靠的就是这些配置。"),
    ("03-questions", "问题集，是我们固定观测的基准。每个问题都有类别、优先级和启用状态。你每次改问题，平台都会生成一个新版本。历史任务用的，是当时那个版本，不会被你后来改的内容悄悄改掉。"),
    ("00c-section-2", "配置好了，就开始采集。"),
    ("04-search-lab", "在搜索实验室里建任务，选品牌、选问题集、选执行模式。注意啊，建任务本身不会调接口，只有你确认执行，才真的发请求。页面上会先告诉你，大概要发多少次。"),
    ("05-task-items", "任务详情会按问题，把执行状态、结果数、解析异常、尝试次数和 RequestId 都列出来。失败、空结果、成功，是三种状态。平台不会把失败，直接当成品牌没出现。"),
    ("14-task-results", "每条搜索结果，都会留下标题、URL、域名、摘要，还有页面类型、来源角色和品牌匹配依据。你想再往下看，就点证据详情。"),
    ("06-evidence-list", "证据库可以按品牌、任务、页面类型、复核状态来筛。页面类型不是拍脑袋写的，每条结论都记着命中了哪条规则、规则是什么版本。"),
    ("07-evidence-detail", "证据详情这里，我特意把两层数据分开了。上面是接口原始返回的标题、URL、摘要和 RequestId；下面是分析之后的页面类型、匹配依据和人工复核。你手动改，只改分析层，原始数据不会动。还有一句得说清楚：普通搜索结果，推断不了最终生成式回答有没有引用这条页面。"),
    ("00d-section-3", "证据攒下来，就可以看矩阵了。"),
    ("08b-matrix-table", "矩阵横着是问题，竖着是品牌和竞品。每个格子会区分已发现、未发现、失败、空结果、待复核。你看这个行业知识问题，品牌和竞品都没出现，这就是一个真实的未发现，不是任务失败。"),
    ("15-matrix-cell", "随便点一个格子，就能看到这个问题下的证据。就算没发现品牌，也能翻原始搜索结果，人工对一遍。"),
    ("09-snapshots", "每轮任务跑完，平台会存一份采集快照，这份快照是不可变的。你用新规则重算，会另存一份 RECOMPUTE 快照，和原来的 COLLECTION 快照并排放着，不会把历史改掉。"),
    ("00e-section-4", "两轮数据都有了，就可以比较。"),
    ("10-compare", "比较页会先检查，两轮的条件是不是一致，再给你各自的指标，和共同可比的问题子集。分子分母都摆出来，避免拿不同样本量，硬比。"),
    ("16-compare-pages", "页面变化分成三类：新出现、没再出现、持续出现。同域名不同路径不会合并，页面是按规范化 URL 去重的。"),
    ("17-compare-volatility", "波动分析只给观测到的最小值、最大值和极差，而且会明确告诉你，这不是置信区间。重复采集之间可能有时间相关性，平台不会拿一个看起来很精确的区间，去过度承诺。"),
    ("00f-section-5", "最后，把证据和变化，写成一份能复核的报告。"),
    ("11-report-top", "报告保存的是生成那一刻的快照。任务、问题集版本、采集成功率、有效样本、指标口径，全都在里面。后面数据再变，也不会改写这份报告。"),
    ("19-report-matrix", "报告里的品牌问题矩阵、页面类型分布，都能回到具体证据。规则版本、数据版本，也都标着。"),
    ("20-report-evidence", "代表性证据会带标题、来源链接、页面类型、匹配依据和 RequestId。报告可以导出 HTML、Markdown，还有三类 CSV。"),
    ("21-report-suggestions", "优化建议是规则生成的，每一条都关联证据和问题。它不会把未发现，直接说成官网技术错误，也不会承诺一定提升。"),
    ("12-schedules", "定时采集靠外部 cron 或者独立的 scheduler 进程，不依赖浏览器开着。排期可以暂停、恢复、取消，同一个计划时间，只会建一次任务。"),
    ("22-schedule-dialog", "建真实排期之前，页面会先算预计请求数，还要你明确确认调用成本。执行失败就保留失败状态，不会拿模拟数据去填。"),
    ("13-settings", "设置页管元宝搜索和模型配置。密钥只在服务端加密保存，前端只看得到掩码。没配置，或者没通过连接测试，就不会跑真实任务。"),
    ("24-chat", "除了核心证据链，平台还留着对话工作台。它支持搜索问答、搜索证据、GEO 分析三种模式。注意啊，这里和实验室任务，是两套指标口径，别混着看。"),
    ("26-tasks", "任务与用量页，记录真实调用次数和已知的 Token 用量。服务商没返回费用，平台就不估算。"),
    ("28-architecture", "再回头看整体架构。前端是 Next.js App Router，所有 API 都过工作空间鉴权。搜索执行、证据分析、矩阵、快照、比较、报告、排期，拆成独立服务，统一通过 Prisma 落到 PostgreSQL。真实搜索只从元宝 SearchPro 进来，定时任务由外部 cron 触发。"),
    ("29-data-layers", "数据分四层。最底下是原始响应，完整 JSON 和 RequestId 都留着；往上是规范化后的搜索结果；再往上是页面级证据，页面类型、来源角色、匹配依据都在这层；最上面是分析快照，矩阵、比较、报告都从这层出。原始层只追加不覆盖，分析层可以按规则版本重算。"),
    ("23-end", "这就是 GEO Radar 的完整流程。从真实搜索出发，把每一条结论，都落回证据。好，感谢你看完。"),
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
    srt_path = OUT / "georadar-feature-tour.srt"
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
    script = ["# GEO Radar 功能全景与使用演示 · 视频脚本", "",
              f"- 总时长：约 {int(total // 60)} 分 {int(total % 60)} 秒",
              f"- 配音：Edge TTS `{VOICE}`（自然中文）",
              "- 字幕：随音频自动生成，`docs/assets/video/georadar-feature-tour.srt`", ""]
    for i, m in enumerate(manifest, 1):
        script.append(f"## {i:02d} {m['id']}（{m['duration']:.1f}s）")
        script.append("")
        script.append(m["text"])
        script.append("")
    (ROOT / "docs" / "video-script.md").write_text("\n".join(script), encoding="utf-8")

    print("BASE", base)
    print("DURATION", round(total, 1), "seconds")
    print("SRT", srt_path)


if __name__ == "__main__":
    main()
