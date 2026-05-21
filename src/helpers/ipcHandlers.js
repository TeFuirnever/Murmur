const { ipcMain } = require("electron");
const exportFormatters = require("./exportFormatters");

class IPCHandlers {
  static ALLOWED_AI_DOMAINS = [
    "api.openai.com",
    "dashscope.aliyuncs.com",
    "api.bigmodel.cn",
    "open.bigmodel.cn",
  ];

  _validateAIBaseUrl(baseUrl) {
    try {
      const url = new URL(baseUrl);
      return IPCHandlers.ALLOWED_AI_DOMAINS.some(
        (d) => url.hostname === d || url.hostname.endsWith(`.${d}`),
      );
    } catch {
      return false;
    }
  }

  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.funasrManager = managers.funasrManager;
    this.windowManager = managers.windowManager;
    this.hotkeyManager = managers.hotkeyManager;
    this.logger = managers.logger; // 添加logger引用

    // 跟踪F2热键注册状态
    this.f2RegisteredSenders = new Set();

    this.setupHandlers();
  }

  setupHandlers() {
    // 环境和配置相关
    ipcMain.handle("get-config", () => {
      return this.environmentManager.exportConfig();
    });

    ipcMain.handle("validate-environment", () => {
      return this.environmentManager.validateEnvironment();
    });

    // Python 和 FunASR 相关
    ipcMain.handle("check-python", async () => {
      return await this.funasrManager.checkPythonInstallation();
    });

    ipcMain.handle("install-python", async (event, _progressCallback) => {
      return await this.funasrManager.installPython((progress) => {
        event.sender.send("python-install-progress", progress);
      });
    });

    ipcMain.handle("check-funasr", async () => {
      return await this.funasrManager.checkFunASRInstallation();
    });

    ipcMain.handle("check-funasr-status", async () => {
      const status = await this.funasrManager.checkStatus();

      // 添加模型初始化状态信息
      return {
        ...status,
        models_initialized: this.funasrManager.modelsInitialized,
        server_ready: this.funasrManager.serverReady,
        is_initializing: this.funasrManager.initializationPromise !== null,
      };
    });

    ipcMain.handle("install-funasr", async (event) => {
      return await this.funasrManager.installFunASR((progress) => {
        event.sender.send("funasr-install-progress", progress);
      });
    });

    ipcMain.handle("funasr-status", async () => {
      return await this.funasrManager.checkStatus();
    });

    // 模型文件管理
    ipcMain.handle("check-model-files", async () => {
      return await this.funasrManager.checkModelFiles();
    });

    ipcMain.handle("get-download-progress", async () => {
      return await this.funasrManager.getDownloadProgress();
    });

    ipcMain.handle("download-models", async (event) => {
      return await this.funasrManager.downloadModels((progress) => {
        event.sender.send("model-download-progress", progress);
      });
    });

    // AI文本处理
    ipcMain.handle("process-text", async (event, text, mode = "optimize") => {
      return await this.processTextWithAI(text, mode);
    });

    ipcMain.handle("check-ai-status", async (event, testConfig = null) => {
      return await this.checkAIStatus(testConfig);
    });

    // 音频转录相关
    ipcMain.handle("transcribe-audio", async (event, audioData, options) => {
      return await this.funasrManager.transcribeAudio(audioData, options);
    });

    // 文件转录相关
    ipcMain.handle("import-audio-file", async () => {
      try {
        const { dialog } = require("electron");
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
        const fs = require("fs");
        const path = require("path");
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
      "transcribe-file",
      async (event, audioPath, options = {}) => {
        const path = require("path");
        const os = require("os");
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
        const result = await this.funasrManager.transcribeFile(audioPath, {
          ...options,
          onProgress: (progress) => {
            event.sender.send("file-transcription-progress", progress);
          },
        });

        if (result.success && result.text) {
          try {
            const dbResult = this.databaseManager.saveTranscription({
              text: result.text,
              processed_text: result.raw_text || result.text,
              source_type: "file",
              source_file_path: path.basename(audioPath),
              segments: result.segments
                ? JSON.stringify(result.segments)
                : null,
              duration: result.duration || null,
            });
            if (dbResult && dbResult.id) {
              result.id = dbResult.id;
            }
          } catch (dbErr) {
            this.logger.error("保存转录结果到数据库失败:", dbErr);
          }
        }

        return result;
      },
    );

    ipcMain.handle("cancel-file-transcription", async () => {
      return await this.funasrManager.cancelTranscription();
    });

    // 导出转录
    ipcMain.handle(
      "export-transcription",
      async (event, id, format, _options = {}) => {
        try {
          const fs = require("fs");
          const { dialog } = require("electron");

          const row = this.databaseManager.getTranscriptionById(id);
          if (!row) {
            return { success: false, error: "转录记录不存在" };
          }

          let segments = [];
          if (row.segments) {
            try {
              segments = JSON.parse(row.segments);
            } catch (e) {
              this.logger.warn("Segments JSON parse failed for id", id, e.message);
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
          this.logger.error("导出转录失败:", error);
          return { success: false, error: error.message };
        }
      },
    );

    // AI创作稿
    ipcMain.handle("ai-review-transcription", async (event, id, template) => {
      try {
        const row = this.databaseManager.getTranscriptionById(id);
        if (!row) {
          return { success: false, error: "转录记录不存在" };
        }

        const prompts = exportFormatters.getAIReviewPrompt(
          template,
          row.text || "",
        );
        const result = await this.processTextWithAI(
          prompts.userPrompt,
          "optimize",
        );

        if (!result.success) {
          return result;
        }

        return { success: true, reviewText: result.text };
      } catch (error) {
        this.logger.error("AI创作稿生成失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 数据库相关
    ipcMain.handle("save-transcription", (event, data) => {
      return this.databaseManager.saveTranscription(data);
    });

    ipcMain.handle("get-transcriptions", (event, limit, offset) => {
      return this.databaseManager.getTranscriptions(limit, offset);
    });

    ipcMain.handle("get-transcription", (event, id) => {
      return this.databaseManager.getTranscriptionById(id);
    });

    ipcMain.handle("delete-transcription", (event, id) => {
      return this.databaseManager.deleteTranscription(id);
    });

    ipcMain.handle("search-transcriptions", (event, query, limit) => {
      return this.databaseManager.searchTranscriptions(query, limit);
    });

    ipcMain.handle("get-transcription-stats", () => {
      return this.databaseManager.getTranscriptionStats();
    });

    ipcMain.handle("clear-all-transcriptions", () => {
      return this.databaseManager.clearAllTranscriptions();
    });

    // 设置相关
    ipcMain.handle("get-setting", (event, key, defaultValue) => {
      return this.databaseManager.getSetting(key, defaultValue);
    });

    ipcMain.handle("set-setting", (event, key, value) => {
      return this.databaseManager.setSetting(key, value);
    });

    ipcMain.handle("get-all-settings", () => {
      const settings = this.databaseManager.getAllSettings();
      if (settings.ai_api_key && typeof settings.ai_api_key === "string") {
        const key = settings.ai_api_key;
        settings.ai_api_key =
          key.length > 4 ? `****${key.slice(-4)}` : "****";
      }
      return settings;
    });

    ipcMain.handle("get-settings", () => {
      const settings = this.databaseManager.getAllSettings();
      if (settings.ai_api_key && typeof settings.ai_api_key === "string") {
        const key = settings.ai_api_key;
        settings.ai_api_key =
          key.length > 4 ? `****${key.slice(-4)}` : "****";
      }
      return settings;
    });

    ipcMain.handle("save-setting", (event, key, value) => {
      return this.databaseManager.setSetting(key, value);
    });

    ipcMain.handle("reset-settings", () => {
      return this.databaseManager.resetSettings();
    });

    // 剪贴板相关
    ipcMain.handle("copy-text", async (event, text) => {
      try {
        return await this.clipboardManager.copyText(text);
      } catch (error) {
        this.logger.error("复制文本失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("paste-text", async (event, text) => {
      return this.clipboardManager.pasteText(text);
    });

    ipcMain.handle("insert-text-directly", async (event, text) => {
      try {
        return await this.clipboardManager.insertTextDirectly(text);
      } catch (error) {
        this.logger.error("直接插入文本失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("enable-macos-accessibility", async () => {
      try {
        if (process.platform === "darwin") {
          const result = await this.clipboardManager.enableMacOSAccessibility();
          return { success: result };
        }
        return { success: true, message: "非 macOS 平台，无需设置" };
      } catch (error) {
        this.logger.error("启用 macOS accessibility 失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("read-clipboard", async () => {
      try {
        const text = await this.clipboardManager.readClipboard();
        return { success: true, text };
      } catch (error) {
        this.logger.error("读取剪贴板失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      try {
        return await this.clipboardManager.writeClipboard(text);
      } catch (error) {
        this.logger.error("写入剪贴板失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 窗口管理相关
    ipcMain.handle("hide-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.hide();
      }
      return true;
    });

    ipcMain.handle("show-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.show();
      }
      return true;
    });

    ipcMain.handle("minimize-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.minimize();
      }
      return true;
    });

    ipcMain.handle("maximize-window", () => {
      if (this.windowManager.mainWindow) {
        const win = this.windowManager.mainWindow;
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
      return true;
    });

    ipcMain.handle("is-window-maximized", () => {
      if (this.windowManager.mainWindow) {
        return this.windowManager.mainWindow.isMaximized();
      }
      return false;
    });

    ipcMain.handle("close-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.close();
      }
      return true;
    });

    ipcMain.handle("show-control-panel", () => {
      this.windowManager.showControlPanel();
      return true;
    });

    ipcMain.handle("hide-control-panel", () => {
      this.windowManager.hideControlPanel();
      return true;
    });

    ipcMain.handle("open-control-panel", () => {
      this.windowManager.showControlPanel();
      return true;
    });

    ipcMain.handle("close-control-panel", () => {
      this.windowManager.hideControlPanel();
      return true;
    });

    ipcMain.handle("open-history-window", () => {
      this.windowManager.showHistoryWindow();
      return true;
    });

    ipcMain.handle("close-history-window", () => {
      this.windowManager.closeHistoryWindow();
      return true;
    });

    ipcMain.handle("hide-history-window", () => {
      this.windowManager.hideHistoryWindow();
      return true;
    });

    ipcMain.handle("open-settings-window", () => {
      this.windowManager.showSettingsWindow();
      return true;
    });

    ipcMain.handle("close-settings-window", () => {
      this.windowManager.closeSettingsWindow();
      return true;
    });

    ipcMain.handle("hide-settings-window", () => {
      this.windowManager.hideSettingsWindow();
      return true;
    });

    ipcMain.handle("close-app", () => {
      require("electron").app.quit();
    });

    // 热键管理 - 添加发送者跟踪机制
    this.hotkeyRegisteredSenders = new Set(); // 跟踪已注册热键的发送者

    ipcMain.handle("register-hotkey", (event, hotkey) => {
      try {
        if (this.hotkeyManager) {
          const senderId = event.sender.id;

          // 检查是否已经为这个发送者注册过热键
          if (this.hotkeyRegisteredSenders.has(senderId)) {
            this.logger.info(`发送者 ${senderId} 已注册过热键，跳过重复注册`);
            return { success: true };
          }

          const success = this.hotkeyManager.registerHotkey(hotkey, () => {
            // 只发送热键触发事件到主窗口，避免重复触发
            this.logger.info(`热键 ${hotkey} 被触发，发送事件到主窗口`);
            if (
              this.windowManager &&
              this.windowManager.mainWindow &&
              !this.windowManager.mainWindow.isDestroyed()
            ) {
              this.windowManager.mainWindow.webContents.send(
                "hotkey-triggered",
                { hotkey },
              );
            }
          });

          if (success) {
            // 添加发送者到跟踪列表
            this.hotkeyRegisteredSenders.add(senderId);

            // 监听窗口关闭事件，清理注册记录
            event.sender.on("destroyed", () => {
              this.hotkeyRegisteredSenders.delete(senderId);
              this.logger.info(`清理发送者 ${senderId} 的热键注册记录`);
            });

            this.logger.info(`热键 ${hotkey} 注册成功，发送者: ${senderId}`);
          } else {
            this.logger.error(`热键 ${hotkey} 注册失败`);
          }

          return { success };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("注册热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("unregister-hotkey", (event, hotkey) => {
      try {
        if (this.hotkeyManager) {
          const success = this.hotkeyManager.unregisterHotkey(hotkey);
          return { success };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("注销热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-current-hotkey", () => {
      try {
        if (this.hotkeyManager) {
          const hotkeys = this.hotkeyManager.getRegisteredHotkeys();
          // 返回第一个非F2的热键，或默认热键
          const mainHotkey =
            hotkeys.find((key) => key !== "F2") ||
            "CommandOrControl+Shift+Space";
          return mainHotkey;
        }
        return "CommandOrControl+Shift+Space";
      } catch (error) {
        this.logger.error("获取当前热键失败:", error);
        return "CommandOrControl+Shift+Space";
      }
    });

    ipcMain.handle("set-always-on-top", (event, enabled) => {
      const win = this.windowManager.mainWindow;
      if (win) {
        win.setAlwaysOnTop(enabled);
        return { success: true };
      }
      return { success: false };
    });

    // F2热键管理
    ipcMain.handle("register-f2-hotkey", (event) => {
      try {
        const senderId = event.sender.id;

        // 检查是否已经为这个发送者注册过F2热键
        if (this.f2RegisteredSenders.has(senderId)) {
          this.logger.info(`F2热键已为发送者 ${senderId} 注册过，跳过重复注册`);
          return { success: true };
        }

        if (this.hotkeyManager) {
          // 只有在没有任何发送者注册时才注册热键
          const isFirstRegistration = this.f2RegisteredSenders.size === 0;

          if (isFirstRegistration) {
            const success = this.hotkeyManager.registerF2DoubleClick((data) => {
              // 发送F2双击事件到所有注册的渲染进程
              this.logger.info("发送F2双击事件到渲染进程:", data);
              this.f2RegisteredSenders.forEach((id) => {
                const window = require("electron")
                  .BrowserWindow.getAllWindows()
                  .find((w) => w.webContents.id === id);
                if (window && !window.isDestroyed()) {
                  window.webContents.send("f2-double-click", data);
                }
              });
            });

            if (!success) {
              return { success: false, error: "F2热键注册失败" };
            }
          }

          // 添加发送者到跟踪列表
          this.f2RegisteredSenders.add(senderId);

          // 监听窗口关闭事件，清理注册记录
          event.sender.on("destroyed", () => {
            this.f2RegisteredSenders.delete(senderId);
            this.logger.info(`清理发送者 ${senderId} 的F2热键注册记录`);

            // 如果没有发送者了，注销热键
            if (this.f2RegisteredSenders.size === 0) {
              this.hotkeyManager.unregisterHotkey("F2");
              this.logger.info("所有发送者都已注销，注销F2热键");
            }
          });

          return { success: true };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("注册F2热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("unregister-f2-hotkey", (event) => {
      try {
        const senderId = event.sender.id;

        if (this.hotkeyManager && this.f2RegisteredSenders.has(senderId)) {
          this.f2RegisteredSenders.delete(senderId);

          // 如果没有其他发送者注册F2热键，则注销热键
          if (this.f2RegisteredSenders.size === 0) {
            const success = this.hotkeyManager.unregisterHotkey("F2");
            this.logger.info("所有发送者都已注销，注销F2热键");
            return { success };
          } else {
            this.logger.info(
              `发送者 ${senderId} 已注销，但还有其他发送者注册了F2热键`,
            );
            return { success: true };
          }
        }
        return { success: false, error: "热键管理器未初始化或未注册" };
      } catch (error) {
        this.logger.error("注销F2热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("set-recording-state", (event, isRecording) => {
      try {
        if (this.hotkeyManager) {
          this.hotkeyManager.setRecordingState(isRecording);
          return { success: true };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("设置录音状态失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-recording-state", () => {
      try {
        if (this.hotkeyManager) {
          const isRecording = this.hotkeyManager.getRecordingState();
          return { success: true, isRecording };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("获取录音状态失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 文件操作
    ipcMain.handle("export-transcriptions", async (_event, format) => {
      try {
        const { dialog } = require("electron");
        const fs = require("fs");

        const transcriptions = this.databaseManager.getTranscriptions(10000, 0);
        if (!transcriptions || transcriptions.length === 0) {
          return { success: false, error: "没有转录记录可导出" };
        }

        const formatInfo = exportFormatters.getFormatInfo(format || "txt");
        const filters = [{ name: formatInfo.label, extensions: [formatInfo.ext] }];

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
        this.logger.error("导出转录失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("import-settings", async () => {
      try {
        const { dialog } = require("electron");
        const fs = require("fs");

        const result = await dialog.showOpenDialog({
          title: "导入设置",
          filters: [{ name: "JSON", extensions: ["json"] }],
          properties: ["openFile"],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, canceled: true };
        }

        const content = fs.readFileSync(result.filePaths[0], "utf-8");
        const settings = JSON.parse(content);

        for (const [key, value] of Object.entries(settings)) {
          this.databaseManager.setSetting(key, value);
        }

        return { success: true, count: Object.keys(settings).length };
      } catch (error) {
        this.logger.error("导入设置失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("export-settings", async () => {
      try {
        const { dialog } = require("electron");
        const fs = require("fs");

        const settings = this.databaseManager.getAllSettings();
        const content = JSON.stringify(settings, null, 2);

        const result = await dialog.showSaveDialog({
          title: "导出设置",
          defaultPath: "murmur-settings.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        fs.writeFileSync(result.filePath, content, "utf-8");
        return { success: true, path: result.filePath };
      } catch (error) {
        this.logger.error("导出设置失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 文件系统相关
    ipcMain.handle("show-item-in-folder", (event, fullPath) => {
      if (!fullPath || typeof fullPath !== "string") return;
      const userDataPath = require("electron").app.getPath("userData");
      if (!fullPath.startsWith(userDataPath)) {
        this.logger.warn("阻止访问用户数据目录外的路径:", fullPath);
        return;
      }
      require("electron").shell.showItemInFolder(fullPath);
    });

    ipcMain.handle("open-external", (event, url) => {
      if (!url || typeof url !== "string" || !url.startsWith("https:")) {
        this.logger.warn("阻止打开非HTTPS链接:", url);
        return { success: false, error: "只允许打开HTTPS链接" };
      }
      require("electron").shell.openExternal(url);
      return { success: true };
    });

    // 系统信息
    ipcMain.handle("get-system-info", () => {
      return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
      };
    });

    ipcMain.handle("check-permissions", async () => {
      try {
        // 检查辅助功能权限
        const hasAccessibility =
          await this.clipboardManager.checkAccessibilityPermissions();

        return {
          microphone: true, // 麦克风权限由前端检查
          accessibility: hasAccessibility,
        };
      } catch (error) {
        this.logger.error("检查权限失败:", error);
        return {
          microphone: false,
          accessibility: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("request-permissions", async () => {
      try {
        // 对于辅助功能权限，我们只能引导用户手动授予
        // 这里可以打开系统设置页面
        if (process.platform === "darwin") {
          this.clipboardManager.openSystemSettings();
        }
        return { success: true };
      } catch (error) {
        this.logger.error("请求权限失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 测试辅助功能权限
    ipcMain.handle("test-accessibility-permission", async () => {
      try {
        // 使用测试文本检查权限
        await this.clipboardManager.pasteText("Murmur权限测试");
        return { success: true, message: "辅助功能权限测试成功" };
      } catch (error) {
        this.logger.error("辅助功能权限测试失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 打开系统权限设置
    ipcMain.handle("open-system-permissions", () => {
      try {
        if (process.platform === "darwin") {
          this.clipboardManager.openSystemSettings();
          return { success: true };
        } else {
          return { success: false, error: "当前平台不支持自动打开权限设置" };
        }
      } catch (error) {
        this.logger.error("打开系统权限设置失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 应用信息
    ipcMain.handle("get-app-version", () => {
      return require("electron").app.getVersion();
    });

    ipcMain.handle("get-app-path", (event, name) => {
      return require("electron").app.getPath(name);
    });

    ipcMain.handle("check-for-updates", () => {
      const { app } = require("electron");
      return {
        hasUpdate: false,
        currentVersion: app.getVersion(),
        message: "当前已是最新版本",
      };
    });

    // 调试和日志
    ipcMain.handle("log", (event, level, message, data) => {
      this.logger[level](`[渲染进程] ${message}`, data || "");
      return true;
    });

    ipcMain.handle("get-debug-info", () => {
      return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: require("electron").app.getVersion(),
      };
    });

    // 保持向后兼容性
    ipcMain.handle("log-message", (event, level, message, data) => {
      this.logger[level](`[渲染进程] ${message}`, data || "");
      return true;
    });


    // 模型管理 - 更新为实际功能
    ipcMain.handle("download-model", async (event, _modelName) => {
      // 使用统一的模型下载功能
      return await this.funasrManager.downloadModels((progress) => {
        event.sender.send("model-download-progress", progress);
      });
    });

    ipcMain.handle("get-available-models", () => {
      // 返回FunASR支持的模型列表
      return {
        models: [
          {
            name: "paraformer-large",
            displayName: "Paraformer Large (ASR)",
            type: "asr",
            size: "840MB",
            description: "大型中文语音识别模型",
          },
          {
            name: "fsmn-vad",
            displayName: "FSMN VAD",
            type: "vad",
            size: "1.6MB",
            description: "语音活动检测模型",
          },
          {
            name: "ct-transformer-punc",
            displayName: "CT Transformer (标点)",
            type: "punc",
            size: "278MB",
            description: "标点符号恢复模型",
          },
        ],
      };
    });

    ipcMain.handle("get-current-model", async () => {
      const status = await this.funasrManager.checkStatus();
      return {
        model: "paraformer-large",
        status: status.models_downloaded ? "ready" : "not_downloaded",
        details: status,
      };
    });

    ipcMain.handle("switch-model", (_event, _modelName) => {
      // FunASR目前使用固定模型组合，暂不支持切换
      return {
        success: false,
        error: "FunASR使用固定模型组合，暂不支持切换单个模型",
      };
    });


    // 错误报告
    ipcMain.handle("report-error", (event, error) => {
      this.logger.error("渲染进程错误:", error);
      const { shell, app } = require("electron");
      const os = require("os");
      const body = encodeURIComponent(
        [
          "## 错误报告",
          "",
          `**版本**: ${app.getVersion()}`,
          `**平台**: ${os.platform()} ${os.release()} (${os.arch()})`,
          `**Electron**: ${process.versions.electron}`,
          `**Node**: ${process.version}`,
          "",
          "### 错误信息",
          "",
          typeof error === "string" ? error : JSON.stringify(error, null, 2),
        ].join("\n"),
      );
      shell.openExternal(
        `https://github.com/TeFuirnever/Murmur/issues/new?body=${body}`,
      );
      return true;
    });

    // 开发工具
    if (process.env.NODE_ENV === "development") {
      ipcMain.handle("open-dev-tools", (event) => {
        const window = require("electron").BrowserWindow.fromWebContents(
          event.sender,
        );
        if (window) {
          window.webContents.openDevTools();
        }
      });

      ipcMain.handle("reload-window", (event) => {
        const window = require("electron").BrowserWindow.fromWebContents(
          event.sender,
        );
        if (window) {
          window.reload();
        }
      });
    }

    // 日志和调试相关
    ipcMain.handle("get-app-logs", (event, lines = 100) => {
      try {
        if (this.logger && this.logger.getRecentLogs) {
          return {
            success: true,
            logs: this.logger.getRecentLogs(lines),
          };
        }
        return {
          success: false,
          error: "日志管理器不可用",
        };
      } catch (error) {
        this.logger.error("获取应用日志失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("get-funasr-logs", (event, lines = 100) => {
      try {
        if (this.logger && this.logger.getFunASRLogs) {
          return {
            success: true,
            logs: this.logger.getFunASRLogs(lines),
          };
        }
        return {
          success: false,
          error: "日志管理器不可用",
        };
      } catch (error) {
        this.logger.error("获取FunASR日志失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("get-log-file-path", () => {
      try {
        if (this.logger && this.logger.getLogFilePath) {
          return {
            success: true,
            appLogPath: this.logger.getLogFilePath(),
            funasrLogPath: this.logger.getFunASRLogFilePath(),
          };
        }
        return {
          success: false,
          error: "日志管理器不可用",
        };
      } catch (error) {
        this.logger.error("获取日志文件路径失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("open-log-file", (event, logType = "app") => {
      try {
        if (this.logger) {
          const logPath =
            logType === "funasr"
              ? this.logger.getFunASRLogFilePath()
              : this.logger.getLogFilePath();

          const { app: electronApp } = require("electron");
          const userDataPath = electronApp.getPath("userData");
          if (!logPath.startsWith(userDataPath)) {
            return { success: false, error: "路径不在允许范围内" };
          }
          require("electron").shell.showItemInFolder(logPath);
          return { success: true };
        }
        return {
          success: false,
          error: "日志管理器不可用",
        };
      } catch (error) {
        this.logger.error("打开日志文件失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("get-system-debug-info", () => {
      try {
        const debugInfo = {
          system: {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
            appVersion: require("electron").app.getVersion(),
          },
          environment: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            PYTHON_PATH: process.env.PYTHON_PATH,
            AI_API_KEY: "通过控制面板设置",
            AI_BASE_URL: "通过控制面板设置",
            AI_MODEL: "通过控制面板设置",
          },
          funasrStatus: {
            isInitialized: this.funasrManager.isInitialized,
            modelsInitialized: this.funasrManager.modelsInitialized,
            serverReady: this.funasrManager.serverReady,
            pythonCmd: this.funasrManager.pythonCmd,
          },
        };

        if (this.logger && this.logger.getSystemInfo) {
          debugInfo.loggerInfo = this.logger.getSystemInfo();
        }

        return {
          success: true,
          debugInfo,
        };
      } catch (error) {
        this.logger.error("获取系统调试信息失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("test-python-environment", async () => {
      try {
        this.logger &&
          this.logger.info &&
          this.logger.info("开始测试Python环境");

        const pythonCmd = await this.funasrManager.findPythonExecutable();
        const funasrStatus = await this.funasrManager.checkFunASRInstallation();

        const testResult = {
          success: true,
          pythonCmd,
          funasrStatus,
          timestamp: new Date().toISOString(),
        };

        this.logger &&
          this.logger.info &&
          this.logger.info("Python环境测试完成", testResult);

        return testResult;
      } catch (error) {
        const errorResult = {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        };

        this.logger &&
          this.logger.error &&
          this.logger.error("Python环境测试失败", errorResult);

        return errorResult;
      }
    });

    ipcMain.handle("restart-funasr-server", async () => {
      try {
        this.logger &&
          this.logger.info &&
          this.logger.info("手动重启FunASR服务器");

        // 使用新的restartServer方法
        const result = await this.funasrManager.restartServer();

        return result;
      } catch (error) {
        this.logger &&
          this.logger.error &&
          this.logger.error("重启FunASR服务器失败", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });
  }

  // AI文本处理方法
  async processTextWithAI(text, mode = "optimize") {
    try {
      // 从数据库设置中获取API密钥
      const apiKey = await this.databaseManager.getSetting("ai_api_key");
      if (!apiKey) {
        return {
          success: false,
          error: "请先在设置页面配置AI API密钥",
        };
      }

      const prompts = {
        format: `请将以下文本进行格式化，添加适当的段落分隔，使其更易阅读：\n\n${text}`,
        correct: `请纠正以下文本中的语法错误、错别字和语音识别错误，保持原意不变：\n\n${text}`,
        optimize: `# 角色与目标
你是一个专业的语音转录文本优化助手，任务是对由ASR（自动语音识别）生成的初步文本进行精细的、最小化的润色。你的核心目标是去除言语组织过程中的干扰性噪音，同时100%保留说话人的原始意图、个人风格和口语习惯。

# 核心原则
- **最小化修改**：只处理明确的、非内容性的言语错误。
- **保留原貌**：最大限度地保留用户的原始用词、句式和语气。
- **可读性优先**：在不改变原意的前提下，提升文本的流畅性和可读性。
- **歧义时保守**：当不确定一个词或一句话是否需要修改时，必须选择保持原样。

# 明确的优化指令 (Do's)
1.  **纠正明显的拼写和语法错误**：修正同音错字、标点误用、以及基础的语法搭配错误（如主谓不一致）。
2.  **移除无意义的填充词**：删除如"呃"、"嗯"、"啊这"、"那个"、"内个"、"然后那个"、"就是说"等在思考或停顿时使用的、不承载实际信息的词语。
3.  **处理重复与口吃**：合并无意义的重复词语。
    -   例子1: "我我我觉得" -> "我觉得"
    -   例子2: "这个这个方案" -> "这个方案"
4.  **整合自我修正**：当用户明确表达了修正意图时，保留修正后的最终内容，并移除被修正的错误部分。
    -   例子1: "会议定在周三，呃不对，是周四" -> "会议定在周四"
    -   例子2: "他的名字是小明，哦我想起来了，是小强" -> "他的名字是小强"

# 严格的禁止项 (Don'ts)
1.  **禁止风格转换**：绝不能将口语化的表达（如"录个影"、"蛮不错"）替换为更书面化的词语（如"录制视频"、"非常好"）。
2.  **禁止替换用词**：除非是明显的错别字，否则不能改变用户的任何用词选择。
3.  **禁止改变句式**：不能为了"优化"而重组用户的句子结构，例如将主动句改为被动句。
4.  **禁止增删情感或语气词**：必须保留所有表达情感和语气的词，如"啊"、"呀"、"呢"、"吧"、"嘛"、"哦"、"喔"等。注意区分它们和第2条指令中提到的"无意义填充词"。
5.  **禁止主观臆断**：不能添加任何原始文本中不存在的信息，或基于猜测去"完善"句子。

原始文本：
\`\`\`
${text}
\`\`\`

# 输出格式
- **输出**: 直接返回优化后的文本，不要包含任何解释、前言或总结。`,
        optimize_long: `# 角色与目标
你是一个专业的长文本整理助手，专门处理语音转录的长段内容。你的任务是清理口语化的思考过程，并对内容进行逻辑分段，让文本更加清晰易读。

# 处理重点
这是一段较长的语音转录内容，通常包含完整的思考过程。你需要：

## 1. 清理口语化的思考过程
- **去除思考痕迹**：删除"然后"、"就是说"、"其实"、"比如说"、"怎么说呢"、"应该是"等思考过程中的冗余表达
- **处理话题跳转**：整理"对了"、"还有"、"另外"等突然转换话题的表达
- **清理重复表述**：去除同一观点的多次重复表达，保留最清晰的一次
- **整合修正表达**：当有"不对，我的意思是"、"更准确地说"等自我纠正时，保留最终的正确表达

## 2. 智能分段
- **识别逻辑转折点**：在话题转换、观点变化、举例说明等地方进行分段
- **保持逻辑完整性**：确保每段都有完整的逻辑表达
- **适度分段**：避免过短或过长的段落，保持阅读节奏

## 3. 保持原意和自然性
- **不改变表达风格**：保持原有的用词习惯和表达方式
- **不添加新内容**：绝不添加原文中没有的信息
- **保留重要细节**：确保例子、数据、具体描述都得到保留

原始文本：
\`\`\`
${text}
\`\`\`

请直接返回清理后并分段的文本，不要包含任何解释或说明。`,
        summarize: `请总结以下文本的主要内容，提取关键信息：\n\n${text}`,
        enhance: `请对以下文本进行内容优化：

**优化要求：**
1. **严格保持原意和语义不变**
2. 纠正明显的用词错误和语法问题
3. 优化表达方式，使语言更加准确和流畅
4. 可以调整标点符号以提升文本质量
5. 保留原文的语言风格

**注意事项：**
- 对于诗词、成语、俗语等固定表达，请保持原样
- 宁可保守处理，也不要过度修改

原始文本：
${text}

请直接返回优化后的文本，不需要解释过程。`,
      };

      const baseUrl =
        (await this.databaseManager.getSetting("ai_base_url")) ||
        "https://api.openai.com/v1";
      const model =
        (await this.databaseManager.getSetting("ai_model")) || "gpt-3.5-turbo";

      if (!this._validateAIBaseUrl(baseUrl)) {
        return { success: false, error: "不支持的API地址" };
      }

      const requestData = {
        model: model,
        messages: [
          {
            role: "user",
            content: prompts[mode] || prompts.optimize,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        stream: false,
      };

      this.logger.info("AI文本处理请求:", {
        baseUrl,
        model,
        mode,
        inputText: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
        requestData,
      });

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData = { error: response.statusText };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          this.logger.warn("AI错误响应非JSON格式:", (errorText || "").substring(0, 200));
          errorData = { error: errorText || response.statusText };
        }
        throw new Error(
          errorData.error?.message ||
            errorData.error ||
            `AI服务请求失败 (${response.status})`,
        );
      }

      const data = await response.json();

      this.logger.info("AI文本处理响应:", {
        status: response.status,
        data: data,
        usage: data.usage,
      });

      if (data.choices && data.choices.length > 0) {
        const result = {
          success: true,
          text: data.choices[0].message.content.trim(),
          usage: data.usage,
          model: model,
        };

        this.logger.info("AI文本处理结果:", {
          originalText:
            text.substring(0, 100) + (text.length > 100 ? "..." : ""),
          optimizedText:
            result.text.substring(0, 100) +
            (result.text.length > 100 ? "..." : ""),
          usage: result.usage,
        });

        return result;
      } else {
        this.logger.error("AI API返回数据格式错误:", response.data);
        return {
          success: false,
          error: "AI API返回数据格式错误",
        };
      }
    } catch (error) {
      this.logger.error("AI文本处理失败:", error);

      let errorMessage = "文本处理失败";
      if (error.code === "ECONNABORTED") {
        errorMessage = "请求超时，请检查网络连接";
      } else if (error.code === "ENOTFOUND") {
        errorMessage = "无法连接到AI服务器，请检查网络";
      } else {
        errorMessage = error.message || "未知错误";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // 检查AI状态
  async checkAIStatus(testConfig = null) {
    try {
      this.logger.info(
        "开始测试AI配置...",
        testConfig ? "使用临时配置" : "使用已保存配置",
      );

      // 如果提供了测试配置，使用测试配置；否则使用已保存的配置
      let apiKey, baseUrl, model;

      if (testConfig) {
        apiKey = testConfig.ai_api_key;
        baseUrl = testConfig.ai_base_url || "https://api.openai.com/v1";
        model = testConfig.ai_model || "gpt-3.5-turbo";
        this.logger.info("使用临时测试配置:", {
          baseUrl,
          model,
        });
      } else {
        apiKey = await this.databaseManager.getSetting("ai_api_key");
        baseUrl =
          (await this.databaseManager.getSetting("ai_base_url")) ||
          "https://api.openai.com/v1";
        model =
          (await this.databaseManager.getSetting("ai_model")) ||
          "gpt-3.5-turbo";
        this.logger.info("使用已保存配置:", {
          baseUrl,
          model,
        });
      }

      if (!apiKey) {
        this.logger.warn("AI测试失败: 未配置API密钥");
        return {
          available: false,
          error: "未配置API密钥",
          details: "请输入AI API密钥",
        };
      }

      if (!this._validateAIBaseUrl(baseUrl)) {
        return {
          available: false,
          error: "不支持的API地址",
          details: "仅支持 OpenAI、阿里云百炼、智谱 BigModel",
        };
      }

      this.logger.info("AI配置信息:", {
        baseUrl: baseUrl,
        model: model,
      });

      // 发送一个更有意义的测试请求
      const testMessage = '请回复"测试成功"来确认AI服务正常工作';
      const requestData = {
        model: model,
        messages: [
          {
            role: "user",
            content: testMessage,
          },
        ],
        max_tokens: 50,
        temperature: 0.1,
      };

      this.logger.info("发送AI测试请求:", requestData);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      this.logger.info("AI API响应状态:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error("AI API错误响应:", errorText);

        let errorData = { error: response.statusText };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          this.logger.warn("AI错误响应非JSON格式:", (errorText || "").substring(0, 200));
          errorData = { error: errorText || response.statusText };
        }

        let errorMessage =
          errorData.error?.message ||
          errorData.error ||
          `HTTP ${response.status}`;
        if (response.status === 401) {
          errorMessage = "API密钥无效或已过期";
        } else if (response.status === 403) {
          errorMessage = "API密钥权限不足";
        } else if (response.status === 429) {
          errorMessage = "API调用频率超限";
        } else if (response.status === 500) {
          errorMessage = "AI服务器内部错误";
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      this.logger.info("AI API成功响应:", data);

      if (!data.choices || data.choices.length === 0) {
        throw new Error("AI API返回格式异常：缺少choices字段");
      }

      const aiResponse = data.choices[0].message?.content || "";
      this.logger.info("AI回复内容:", aiResponse);

      return {
        available: true,
        model: model,
        status: "connected",
        response: aiResponse,
        usage: data.usage,
        details: `成功连接到 ${model}，响应时间正常`,
      };
    } catch (error) {
      this.logger.error("AI配置测试失败:", error);

      let errorMessage = "连接失败";
      if (error.message.includes("401")) {
        errorMessage = "API密钥无效";
      } else if (error.message.includes("403")) {
        errorMessage = "API密钥权限不足";
      } else if (error.message.includes("429")) {
        errorMessage = "API调用频率超限";
      } else if (error.message.includes("ENOTFOUND")) {
        errorMessage = "无法连接到AI服务器，请检查网络和Base URL";
      } else if (error.message.includes("ECONNREFUSED")) {
        errorMessage = "连接被拒绝，请检查Base URL是否正确";
      } else if (error.message.includes("timeout")) {
        errorMessage = "请求超时，请检查网络连接";
      } else {
        errorMessage = error.message || "未知错误";
      }

      return {
        available: false,
        error: errorMessage,
        details: `测试失败原因: ${error.message}`,
      };
    }
  }

  // 清理处理器
  removeAllHandlers() {
    ipcMain.removeAllListeners();
  }
}

module.exports = IPCHandlers;
