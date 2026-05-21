const C = require("../ipc-contracts");

function register(ipcMain, managers) {
  const { funasrManager } = managers;

  ipcMain.handle(C.MODELS.CHECK, async () => {
    return await funasrManager.checkModelFiles();
  });

  ipcMain.handle(C.MODELS.PROGRESS, async () => {
    return await funasrManager.getDownloadProgress();
  });

  ipcMain.handle(C.MODELS.DOWNLOAD, async (event) => {
    return await funasrManager.downloadModels((progress) => {
      event.sender.send(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, progress);
    });
  });

  ipcMain.handle(C.MODELS.DOWNLOAD_MODEL, async (event, _modelName) => {
    return await funasrManager.downloadModels((progress) => {
      event.sender.send(C.EVENTS.MODEL_DOWNLOAD_PROGRESS, progress);
    });
  });

  ipcMain.handle(C.MODELS.AVAILABLE, () => {
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

  ipcMain.handle(C.MODELS.CURRENT, async () => {
    const status = await funasrManager.checkStatus();
    return {
      model: "paraformer-large",
      status: status.models_downloaded ? "ready" : "not_downloaded",
      details: status,
    };
  });

  ipcMain.handle(C.MODELS.SWITCH, (_event, _modelName) => {
    return {
      success: false,
      error: "FunASR使用固定模型组合，暂不支持切换单个模型",
    };
  });
}

module.exports = { register };
