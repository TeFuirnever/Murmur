// [20260724_TS_BigBang_HotkeyManager] Migrated from .js to .ts (ADR-010).
// `module.exports = HotkeyManager` (class) became `export default
// HotkeyManager`.
import { globalShortcut } from "electron";

/** Logger interface (accepts console or LogManager). */
interface Logger {
  info?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

class HotkeyManager {
  private registeredHotkeys: Map<string, () => void>;
  private isRecording: boolean;
  private logger: Logger | null;
  private lastHotkeyTrigger: Map<string, number>;
  private hotkeyDebounceTime: number;

  constructor(logger: Logger | null = null) {
    this.registeredHotkeys = new Map();
    this.isRecording = false;
    this.logger = logger;

    // 简化的热键防抖机制
    this.lastHotkeyTrigger = new Map();
    this.hotkeyDebounceTime = 200; // 200ms防抖时间，防止意外双击
  }

  // [20260816_Refactor_DeadChannels] The F2 double-click surface was
  // removed with its zero-renderer-caller IPC chain.

  /** 注册传统热键（如Cmd+Shift+Space） */
  registerHotkey(hotkey: string, callback: () => void): boolean {
    // 检查是否已经注册了相同的热键
    if (this.registeredHotkeys.has(hotkey)) {
      if (this.logger && this.logger.info) {
        this.logger.info(`热键 ${hotkey} 已注册，跳过重复注册`);
      }
      return true; // 返回成功，因为热键已经注册
    }

    // 创建带简单防抖的回调函数
    const debouncedCallback = () => {
      const now = Date.now();
      const lastTrigger = this.lastHotkeyTrigger.get(hotkey) || 0;

      // 简单防抖：防止意外的快速重复触发
      if (now - lastTrigger < this.hotkeyDebounceTime) {
        return;
      }

      this.lastHotkeyTrigger.set(hotkey, now);
      callback();
    };

    const success = globalShortcut.register(hotkey, debouncedCallback);

    if (success) {
      if (this.logger && this.logger.info) {
        this.logger.info(`热键 ${hotkey} 注册成功`);
      }
      this.registeredHotkeys.set(hotkey, debouncedCallback);
      return true;
    } else {
      if (this.logger && this.logger.error) {
        this.logger.error(`热键 ${hotkey} 注册失败`);
      }
      return false;
    }
  }

  /** 注销热键 */
  unregisterHotkey(hotkey: string): boolean {
    if (this.registeredHotkeys.has(hotkey)) {
      globalShortcut.unregister(hotkey);
      this.registeredHotkeys.delete(hotkey);
      if (this.logger && this.logger.info) {
        this.logger.info(`热键 ${hotkey} 已注销`);
      }
      return true;
    }
    return false;
  }

  /** 注销所有热键 */
  unregisterAllHotkeys(): void {
    globalShortcut.unregisterAll();
    this.registeredHotkeys.clear();
    if (this.logger && this.logger.info) {
      this.logger.info("所有热键已注销");
    }
  }

  /** 获取已注册的热键列表 */
  getRegisteredHotkeys(): string[] {
    return Array.from(this.registeredHotkeys.keys());
  }

  /** 检查热键是否已注册 */
  isHotkeyRegistered(hotkey: string): boolean {
    return this.registeredHotkeys.has(hotkey);
  }

  /** 设置录音状态（用于外部同步状态） */
  setRecordingState(isRecording: boolean): void {
    this.isRecording = isRecording;
  }

  /** 获取当前录音状态 */
  getRecordingState(): boolean {
    return this.isRecording;
  }
}

export default HotkeyManager;
