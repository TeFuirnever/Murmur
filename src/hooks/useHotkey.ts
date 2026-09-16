import * as React from "react";
// [20260905_Fix_246_HotkeySettingsUi] Shared renderer default for the
// recording hotkey setting (issue #246).
import { DEFAULT_HOTKEY } from "../settings/hotkeyRecorder";

/**
 * 热键管理Hook
 * 处理全局快捷键功能
 */
export const useHotkey = () => {
  const [hotkey, setHotkey] = React.useState(DEFAULT_HOTKEY);
  const [isRegistered, setIsRegistered] = React.useState(false);
  const registeredHotkeyRef = React.useRef<string | null>(null);
  // [20260905_Fix_246_HotkeyReplaceAtomic] Mirrors the hotkey state so the
  // callbacks below can stay referentially stable (no state deps).
  const hotkeyRef = React.useRef<string>(DEFAULT_HOTKEY);
  hotkeyRef.current = hotkey;

  // 获取当前热键
  React.useEffect(() => {
    const getCurrentHotkey = async () => {
      try {
        if (window.electronAPI) {
          const currentHotkey = await window.electronAPI.getCurrentHotkey();
          if (currentHotkey) {
            setHotkey(currentHotkey);
          }
        }
      } catch (error) {
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log("warn", "获取当前热键失败:", error);
        }
      }
    };

    getCurrentHotkey();
  }, []);

  // 移除F2双击相关的复杂逻辑，专注于传统热键

  // 注册传统热键 - 添加防重复注册机制
  // [20260905_Fix_246_HotkeyReplaceAtomic] Replace semantics are owned by the
  // main process (atomic: the new combo is attempted first and the old one is
  // released only after success), so the renderer must NOT pre-unregister
  // here — that race previously left no live combo after a failed
  // registration. Dedup reads the ref (cleared on unregister), not state, so
  // the callbacks stay referentially stable across renders.
  const registerHotkey = React.useCallback(
    async (newHotkey: string): Promise<boolean> => {
      try {
        // 防重复注册：如果已经注册了相同的热键，直接返回成功
        if (registeredHotkeyRef.current === newHotkey) {
          console.log(`热键 ${newHotkey} 已注册，跳过重复注册`);
          return true;
        }

        if (window.electronAPI) {
          const result = await window.electronAPI.registerHotkey(newHotkey);
          if (result.success) {
            registeredHotkeyRef.current = newHotkey;
            setHotkey(newHotkey);
            setIsRegistered(true);
            return true;
          }
        }
        return false;
      } catch (error) {
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log("error", "注册热键失败:", error);
        }
        return false;
      }
    },
    [],
  );

  // 注销传统热键
  const unregisterHotkey = React.useCallback(
    async (hotkeyToUnregister?: string) => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.unregisterHotkey(
            hotkeyToUnregister || hotkeyRef.current,
          );
          if (result.success) {
            registeredHotkeyRef.current = null;
            setIsRegistered(false);
          }
        }
      } catch (error) {
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log("error", "注销热键失败:", error);
        }
      }
    },
    [],
  );

  // 同步录音状态到主进程
  const syncRecordingState = React.useCallback(async (isRecording: boolean) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.setRecordingState(isRecording);
      }
    } catch (error) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("error", "同步录音状态失败:", error);
      }
    }
  }, []);

  // 格式化热键显示
  const formatHotkey = (hotkeyString: string): string => {
    return hotkeyString
      .replace(
        "CommandOrControl",
        ((
          navigator as Navigator & { userAgentData?: { platform?: string } }
        ).userAgentData?.platform?.startsWith("mac") ??
          /mac/i.test(navigator.userAgent))
          ? "⌘"
          : "Ctrl",
      )
      .replace("Shift", "⇧")
      .replace("Alt", "⌥")
      .replace("Space", "空格")
      .replace("+", " + ");
  };

  return {
    hotkey: formatHotkey(hotkey),
    rawHotkey: hotkey,
    isRegistered,
    registerHotkey,
    unregisterHotkey,
    syncRecordingState,
  };
};
