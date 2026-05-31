const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
} = require("docx");

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  const milli = String(ms % 1000).padStart(3, "0");
  return { h, m, s, milli };
}

function formatSrtTime(ms) {
  const { h, m, s, milli } = formatMs(ms);
  return `${h}:${m}:${s},${milli}`;
}

function formatVttTime(ms) {
  const { h, m, s, milli } = formatMs(ms);
  return `${h}:${m}:${s}.${milli}`;
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function smartMergeSrt(segments) {
  if (!segments || segments.length === 0) return [];

  const result = [];
  let current = null;

  for (const seg of segments) {
    if (!current) {
      current = { start_ms: seg.start_ms, end_ms: seg.end_ms, text: seg.text };
      continue;
    }

    const duration = current.end_ms - current.start_ms;
    const combinedText = current.text + seg.text;
    const endsWithPunct = /[。！？；\n]$/.test(current.text);

    if (
      !endsWithPunct &&
      duration < 3000 &&
      combinedText.length <= 42 &&
      seg.end_ms - current.start_ms <= 7000
    ) {
      current.text = combinedText;
      current.end_ms = seg.end_ms;
    } else {
      result.push(current);
      current = { start_ms: seg.start_ms, end_ms: seg.end_ms, text: seg.text };
    }
  }

  if (current) result.push(current);

  for (const sub of result) {
    if (sub.text.length > 42) {
      const parts = [];
      let remaining = sub.text;
      while (remaining.length > 42) {
        let breakAt = 42;
        for (let i = 42; i > 20; i--) {
          if (/[，、,；;]/.test(remaining[i])) {
            breakAt = i + 1;
            break;
          }
        }
        parts.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt);
      }
      if (remaining) parts.push(remaining);
      sub.text = parts.join("\n");
    }
  }

  return result;
}

function formatTXT(transcription) {
  const lines = [];
  lines.push("=".repeat(50));
  lines.push("转录文本");
  lines.push("=".repeat(50));
  if (transcription.source_file_path) {
    lines.push(`来源文件: ${transcription.source_file_path}`);
  }
  if (transcription.duration) {
    lines.push(`音频时长: ${formatDuration(transcription.duration)}`);
  }
  if (transcription.created_at) {
    lines.push(`转录时间: ${transcription.created_at}`);
  }
  lines.push("-".repeat(50));
  lines.push("");
  lines.push(transcription.text || "");
  return lines.join("\n");
}

function formatSRT(transcription) {
  const segments = transcription.parsedSegments || [];
  if (segments.length === 0) {
    const start = "00:00:00,000";
    const end = transcription.duration
      ? formatSrtTime(Math.floor(transcription.duration * 1000))
      : "00:00:00,000";
    return `1\n${start} --> ${end}\n${transcription.text || ""}\n`;
  }

  const merged = smartMergeSrt(segments);
  return merged
    .map(
      (seg, i) =>
        `${i + 1}\n${formatSrtTime(seg.start_ms)} --> ${formatSrtTime(seg.end_ms)}\n${seg.text}\n`,
    )
    .join("\n");
}

function formatVTT(transcription) {
  const segments = transcription.parsedSegments || [];
  let vtt = "WEBVTT\n\n";

  if (segments.length === 0) {
    const start = "00:00:00.000";
    const end = transcription.duration
      ? formatVttTime(Math.floor(transcription.duration * 1000))
      : "00:00:00.000";
    vtt += `${start} --> ${end}\n${transcription.text || ""}\n`;
    return vtt;
  }

  const merged = smartMergeSrt(segments);
  vtt += merged
    .map(
      (seg) =>
        `${formatVttTime(seg.start_ms)} --> ${formatVttTime(seg.end_ms)}\n${seg.text}\n`,
    )
    .join("\n");
  return vtt;
}

function formatMD(transcription) {
  const lines = [];
  lines.push("---");
  lines.push(`date: "${transcription.created_at || new Date().toISOString()}"`);
  if (transcription.source_file_path) {
    lines.push(`source: "${transcription.source_file_path}"`);
  }
  if (transcription.duration) {
    lines.push(`duration: "${formatDuration(transcription.duration)}"`);
  }
  lines.push("---");
  lines.push("");
  lines.push("# 转录文本");
  lines.push("");
  lines.push(transcription.text || "");
  lines.push("");

  const segments = transcription.parsedSegments || [];
  if (segments.length > 0) {
    lines.push("## 分段时间线");
    lines.push("");
    lines.push("| 开始 | 结束 | 文本 |");
    lines.push("|------|------|------|");
    for (const seg of segments) {
      const start = formatDuration(seg.start_ms / 1000);
      const end = formatDuration(seg.end_ms / 1000);
      lines.push(`| ${start} | ${end} | ${seg.text} |`);
    }
  }

  return lines.join("\n");
}

async function formatDOCX(transcription) {
  const children = [];

  children.push(
    new Paragraph({
      text: "转录文本",
      heading: HeadingLevel.HEADING_1,
    }),
  );

  const metaParts = [];
  if (transcription.source_file_path) {
    metaParts.push(`来源文件: ${transcription.source_file_path}`);
  }
  if (transcription.duration) {
    metaParts.push(`音频时长: ${formatDuration(transcription.duration)}`);
  }
  if (transcription.created_at) {
    metaParts.push(`转录时间: ${transcription.created_at}`);
  }
  if (metaParts.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: metaParts.join("  |  "),
            italics: true,
            color: "666666",
          }),
        ],
      }),
    );
  }

  children.push(new Paragraph({ text: "" }));

  const textParagraphs = (transcription.text || "").split("\n");
  for (const line of textParagraphs) {
    children.push(new Paragraph({ text: line }));
  }

  const segments = transcription.parsedSegments || [];
  if (segments.length > 0) {
    children.push(new Paragraph({ text: "" }));
    children.push(
      new Paragraph({
        text: "分段时间线",
        heading: HeadingLevel.HEADING_2,
      }),
    );

    const headerRow = new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph("开始")],
          width: { size: 15, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph("结束")],
          width: { size: 15, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph("文本")],
          width: { size: 70, type: WidthType.PERCENTAGE },
        }),
      ],
    });

    const dataRows = segments.map(
      (seg) =>
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(formatDuration(seg.start_ms / 1000))],
            }),
            new TableCell({
              children: [new Paragraph(formatDuration(seg.end_ms / 1000))],
            }),
            new TableCell({ children: [new Paragraph(seg.text)] }),
          ],
        }),
    );

    children.push(
      new Table({
        rows: [headerRow, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }),
    );
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return await Packer.toBuffer(doc);
}

const FORMAT_MAP = {
  txt: { formatter: formatTXT, ext: ".txt", mime: "text/plain" },
  srt: { formatter: formatSRT, ext: ".srt", mime: "text/plain" },
  vtt: { formatter: formatVTT, ext: ".vtt", mime: "text/plain" },
  md: { formatter: formatMD, ext: ".md", mime: "text/markdown" },
  docx: {
    formatter: formatDOCX,
    ext: ".docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};

function getFormatInfo(formatName) {
  return FORMAT_MAP[formatName] || null;
}

module.exports = {
  formatTXT,
  formatSRT,
  formatVTT,
  formatMD,
  formatDOCX,
  getFormatInfo,
  smartMergeSrt,
};
