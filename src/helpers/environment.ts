// [20260724_TS_Migration_Environment] Migrated from .js to .ts (ADR-010 Phase 3).
// Depends on path, fs, os, and dotenv (lazy require).
import path from "path";
import fs from "fs";
import os from "os";

/** AI configuration (currently placeholder — configured via settings panel). */
interface AIConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** Audio recording configuration. */
interface AudioConfig {
  sampleRate: number;
  channels: number;
  format: string;
}

/** FunASR model configuration. */
interface FunASRConfig {
  modelDir: string;
  cacheDir: string;
  batchSize: number;
  hotwords: string[];
}

/** Application-level configuration. */
interface AppConfig {
  debug: boolean;
  logLevel: string;
  language: string;
  theme: string;
  windowAlwaysOnTop: boolean;
  startMinimized: boolean;
  globalHotkey: string;
}

/** Database configuration. */
interface DatabaseConfig {
  path: string;
  backupEnabled: boolean;
  backupInterval: number;
}

/** Proxy configuration. */
interface ProxyConfig {
  http: string;
  https: string;
}

/** Performance configuration. */
interface PerformanceConfig {
  maxRecordingDuration: number;
  maxTextLength: number;
}

/** System information snapshot. */
interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string | undefined;
  chromeVersion: string | undefined;
  osType: string;
  osRelease: string;
  totalMemory: number;
  freeMemory: number;
  cpus: number;
  homeDir: string;
  tmpDir: string;
}

/** Environment validation result. */
interface ValidationResult {
  valid: boolean;
  issues: string[];
  systemInfo: SystemInfo;
}

/** Full exported configuration. */
interface ExportedConfig {
  ai: AIConfig;
  audio: AudioConfig;
  funasr: FunASRConfig;
  app: AppConfig;
  database: DatabaseConfig;
  proxy: ProxyConfig;
  performance: PerformanceConfig;
  system: SystemInfo;
  directories: {
    data: string;
    logs: string;
    cache: string;
    models: string;
  };
}

class EnvironmentManager {
  constructor() {
    this.loadEnvironmentVariables();
  }

  loadEnvironmentVariables(): void {
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
    }
  }

  getAIConfig(): AIConfig {
    return {
      apiKey: "",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-3.5-turbo",
    };
  }

  getAudioConfig(): AudioConfig {
    return {
      sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE || "16000"),
      channels: parseInt(process.env.AUDIO_CHANNELS || "1"),
      format: process.env.AUDIO_FORMAT || "wav",
    };
  }

  getFunASRConfig(): FunASRConfig {
    return {
      modelDir: process.env.FUNASR_MODEL_DIR || "./models",
      cacheDir: process.env.FUNASR_CACHE_DIR || "./cache",
      batchSize: parseInt(process.env.BATCH_SIZE || "300"),
      hotwords: process.env.HOTWORDS ? process.env.HOTWORDS.split(",") : [],
    };
  }

  getAppConfig(): AppConfig {
    return {
      debug: process.env.DEBUG === "true",
      logLevel: process.env.LOG_LEVEL || "info",
      language: process.env.LANGUAGE || "zh-CN",
      theme: process.env.THEME || "auto",
      windowAlwaysOnTop: process.env.WINDOW_ALWAYS_ON_TOP === "true",
      startMinimized: process.env.START_MINIMIZED === "true",
      globalHotkey: process.env.GLOBAL_HOTKEY || "CommandOrControl+Shift+Space",
    };
  }

  getDatabaseConfig(): DatabaseConfig {
    return {
      path: process.env.DATABASE_PATH || "./data/transcriptions.db",
      backupEnabled: process.env.BACKUP_ENABLED !== "false",
      backupInterval: parseInt(process.env.BACKUP_INTERVAL || "24"),
    };
  }

  getProxyConfig(): ProxyConfig {
    return {
      http: process.env.HTTP_PROXY || "",
      https: process.env.HTTPS_PROXY || "",
    };
  }

  getPerformanceConfig(): PerformanceConfig {
    return {
      maxRecordingDuration: parseInt(
        process.env.MAX_RECORDING_DURATION || "300",
      ),
      maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || "10000"),
    };
  }

  getSystemInfo(): SystemInfo {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      osType: os.type(),
      osRelease: os.release(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length,
      homeDir: os.homedir(),
      tmpDir: os.tmpdir(),
    };
  }

  isDevelopment(): boolean {
    return process.env.NODE_ENV === "development";
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  }

  getDataDirectory(): string {
    const appName = "Murmur";
    switch (process.platform) {
      case "win32":
        return path.join(os.homedir(), "AppData", "Roaming", appName);
      case "darwin":
        return path.join(
          os.homedir(),
          "Library",
          "Application Support",
          appName,
        );
      case "linux":
        return path.join(os.homedir(), ".config", appName);
      default:
        return path.join(os.homedir(), `.${appName.toLowerCase()}`);
    }
  }

  ensureDataDirectory(): string {
    const dataDir = this.getDataDirectory();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }

  getLogDirectory(): string {
    const dataDir = this.ensureDataDirectory();
    const logDir = path.join(dataDir, "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    return logDir;
  }

  getCacheDirectory(): string {
    const dataDir = this.ensureDataDirectory();
    const cacheDir = path.join(dataDir, "cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
  }

  getModelsDirectory(): string {
    const dataDir = this.ensureDataDirectory();
    const modelsDir = path.join(dataDir, "models");
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }
    return modelsDir;
  }

  validateEnvironment(): ValidationResult {
    const issues: string[] = [];
    try {
      this.ensureDataDirectory();
    } catch (error) {
      issues.push(`无法创建数据目录: ${(error as Error).message}`);
    }
    const systemInfo = this.getSystemInfo();
    const nodeVersion = parseInt(systemInfo.nodeVersion.substring(1));
    if (nodeVersion < 18) {
      issues.push(`Node.js 版本过低: ${systemInfo.nodeVersion}，需要 18+`);
    }
    return { valid: issues.length === 0, issues, systemInfo };
  }

  exportConfig(): ExportedConfig {
    return {
      ai: this.getAIConfig(),
      audio: this.getAudioConfig(),
      funasr: this.getFunASRConfig(),
      app: this.getAppConfig(),
      database: this.getDatabaseConfig(),
      proxy: this.getProxyConfig(),
      performance: this.getPerformanceConfig(),
      system: this.getSystemInfo(),
      directories: {
        data: this.getDataDirectory(),
        logs: this.getLogDirectory(),
        cache: this.getCacheDirectory(),
        models: this.getModelsDirectory(),
      },
    };
  }
}

export default EnvironmentManager;
