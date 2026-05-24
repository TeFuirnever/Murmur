const path = require("path");
const os = require("os");
const fs = require("fs");
const { dialog } = require("electron");
const C = require("../ipc-contracts");
const exportFormatters = require("../exportFormatters");

function register(ipcMain, managers) {
  const { funasrManager, databaseManager, logger, processTextWithAI } =
    managers;

  ipcMain.handle(C.TRANSCRIPTION.AUDIO, async (event, audioData, options) => {
    return await funasrManager.transcribeAudio(audioData, options);
  });

  ipcMain.handle(C.TRANSCRIPTION.IMPORT_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "选择音频文件",
        filters: [
          {
            name: "音频文件",
            extensions: ["wav", "mp3", "m4a", "flac", "ogg", "wma", "aac"],
          },
          { name: "所有文件", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const filePath = result.filePaths[0];
      const stat = fs.statSync(filePath);
      return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        fileSize: stat.size,
        extension: path.extname(filePath).toLowerCase(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    C.TRANSCRIPTION.TRANSCRIBE_FILE,
    async (event, audioPath, options = {}) => {
      const allowedExts = [".wav", ".mp3", ".m4a", ".flac"];
      const ext = path.extname(audioPath).toLowerCase();
      if (!allowedExts.includes(ext)) {
        return { success: false, error: "不支持的音频格式: " + ext };
      }
      const resolved = path.resolve(audioPath);
      const homedir = os.homedir();
      const tmpdir = os.tmpdir();
      if (!resolved.startsWith(homedir) && !resolved.startsWith(tmpdir)) {
        return { success: false, error: "路径不在允许范围内" };
      }
      const result = await funasrManager.transcribeFile(audioPath, {
        ...options,
        onProgress: (progress) => {
          event.sender.send(C.EVENTS.FILE_TRANSCRIPTION_PROGRESS, progress);
        },
      });

      if (result.success && result.text) {
        try {
          const dbResult = databaseManager.saveTranscription({
            text: result.text,
            processed_text: result.raw_text || result.text,
            source_type: "file",
            source_file_path: path.basename(audioPath),
            segments: result.segments ? JSON.stringify(result.segments) : null,
            duration: result.duration || null,
          });
          if (dbResult && dbResult.id) {
            result.id = dbResult.id;
          }
        } catch (dbErr) {
          logger.error("保存转录结果到数据库失败:", dbErr);
        }
      }

      return result;
    },
  );

  ipcMain.handle(C.TRANSCRIPTION.CANCEL, async () => {
    return await funasrManager.cancelTranscription();
  });

  ipcMain.handle(
    C.TRANSCRIPTION.EXPORT,
    async (event, id, format, _options = {}) => {
      try {
        const row = databaseManager.getTranscriptionById(id);
        if (!row) {
          return { success: false, error: "转录记录不存在" };
        }

        let segments = [];
        if (row.segments) {
          try {
            segments = JSON.parse(row.segments);
          } catch (e) {
            logger.warn("Segments JSON parse failed for id", id, e.message);
          }
        }
        const transcription = { ...row, parsedSegments: segments };

        const fmt = exportFormatters.getFormatInfo(format);
        if (!fmt) {
          return { success: false, error: `不支持的格式: ${format}` };
        }

        const content = await fmt.formatter(transcription);
        const isBuffer = Buffer.isBuffer(content);

        const defaultName = `转录_${new Date().toISOString().slice(0, 10)}${fmt.ext}`;
        const saveResult = await dialog.showSaveDialog({
          title: "导出转录文件",
          defaultPath: defaultName,
          filters: [
            {
              name: fmt.ext.replace(".", "").toUpperCase(),
              extensions: [fmt.ext.replace(".", "")],
            },
          ],
        });

        if (saveResult.canceled) {
          return { success: false, canceled: true };
        }

        if (isBuffer) {
          await fs.promises.writeFile(saveResult.filePath, content);
        } else {
          await fs.promises.writeFile(saveResult.filePath, content, "utf-8");
        }

        return { success: true, path: saveResult.filePath };
      } catch (error) {
        logger.error("导出转录失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(C.TRANSCRIPTION.AI_REVIEW, async (event, id, template) => {
    try {
      const row = databaseManager.getTranscriptionById(id);
      if (!row) {
        return { success: false, error: "转录记录不存在" };
      }

      const prompts = exportFormatters.getAIReviewPrompt(
        template,
        row.text || "",
      );
      const result = await processTextWithAI(
        prompts.userPrompt,
        "optimize",
        databaseManager,
        logger,
      );

      if (!result.success) {
        return result;
      }

      return { success: true, reviewText: result.text };
    } catch (error) {
      logger.error("AI创作稿生成失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.TRANSCRIPTION.SAVE, (event, data) => {
    try {
      const result = databaseManager.saveTranscription(data);
      return {
        success: true,
        lastInsertRowid: result.lastInsertRowid ?? result.id,
        changes: result.changes,
      };
    } catch (error) {
      logger.error("保存转录失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.TRANSCRIPTION.GET_ALL, (event, limit, offset) => {
    return databaseManager.getTranscriptions(limit, offset);
  });

  ipcMain.handle(C.TRANSCRIPTION.GET, (event, id) => {
    return databaseManager.getTranscriptionById(id);
  });

  ipcMain.handle(C.TRANSCRIPTION.DELETE, (event, id) => {
    return databaseManager.deleteTranscription(id);
  });

  ipcMain.handle(C.TRANSCRIPTION.SEARCH, (event, query, limit) => {
    return databaseManager.searchTranscriptions(query, limit);
  });

  ipcMain.handle(C.TRANSCRIPTION.STATS, () => {
    return databaseManager.getTranscriptionStats();
  });

  ipcMain.handle(C.TRANSCRIPTION.CLEAR, () => {
    return databaseManager.clearAllTranscriptions();
  });

  ipcMain.handle(C.TRANSCRIPTION.EXPORT_ALL, async (_event, format) => {
    try {
      const transcriptions = databaseManager.getTranscriptions(10000, 0);
      if (!transcriptions || transcriptions.length === 0) {
        return { success: false, error: "没有转录记录可导出" };
      }

      const formatInfo = exportFormatters.getFormatInfo(format || "txt");
      const filters = [
        { name: formatInfo.label, extensions: [formatInfo.ext] },
      ];

      const result = await dialog.showSaveDialog({
        title: "导出转录记录",
        defaultPath: `transcriptions.${formatInfo.ext}`,
        filters,
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      let content;
      if (format === "docx") {
        content = await exportFormatters.formatDOCX(transcriptions);
        fs.writeFileSync(result.filePath, Buffer.from(content));
      } else {
        const formatter =
          format === "srt"
            ? exportFormatters.formatSRT
            : format === "vtt"
              ? exportFormatters.formatVTT
              : format === "md"
                ? exportFormatters.formatMD
                : exportFormatters.formatTXT;
        content = transcriptions.map((t) => formatter(t)).join("\n\n");
        fs.writeFileSync(result.filePath, content, "utf-8");
      }

      return { success: true, path: result.filePath };
    } catch (error) {
      logger.error("导出转录失败:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
