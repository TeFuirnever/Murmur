const C = require("../ipc-contracts");

function register(ipcMain, managers) {
  const { environmentManager, funasrManager, logger } = managers;

  ipcMain.handle(C.ENVIRONMENT.GET_CONFIG, () => {
    return environmentManager.exportConfig();
  });

  ipcMain.handle(C.ENVIRONMENT.VALIDATE, () => {
    return environmentManager.validateEnvironment();
  });

  ipcMain.handle(C.PYTHON.CHECK, async () => {
    return await funasrManager.checkPythonInstallation();
  });

  ipcMain.handle(C.PYTHON.INSTALL, async (event, _progressCallback) => {
    return await funasrManager.installPython((progress) => {
      event.sender.send(C.EVENTS.PYTHON_INSTALL_PROGRESS, progress);
    });
  });

  ipcMain.handle(C.FUNASR.CHECK, async () => {
    return await funasrManager.checkFunASRInstallation();
  });

  ipcMain.handle(C.FUNASR.STATUS, async () => {
    const status = await funasrManager.checkStatus();
    return {
      ...status,
      success: status?.success !== false,
      models_initialized: funasrManager.modelsInitialized,
      server_ready: funasrManager.serverReady,
      is_initializing: funasrManager.initializationPromise !== null,
    };
  });

  ipcMain.handle(C.FUNASR.INSTALL, async (event) => {
    return await funasrManager.installFunASR((progress) => {
      event.sender.send(C.EVENTS.FUNASR_INSTALL_PROGRESS, progress);
    });
  });

  ipcMain.handle(C.FUNASR.SERVER_STATUS, async () => {
    return await funasrManager.checkStatus();
  });

  ipcMain.handle(C.FUNASR.RESTART, async () => {
    try {
      logger.info("手动重启FunASR服务器");
      const result = await funasrManager.restartServer();
      return result;
    } catch (error) {
      logger.error("重启FunASR服务器失败", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.PYTHON.TEST_ENV, async () => {
    try {
      logger.info("开始测试Python环境");
      const pythonCmd = await funasrManager.findPythonExecutable();
      const funasrStatus = await funasrManager.checkFunASRInstallation();
      const testResult = {
        success: true,
        pythonCmd,
        funasrStatus,
        timestamp: new Date().toISOString(),
      };
      logger.info("Python环境测试完成", testResult);
      return testResult;
    } catch (error) {
      const errorResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
      logger.error("Python环境测试失败", errorResult);
      return errorResult;
    }
  });
}

module.exports = { register };
