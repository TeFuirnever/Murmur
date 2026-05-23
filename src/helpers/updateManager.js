const { app, shell, net, BrowserWindow, Notification } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const C = require("../ipc-contracts");

const GITHUB_API =
  "https://api.github.com/repos/TeFuirnever/Murmur/releases/latest";

function semverGt(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function getPlatformAsset(release, platform) {
  const ext = platform === "darwin" ? ".dmg" : ".exe";
  return (release.assets || []).find((a) => a.name.endsWith(ext));
}

function getChecksumsAsset(release) {
  return (release.assets || []).find(
    (a) => a.name === "checksums-sha256.txt"
  );
}

function parseChecksums(content) {
  return content
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [hash, filename] = l.trim().split(/\s{2,}/);
      return { hash, filename };
    });
}

async function verifySHA256(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => {
      const actual = hash.digest("hex");
      resolve(actual === expectedHash.toLowerCase());
    });
    stream.on("error", reject);
  });
}

function register(ipcMain, managers) {
  const { logger } = managers;
  let currentDownload = null;

  ipcMain.handle(C.UPDATE.CHECK, async () => {
    try {
      const currentVersion = app.getVersion();
      const response = await net.fetch(GITHUB_API);
      if (!response.ok) {
        return { hasUpdate: false, currentVersion, error: "无法检查更新" };
      }
      const data = await response.json();
      if (!data || typeof data.tag_name !== "string") {
        return {
          hasUpdate: false,
          currentVersion,
          error: "更新信息格式异常",
        };
      }
      const latestVersion = data.tag_name.replace(/^v/, "");
      const hasUpdate = semverGt(latestVersion, currentVersion);
      const asset = getPlatformAsset(data, process.platform);
      const checksumsAsset = getChecksumsAsset(data);

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: data.html_url,
        releaseNotes: data.body || "",
        downloadUrl: asset?.browser_download_url || null,
        downloadSize: asset?.size || 0,
        checksumsUrl: checksumsAsset?.browser_download_url || null,
        message: hasUpdate
          ? `发现新版本 v${latestVersion}`
          : "当前已是最新版本",
      };
    } catch (error) {
      logger?.warn?.("检查更新失败", error);
      return {
        hasUpdate: false,
        currentVersion: app.getVersion(),
        error: "检查更新失败",
      };
    }
  });

  ipcMain.handle(C.UPDATE.DOWNLOAD, async (event, updateInfo) => {
    if (currentDownload) {
      return { success: false, error: "已有下载进行中" };
    }

    if (
      !updateInfo?.downloadUrl ||
      !updateInfo?.checksumsUrl ||
      !updateInfo?.latestVersion
    ) {
      return { success: false, error: "缺少下载信息" };
    }

    const tmpDir = app.getPath("temp");
    const ext = process.platform === "darwin" ? ".dmg" : ".exe";
    const fileName = `Murmur-${updateInfo.latestVersion}${ext}`;
    const filePath = path.join(tmpDir, fileName);
    const checksumsPath = path.join(tmpDir, "checksums-sha256.txt");

    try {
      const sender = event.sender;

      // Download checksums file
      const checksumsResponse = await net.fetch(updateInfo.checksumsUrl);
      if (!checksumsResponse.ok) {
        throw new Error("无法下载校验文件");
      }
      const checksumsContent = await checksumsResponse.text();
      fs.writeFileSync(checksumsPath, checksumsContent);

      // Find expected hash
      const checksums = parseChecksums(checksumsContent);
      const entry = checksums.find((c) => c.filename === fileName);
      if (!entry) {
        throw new Error("校验文件中未找到对应文件");
      }
      const expectedHash = entry.hash;

      // Download installer with progress tracking
      currentDownload = { cancelled: false };
      const response = await net.fetch(updateInfo.downloadUrl);
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }

      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
      const fileStream = fs.createWriteStream(filePath);
      let downloaded = 0;

      const reader = response.body.getReader();

      while (true) {
        if (currentDownload.cancelled) {
          fileStream.close();
          fs.unlinkSync(filePath);
          currentDownload = null;
          return { success: false, error: "下载已取消" };
        }

        const { done, value } = await reader.read();
        if (done) break;

        fileStream.write(Buffer.from(value));
        downloaded += value.length;

        if (contentLength > 0) {
          const win = BrowserWindow.fromWebContents(sender);
          if (win && !win.isDestroyed()) {
            win.webContents.send(C.EVENTS.UPDATE_DOWNLOAD_PROGRESS, {
              progress: Math.round((downloaded / contentLength) * 100),
              downloaded,
              total: contentLength,
            });
          }
        }
      }

      await new Promise((resolve, reject) => {
        fileStream.on("error", reject);
        fileStream.end(() => resolve());
      });
      currentDownload = null;

      // Verify SHA256
      const hashValid = await verifySHA256(filePath, expectedHash);
      if (!hashValid) {
        fs.unlinkSync(filePath);
        throw new Error("SHA256 校验失败");
      }

      // Notify renderer of completion
      const win = BrowserWindow.fromWebContents(sender);
      if (win && !win.isDestroyed()) {
        win.webContents.send(C.EVENTS.UPDATE_DOWNLOAD_COMPLETE, {
          filePath,
          version: updateInfo.latestVersion,
          hashValid: true,
        });
      }

      // System notification
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: "Murmur 更新",
          body: `v${updateInfo.latestVersion} 已下载完成，点击查看`,
        });
        notification.on("click", () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
          }
        });
        notification.show();
      }

      return { success: true, filePath, hashValid: true };
    } catch (error) {
      currentDownload = null;
      logger?.error?.("下载更新失败:", error);

      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        win.webContents.send(C.EVENTS.UPDATE_DOWNLOAD_ERROR, {
          error: error.message,
        });
      }

      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(C.UPDATE.CANCEL, () => {
    if (currentDownload) {
      currentDownload.cancelled = true;
      return { success: true };
    }
    return { success: false, error: "没有进行中的下载" };
  });

  ipcMain.handle(C.UPDATE.INSTALL, (event, filePath) => {
    if (!filePath || typeof filePath !== "string") return false;
    const resolved = path.resolve(filePath);
    const tmpDir = app.getPath("temp");
    if (!resolved.startsWith(tmpDir)) {
      logger?.warn?.("安装路径不在临时目录:", filePath);
      return false;
    }
    shell.openPath(resolved);
    app.quit();
    return true;
  });
}

module.exports = { register, semverGt, getPlatformAsset, getChecksumsAsset, parseChecksums, verifySHA256 };
