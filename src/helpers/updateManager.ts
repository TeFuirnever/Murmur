// [20260724_TS_BigBang_UpdateManager] Migrated from .js to .ts (ADR-010).
// `module.exports = { register, semverGt, ... }` (named object) became named
// exports. `const C = require("./ipc-contracts")` became namespace import.
// electron destructured at top level (updateManager is Electron-runtime only;
// the register() function is never unit-tested, only source-checked for path).
import { app, shell, net, BrowserWindow, Notification } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as C from "./ipc-contracts";

interface Logger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

interface Managers {
  logger?: Logger;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body?: string;
  assets?: Array<{
    name: string;
    browser_download_url?: string;
    size?: number;
  }>;
}

interface ChecksumEntry {
  hash: string;
  filename: string;
}

interface DownloadState {
  cancelled: boolean;
}

const GITHUB_API =
  "https://api.github.com/repos/TeFuirnever/Murmur/releases/latest";

export function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

export function getPlatformAsset(
  release: GithubRelease,
  platform: string,
): GithubRelease["assets"] extends Array<infer T> | undefined
  ? T | undefined
  : never {
  const ext = platform === "darwin" ? ".dmg" : ".exe";
  return (release.assets || []).find((a) => a.name.endsWith(ext)) as never;
}

export function getChecksumsAsset(
  release: GithubRelease,
): GithubRelease["assets"] extends Array<infer T> | undefined
  ? T | undefined
  : never {
  return (release.assets || []).find(
    (a) => a.name === "checksums-sha256.txt",
  ) as never;
}

export function parseChecksums(content: string): ChecksumEntry[] {
  return content
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [hash, filename] = l.trim().split(/\s{2,}/);
      return { hash: hash || "", filename: filename || "" };
    });
}

export async function verifySHA256(
  filePath: string,
  expectedHash: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (data: Buffer) => hash.update(data));
    stream.on("end", () => {
      const actual = hash.digest("hex");
      resolve(actual === expectedHash.toLowerCase());
    });
    stream.on("error", reject);
  });
}

export function register(ipcMain: Electron.IpcMain, managers: Managers): void {
  const { logger } = managers;
  let currentDownload: DownloadState | null = null;

  ipcMain.handle(C.UPDATE.CHECK, async () => {
    try {
      const currentVersion = app.getVersion();
      const response = await net.fetch(GITHUB_API);
      if (!response.ok) {
        return { hasUpdate: false, currentVersion, error: "无法检查更新" };
      }
      const data = (await response.json()) as GithubRelease;
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

  ipcMain.handle(
    C.UPDATE.DOWNLOAD,
    async (event, updateInfo: Record<string, unknown>) => {
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
        const checksumsResponse = await net.fetch(
          updateInfo.checksumsUrl as string,
        );
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
        const response = await net.fetch(updateInfo.downloadUrl as string);
        if (!response.ok) {
          throw new Error(`下载失败: ${response.status}`);
        }

        const contentLength = parseInt(
          response.headers.get("content-length") || "0",
          10,
        );
        const fileStream = fs.createWriteStream(filePath);
        let downloaded = 0;

        const reader = response.body!.getReader();

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

        await new Promise<void>((resolve, reject) => {
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
            error: (error as Error).message,
          });
        }

        return { success: false, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle(C.UPDATE.CANCEL, () => {
    if (currentDownload) {
      currentDownload.cancelled = true;
      return { success: true };
    }
    return { success: false, error: "没有进行中的下载" };
  });

  ipcMain.handle(C.UPDATE.INSTALL, (event, filePath: string) => {
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
// [20260724_TS_BigBang_UpdateManager] END
