const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

async function createTempAudioFile(logger, audioBlob) {
  const tempDir = os.tmpdir();
  const filename = `funasr_audio_${crypto.randomUUID()}.wav`;
  const tempAudioPath = path.join(tempDir, filename);
  logger.info && logger.info("创建临时文件:", tempAudioPath);

  let buffer;
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
  logger.info && logger.info("临时音频文件创建:", {
    path: tempAudioPath, size: stats.size, isFile: stats.isFile(),
  });

  if (stats.size === 0) throw new Error("音频文件为空");
  return tempAudioPath;
}

async function cleanupTempFile(tempAudioPath) {
  try { await fs.promises.unlink(tempAudioPath); } catch (_e) { /* not critical */ }
}

function getFFmpegPath() {
  return "ffmpeg";
}

async function convertAudioFile(logger, inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if ([".wav", ".flac"].includes(ext)) return inputPath;

  const ffmpegPath = getFFmpegPath();
  const outputName = `funasr_conv_${crypto.randomUUID()}.wav`;
  const outputPath = path.join(os.tmpdir(), outputName);

  return new Promise((resolve, reject) => {
    const args = ["-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "wav", outputPath];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderrOutput = "";
    proc.stderr.on("data", (d) => { stderrOutput += d.toString(); });

    const timeout = setTimeout(
      () => { proc.kill("SIGKILL"); reject(new Error("ffmpeg 转换超时（5分钟）")); },
      5 * 60 * 1000,
    );

    proc.on("error", (err) => { clearTimeout(timeout); reject(new Error(`ffmpeg 启动失败: ${err.message}`)); });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch (e) { logger?.warn?.("Temp file cleanup failed", e.message); }
        }
        reject(new Error(`ffmpeg 转换失败 (code=${code}): ${stderrOutput.slice(-200)}`));
      }
    });
  });
}

module.exports = { createTempAudioFile, cleanupTempFile, getFFmpegPath, convertAudioFile };
