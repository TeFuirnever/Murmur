// [20260926_Fix_396_PermissionStatus] Issue #396: permission badges must show
// the real OS permission state, not a session flag. The hook queries the main
// process (SYSTEM.PERMISSION_STATUS) via the preload bridge on mount and
// after each test probe; the probe result itself stays session feedback
// (toast) and never fakes the badge. Session-probe toasts are unchanged.
import * as React from "react";
import type {
  MediaPermissionStatus,
  PermissionStatusResult,
} from "../types/ipc";

interface AlertDialog {
  title: string;
  description: string;
}

export const usePermissions = (
  showAlertDialog?: (alert: AlertDialog) => void,
) => {
  const [micStatus, setMicStatus] =
    React.useState<MediaPermissionStatus>("unknown");
  const [accessibilityStatus, setAccessibilityStatus] =
    React.useState<MediaPermissionStatus>("unknown");

  // Real-status refresh: reads the main-process answer into the badge
  // states. Unknown bridge / IPC failure keeps "unknown" (badge hidden).
  const refreshPermissionStatus = React.useCallback(async () => {
    if (!window.electronAPI?.getPermissionStatus) return;
    try {
      const status: PermissionStatusResult =
        await window.electronAPI.getPermissionStatus();
      setMicStatus(status.microphone);
      setAccessibilityStatus(status.accessibility);
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("warn", "查询系统权限状态失败:", err);
      }
    }
  }, []);

  React.useEffect(() => {
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  const requestMicPermission = React.useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ 麦克风权限测试成功",
          description: "麦克风权限正常工作！现在可以进行语音录制了。",
        });
      } else {
        alert("✅ 麦克风权限正常工作！现在可以进行语音录制了。");
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("error", "麦克风权限被拒绝:", err);
      }
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ 需要麦克风权限",
          description: "请授予麦克风权限以使用语音转录功能。",
        });
      } else {
        alert("❌ 需要麦克风权限！请授予麦克风权限以使用语音转录功能。");
      }
    }
    // The probe is session feedback only — the badge re-reads the REAL
    // system status instead of trusting the probe outcome (#396).
    await refreshPermissionStatus();
  }, [showAlertDialog, refreshPermissionStatus]);

  const testAccessibilityPermission = React.useCallback(async () => {
    if (!window.electronAPI?.pasteText) {
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ Electron API 不可用",
          description: "preload 脚本加载失败，请重启应用。",
        });
      } else {
        alert("❌ Electron API 不可用，请重启应用。");
      }
      return;
    }
    try {
      await window.electronAPI.pasteText("Murmur辅助功能测试");
      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ 辅助功能权限测试成功",
          description:
            "辅助功能权限正常工作！请检查测试文本是否出现在其他应用中。",
        });
      } else {
        alert("✅ 辅助功能权限正常工作！请检查测试文本是否出现在其他应用中。");
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log("error", "辅助功能权限测试失败:", err);
      }
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ 需要辅助功能权限",
          description:
            "请在系统设置中授予辅助功能权限，以启用自动文本粘贴功能。",
        });
      } else {
        alert("❌ 需要辅助功能权限！请在系统设置中授予权限。");
      }
    }
    // Same as the mic probe: the badge re-reads the REAL system status
    // (#396) — the probe never impersonates it.
    await refreshPermissionStatus();
  }, [showAlertDialog, refreshPermissionStatus]);

  return {
    // Badges follow the main-process-reported real status only.
    micPermissionGranted: micStatus === "granted",
    accessibilityPermissionGranted: accessibilityStatus === "granted",
    requestMicPermission,
    testAccessibilityPermission,
  };
};
