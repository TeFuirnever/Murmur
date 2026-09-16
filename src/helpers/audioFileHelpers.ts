// [20260724_TS_BigBang_AudioFileHelpers] Migrated implementation from .js
// to .ts (ADR-010). Was a type re-export stub; now the full temp-file +
// ffmpeg conversion implementation lives here. `module.exports = { ... }`
// became named exports.
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

/** Minimal logger interface. */
interface Logger {
  info?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

/** Supported audio blob input types. */
type AudioBlob = ArrayBuffer | Uint8Array | string | { buffer: ArrayBuffer };

let _ffmpegPath: string | null | undefined = undefined;
let _detectFFmpeg: (() => string | null) | null = null;

function _defaultDetectFFmpeg(): string | null {
  try {
    const cmd = process.platform === "win32" ? "where ffmpeg" : "which ffmpeg";
    const result = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (result) {
      return result.split("\n")[0]!.trim();
    }
  } catch {}
  return null;
}

export function getFFmpegPath(): string | null {
  if (_ffmpegPath !== undefined) return _ffmpegPath;
  const detect = _detectFFmpeg || _defaultDetectFFmpeg;
  const result = detect();
  _ffmpegPath = result ? result.split("\n")[0]!.trim() : null;
  return _ffmpegPath;
}

export function _resetFFmpegCache(): void {
  _ffmpegPath = undefined;
}

export function _setFFmpegDetector(fn: () => string | null): void {
  _detectFFmpeg = fn;
  _resetFFmpegCache();
}

export async function createTempAudioFile(
  logger: Logger,
  audioBlob: AudioBlob,
): Promise<string> {
  const tempDir = os.tmpdir();
  const filename = `funasr_audio_${crypto.randomUUID()}.wav`;
  const tempAudioPath = path.join(tempDir, filename);
  logger.info && logger.info("创建临时文件:", tempAudioPath);

  let buffer: Buffer;
  if (audioBlob instanceof ArrayBuffer) {
    buffer = Buffer.from(audioBlob);
  } else if (audioBlob instanceof Uint8Array) {
    buffer = Buffer.from(audioBlob);
  } else if (typeof audioBlob === "string") {
    buffer = Buffer.from(audioBlob, "base64");
  } else if (audioBlob && audioBlob.buffer) {
    buffer = Buffer.from(audioBlob.buffer);
  } else {
    throw new Error(`不支持的音频数据类型: ${typeof audioBlob}`);
  }

  logger.debug && logger.debug("缓冲区创建，大小:", buffer.length);
  await fs.promises.writeFile(tempAudioPath, buffer);

  const stats = await fs.promises.stat(tempAudioPath);
  logger.info &&
    logger.info("临时音频文件创建:", {
      path: tempAudioPath,
      size: stats.size,
      isFile: stats.isFile(),
    });

  if (stats.size === 0) throw new Error("音频文件为空");
  return tempAudioPath;
}

export async function cleanupTempFile(tempAudioPath: string): Promise<void> {
  try {
    await fs.promises.unlink(tempAudioPath);
  } catch (_e) {
    /* not critical */
  }
}

// Reserved for Layer 2/3 fallback (Web Audio API / on-demand ffmpeg)
export async function convertAudioFile(
  logger: Logger,
  inputPath: string,
): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase();
  if ([".wav", ".flac"].includes(ext)) return inputPath;

  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    throw new Error(
      "未找到 ffmpeg。mp3/m4a 等格式转换需要 ffmpeg，请先安装：\n" +
        "  macOS:   brew install ffmpeg\n" +
        "  Windows: winget install ffmpeg\n" +
        "  Linux:   sudo apt install ffmpeg",
    );
  }

  const outputName = `funasr_conv_${crypto.randomUUID()}.wav`;
  const outputPath = path.join(os.tmpdir(), outputName);

  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      outputPath,
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderrOutput = "";
    proc.stderr.on("data", (d) => {
      stderrOutput += d.toString();
    });

    const timeout = setTimeout(
      () => {
        proc.kill("SIGKILL");
        reject(new Error("ffmpeg 转换超时（5分钟）"));
      },
      5 * 60 * 1000,
    );

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`ffmpeg 启动失败: ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {
            logger?.warn?.("Temp file cleanup failed", (e as Error).message);
          }
        }
        reject(
          new Error(
            `ffmpeg 转换失败 (code=${code}): ${stderrOutput.slice(-200)}`,
          ),
        );
      }
    });
  });
}

export type { Logger as AudioLogger, AudioBlob };
