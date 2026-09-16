// [20260724_TS_BigBang_Tray] Migrated from .js to .ts (ADR-010).
// `module.exports = TrayManager` (class) became `export default TrayManager`.
import { Tray, Menu, nativeImage, dialog, app } from "electron";
import path from "path";
import fs from "fs";
// [20260906_Fix_TrayI18n] Spec #266 T15 (#292): the tray was the last
// hardcoded-Chinese surface. Labels now resolve through the same locale
// resources the renderer uses, and the language is pushed here by the
// settings handler whenever the "language" setting changes.
import zhCN from "../i18n/locales/zh-CN.json";
import enUS from "../i18n/locales/en.json";

type TrayLocale = {
  tray: {
    showWindow: string;
    about: string;
    quit: string;
    tooltipReady: string;
    tooltipRecording: string;
    tooltipProcessing: string;
    aboutTitle: string;
    aboutDescription: string;
  };
};

const TRAY_LOCALES: Record<string, TrayLocale> = {
  "zh-CN": zhCN as unknown as TrayLocale,
  en: enUS as unknown as TrayLocale,
};

const DEFAULT_LOCALE = "zh-CN";
// Compile-time fallback so trayText can never return undefined even if the
// resource import shapes drift.
const DEFAULT_TRAY_LABELS: TrayLocale["tray"] = {
  showWindow: "显示主窗口",
  about: "关于",
  quit: "退出",
  tooltipReady: "Murmur - 中文语音转文字",
  tooltipRecording: "Murmur - 正在录音...",
  tooltipProcessing: "Murmur - 正在处理...",
  aboutTitle: "关于 Murmur",
  aboutDescription: "开源免费的 AI 语音输入工具",
};
let currentLocale = DEFAULT_LOCALE;

function trayText(key: keyof TrayLocale["tray"]): string {
  const locale = TRAY_LOCALES[currentLocale] ?? TRAY_LOCALES[DEFAULT_LOCALE];
  if (!locale) return DEFAULT_TRAY_LABELS[key];
  return locale.tray[key];
}

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

class TrayManager {
  private tray: Tray | null;
  private mainWindow: Electron.BrowserWindow | null;
  private logger: Logger | null;
  private currentStatus = "ready";

  constructor(logger: Logger | null = null) {
    this.tray = null;
    this.mainWindow = null;
    this.logger = logger;
  }

  // [20260906_Fix_TrayI18n] Switch the menu/tooltips to a new locale and
  // rebuild the live tray so the change is immediate (called by the
  // settings handler when the "language" setting is written).
  setLanguage(lang: string): void {
    currentLocale = TRAY_LOCALES[lang] ? lang : DEFAULT_LOCALE;
    if (this.tray) {
      this.updateContextMenu();
      this.setStatus(this.currentStatus);
    }
  }

  setWindows(mainWindow: Electron.BrowserWindow | null): void {
    this.mainWindow = mainWindow;
  }

  async createTray(): Promise<void> {
    try {
      // 创建托盘图标
      const iconPath = this.getTrayIconPath();
      let trayIcon: Electron.NativeImage;

      if (iconPath && fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
        // [20260729_Rebrand_FoxMascot] macOS tray now uses a dedicated 16px
        // export (design/icon-rebrand/exported-png/icon-16.png) instead of
        // downscaling the full-color 1024px app icon. The previous resize
        // produced an unreadable blur at 16x16 because the kawaii fox detail
        // collapsed. setTemplateImage(true) is removed so the tray shows the
        // brand color (lavender + orange fox) rather than a forced monochrome
        // silhouette — matching Discord/Slack/WeChat tray-icon convention.
      } else {
        // 如果图标文件不存在，创建一个简单的图标
        trayIcon = nativeImage.createEmpty();
      }

      this.tray = new Tray(trayIcon);
      this.tray.setToolTip(trayText("tooltipReady"));

      // 创建上下文菜单
      this.updateContextMenu();

      // 设置点击事件
      this.tray.on("click", () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          if (this.mainWindow.isVisible()) {
            this.mainWindow.hide();
          } else {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      });

      this.tray.on("right-click", () => {
        this.tray!.popUpContextMenu();
      });
    } catch (error) {
      if (this.logger && this.logger.error) {
        this.logger.error("创建托盘失败:", error);
      }
    }
  }

  getTrayIconPath(): string {
    const isDev = process.env.NODE_ENV === "development";

    // [20260729_Rebrand_FoxMascot] Use the dedicated small-size export for the
    // tray. macOS menu bar renders at 16px; the full-color 1024px app icon
    // becomes an unreadable blob when downscaled to 16px, so we ship a
    // purpose-built 16px variant (assets/tray-icon-16.png, copied from
    // design/icon-rebrand/exported-png/icon-16.png) that is optimized for the
    // tiny menu-bar canvas.
    // Windows/Linux tray sizes vary (16-32px); they use the full icon.png and
    // rely on the OS to scale, which is acceptable on those platforms.
    if (process.platform === "darwin") {
      if (isDev) {
        return path.join(app.getAppPath(), "assets", "tray-icon-16.png");
      }
      return path.join(process.resourcesPath, "assets", "tray-icon-16.png");
    }

    if (isDev) {
      // [20260724_TS_BigBang_DirnameFix] app.getAppPath()-based icon path
      return path.join(app.getAppPath(), "assets", "icon.png");
      // [20260724_TS_BigBang_DirnameFix] END
    } else {
      // 生产环境路径
      return path.join(process.resourcesPath, "assets", "icon.png");
    }
  }

  updateContextMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: trayText("showWindow"),
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: trayText("about"),
        click: () => {
          dialog.showMessageBox({
            type: "info",
            title: trayText("aboutTitle"),
            message: `Murmur v${app.getVersion()}`,
            detail: [
              trayText("aboutDescription"),
              "",
              `Electron: ${process.versions.electron}`,
              `Node.js: ${process.versions.node}`,
              `Chrome: ${process.versions.chrome}`,
              "",
              "https://github.com/TeFuirnever/Murmur",
            ].join("\n"),
            buttons: ["确定"],
            noLink: true,
          });
        },
      },
      { type: "separator" },
      {
        label: trayText("quit"),
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  setStatus(status: string): void {
    if (!this.tray) return;

    this.currentStatus = status;
    const tooltipKey =
      status === "recording"
        ? "tooltipRecording"
        : status === "processing"
          ? "tooltipProcessing"
          : "tooltipReady";
    this.tray.setToolTip(trayText(tooltipKey));
  }
}

export default TrayManager;
